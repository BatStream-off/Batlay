import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { request } from "node:http";
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

  // --- Intégrations multi-logiciels : même URL, mêmes mises à jour, quel que soit le logiciel ---

  it("compte les sources connectées par overlay (page Intégrations) et les oublie à la déconnexion", async () => {
    server.setOverlayConfigs([{ id: "o1" }, { id: "o2" }]);
    expect(server.getClientCounts()).toEqual({});
    const a = await open("o1");
    const b = await open("o1");
    const c = await open("o2");
    await tick();
    expect(server.getClientCounts()).toEqual({ o1: 2, o2: 1 });
    a.ws.close();
    c.ws.close();
    await tick();
    expect(server.getClientCounts()).toEqual({ o1: 1 });
    b.ws.close();
    await tick();
    expect(server.getClientCounts()).toEqual({});
    server.setOverlayConfigs([{ id: "o1" }]);
  });

  it("une source chargée via localhost OU 127.0.0.1 reçoit l'état et les modifications en direct", async () => {
    for (const host of [`localhost:${PORT}`, `127.0.0.1:${PORT}`, `batlay.test:${PORT}`]) {
      // Ce qu'envoie une source Web (OBS, Streamlabs, XSplit, Link de TikTok LIVE Studio) : Host + Origin de la page.
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/o1`, { headers: { Host: host, Origin: `http://${host}` } });
      const messages: any[] = [];
      ws.on("message", (d) => messages.push(JSON.parse(d.toString("utf8"))));
      await new Promise((r) => ws.once("open", r));
      await tick();
      expect(messages.some((m) => m.type === "state"), host).toBe(true);
      server.setOverlayConfigs([{ id: "o1", name: `via ${host}` } as { id: string }]);
      await tick();
      expect(messages.find((m) => m.type === "config")?.payload.name, host).toBe(`via ${host}`);
      ws.close();
    }
    server.setOverlayConfigs([{ id: "o1" }]);
  });

  it("refuse un WebSocket ouvert par une page d'une autre origine", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/o1`, { headers: { Origin: "https://evil.example" } });
    const outcome = await new Promise<string>((resolve) => {
      ws.once("open", () => resolve("open"));
      ws.once("error", () => resolve("refused"));
    });
    expect(outcome).toBe("refused");
    expect(server.getClientCounts()).toEqual({});
  });

  it("refuse toute requête HTTP dont le Host n'est pas ce serveur local (DNS-rebinding)", async () => {
    const get = (path: string, host: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request({ host: "127.0.0.1", port: PORT, path, headers: { Host: host } }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        });
        req.on("error", reject);
        req.end();
      });
    expect(await get("/api/overlays/o1", "evil.example")).toBe(403);
    expect(await get("/api/overlays/o1", `evil.example:${PORT}`)).toBe(403);
    expect(await get("/health", `localhost:${PORT + 1}`)).toBe(403);
    expect(await get("/api/overlays/o1", `localhost:${PORT}`)).toBe(200);
    expect(await get("/api/overlays/o1", `127.0.0.1:${PORT}`)).toBe(200);
    // Nom local pour TikTok LIVE Studio (déclaré dans le fichier hosts) : accepté, ses sous-domaines non.
    expect(await get("/api/overlays/o1", `batlay.test:${PORT}`)).toBe(200);
    expect(await get("/api/overlays/o1", `x.batlay.test:${PORT}`)).toBe(403);
  });

  it("404 sur une pochette inconnue", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/artwork/0000000000000000`);
    expect(res.status).toBe(404);
  });
});
