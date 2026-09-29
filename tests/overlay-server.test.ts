import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OverlayServer } from "../electron/services/overlay-server";
import type { PlaybackState } from "@/types/track";

const PORT = 38_900 + Math.floor(Math.random() * 500);
let server: OverlayServer;

beforeAll(async () => {
  server = new OverlayServer(PORT, mkdtempSync(join(tmpdir(), "batlay-static-")));
  server.setOverlayConfigs([{ id: "o1" }]);
  await server.start();
});
afterAll(async () => {
  await server.stop();
});

function open(id: string): Promise<{ ws: WebSocket; messages: any[] }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/${id}`);
    const messages: any[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString("utf8"))));
    ws.once("open", () => resolve({ ws, messages }));
  });
}
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));
/** Code de fermeture d'une connexion (1008 = refusée / révoquée par le serveur). */
const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));

// PNG 1×1 valide
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("OverlayServer", () => {
  it("sort la pochette base64 du flux WebSocket et la sert via HTTP (mise en cache)", async () => {
    const { ws, messages } = await open("o1");
    const state: PlaybackState = {
      track: { id: "a", title: "T", artist: "A", duration: 1000, progress: 0, isPlaying: true, artwork: `data:image/png;base64,${PNG_B64}` },
      isPlaying: true,
      updatedAt: Date.now(),
    };
    server.broadcastState(state);
    await tick();

    const last = messages.filter((m) => m.type === "state").pop();
    const url: string = last.payload.track.artwork;
    expect(url).toMatch(/^\/api\/artwork\/[0-9a-f]{16}$/);
    // le message n'embarque PLUS l'image : quelques centaines d'octets, pas des Ko de base64
    expect(JSON.stringify(last).length).toBeLessThan(400);

    const res = await fetch(`http://127.0.0.1:${PORT}${url}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/png");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await res.arrayBuffer()).toString("base64")).toBe(PNG_B64);
    ws.close();
  });

  it("laisse intactes les pochettes http(s) et l'absence de pochette", async () => {
    const { ws, messages } = await open("o1");
    server.broadcastState({
      track: { id: "b", title: "T", artist: "A", duration: 1000, progress: 0, isPlaying: true, artwork: "https://i.scdn.co/x.jpg" },
      isPlaying: true,
      updatedAt: Date.now(),
    });
    await tick();
    expect(messages.filter((m) => m.type === "state").pop().payload.track.artwork).toBe("https://i.scdn.co/x.jpg");
    ws.close();
  });

  it("joint sentAt (horloge du serveur) à chaque message d'état, y compris à la connexion", async () => {
    const before = Date.now();
    const { ws, messages } = await open("o1");
    await tick();
    const first = messages.find((m) => m.type === "state");
    expect(first.sentAt).toBeGreaterThanOrEqual(before);
    ws.close();
  });

  it("pousse la nouvelle configuration aux overlays ouverts quand elle change (Save dans l'éditeur)", async () => {
    const { ws, messages } = await open("o1");
    await tick();
    server.setOverlayConfigs([{ id: "o1", name: "modifié" } as { id: string }]);
    await tick();
    const config = messages.find((m) => m.type === "config");
    expect(config.payload.name).toBe("modifié");

    // rien n'est renvoyé si la config n'a pas changé
    const count = messages.length;
    server.setOverlayConfigs([{ id: "o1", name: "modifié" } as { id: string }]);
    await tick();
    expect(messages.length).toBe(count);
    ws.close();
  });

  it("refuse la connexion WebSocket d'un overlay inconnu", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/inconnu`);
    expect(await closeCode(ws)).toBe(1008);
  });

  it("révoque l'ancien lien OBS : source déconnectée, id refusé, config introuvable", async () => {
    server.setOverlayConfigs([{ id: "o1" }, { id: "avant" }]);
    const { ws } = await open("avant");
    const closed = closeCode(ws);

    // Régénération du lien : même overlay, nouvel id.
    server.setOverlayConfigs([{ id: "o1" }, { id: "apres" }]);
    expect(await closed).toBe(1008);

    // L'ancienne source qui tente de se reconnecter (voir overlay/OverlayApp.tsx) est refusée.
    expect(await closeCode(new WebSocket(`ws://127.0.0.1:${PORT}/ws/avant`))).toBe(1008);
    expect((await fetch(`http://127.0.0.1:${PORT}/api/overlays/avant`)).status).toBe(404);

    // Le nouveau lien, lui, fonctionne et reçoit l'état.
    const fresh = await open("apres");
    await tick();
    expect(fresh.messages.some((m) => m.type === "state")).toBe(true);
    expect((await fetch(`http://127.0.0.1:${PORT}/api/overlays/apres`)).status).toBe(200);
    fresh.ws.close();
  });

  it("404 sur une pochette inconnue", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/artwork/0000000000000000`);
    expect(res.status).toBe(404);
  });
});
