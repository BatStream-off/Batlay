import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { TwitchServer } from "../electron/services/twitch/twitch-server";
import type { CallbackPayload } from "../electron/services/twitch/twitch-oauth";
import type { ChatMessage, OverlayMessage } from "../electron/shared/twitch";

// Port aléatoire : le paramètre `port` n'existe que pour ce test (la prod utilise TWITCH_PORT = 4000).
const PORT = 39_500 + Math.floor(Math.random() * 400);
const ORIGIN = `http://localhost:${PORT}`;
const TOKEN = "abcdefghijklmnopqrstuvwxyz0123";
const STATE = "0123456789abcdef0123456789abcdef";
const received: CallbackPayload[] = [];
let clients = 0;
let server: TwitchServer;

const msg = (id: string): ChatMessage => ({
  id, userId: "u", login: "l", displayName: "L", color: null, badges: [], fragments: [{ type: "text", text: id }],
  text: id, timestamp: 0, highlight: "none", replyTo: null,
});
const tick = (ms = 80) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "batlay-twitch-"));
  writeFileSync(join(dir, "twitch-overlay.html"), "<html>chat</html>");
  server = new TwitchServer({
    staticDir: dir, port: PORT,
    onAuthCallback: async (p) => { received.push(p); return { ok: true, message: "ok" }; },
    onClientsChange: (n) => { clients = n; },
  });
  await server.start();
});
afterAll(async () => { await server.stop(); });

const post = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`http://127.0.0.1:${PORT}/auth/callback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: `localhost:${PORT}`, Origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });

/** fetch interdit de forcer l'en-tête Host : on passe par node:http pour simuler un Host étranger. */
const rawGet = (path: string, host: string) =>
  new Promise<number>((resolve, reject) => {
    http.get({ host: "127.0.0.1", port: PORT, path, headers: { Host: host } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); }).on("error", reject);
  });

function open(headers: Record<string, string> = { Origin: ORIGIN, Host: `localhost:${PORT}` }) {
  return new Promise<{ ws: WebSocket; messages: OverlayMessage[] }>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/chat`, { headers });
    const messages: OverlayMessage[] = [];
    ws.on("message", (d) => messages.push(JSON.parse(d.toString("utf8"))));
    ws.once("open", () => resolve({ ws, messages }));
    ws.once("error", reject);
  });
}

describe("TwitchServer", () => {
  it("sert la page de retour OAuth avec une CSP à nonce", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/`, { headers: { Host: `localhost:${PORT}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toMatch(/script-src 'nonce-/);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sert la page overlay du chat (et pas le dashboard)", async () => {
    expect(await (await fetch(`http://127.0.0.1:${PORT}/overlay/chat`)).text()).toContain("chat");
    expect((await fetch(`http://127.0.0.1:${PORT}/index.html`)).status).toBe(404);
  });

  it("transmet un callback valide venant de l'origine locale", async () => {
    const res = await post({ access_token: TOKEN, scope: "user:read:chat", token_type: "bearer", state: STATE });
    expect(res.status).toBe(200);
    expect(received.at(-1)).toEqual({ kind: "token", accessToken: TOKEN, scopes: ["user:read:chat"], state: STATE });
  });

  it("refuse une origine étrangère, un corps invalide et un mauvais Content-Type", async () => {
    const before = received.length;
    expect((await post({ access_token: TOKEN, state: STATE }, { Origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ nimporte: "quoi" })).status).toBe(400);
    const wrongType = await fetch(`http://127.0.0.1:${PORT}/auth/callback`, {
      method: "POST", headers: { "Content-Type": "text/plain", Origin: ORIGIN }, body: JSON.stringify({ access_token: TOKEN, state: STATE }),
    });
    expect(wrongType.status).toBe(400);
    expect(received.length).toBe(before);
  });

  it("refuse un Host étranger (DNS rebinding)", async () => {
    expect(await rawGet("/health", "evil.example:80")).toBe(403);
    expect(await rawGet("/health", `localhost:${PORT}`)).toBe(200);
  });

  it("WebSocket : historique à la connexion, diffusion, suppression modérée, compteur de sources", async () => {
    server.broadcast({ type: "chat", message: msg("a") });
    server.broadcast({ type: "chat", message: msg("b") });
    const { ws, messages } = await open();
    await tick();
    expect(clients).toBe(1);
    const init = messages[0] as Extract<OverlayMessage, { type: "init" }>;
    expect(init.type).toBe("init");
    expect(init.backlog.map((m) => m.id)).toEqual(["a", "b"]);

    server.broadcast({ type: "chat", message: msg("c") });
    server.broadcast({ type: "delete", messageId: "a" });
    await tick();
    expect(messages.slice(1).map((m) => m.type)).toEqual(["chat", "delete"]);

    const second = await open();
    await tick();
    expect((second.messages[0] as any).backlog.map((m: ChatMessage) => m.id)).toEqual(["b", "c"]);
    second.ws.close();
    ws.close();
    await tick();
    expect(clients).toBe(0);
  });

  it("un message de test n'est pas rejoué aux nouvelles connexions", async () => {
    server.broadcast({ type: "chat", message: msg("test") }, false);
    const { ws, messages } = await open();
    await tick();
    expect((messages[0] as any).backlog.map((m: ChatMessage) => m.id)).not.toContain("test");
    ws.close();
  });

  it("reloadClients prévient chaque source connectée, sans rien mémoriser", async () => {
    expect(server.reloadClients()).toBe(0);
    const { ws, messages } = await open();
    await tick();
    expect(server.reloadClients()).toBe(1);
    await tick();
    expect(messages.map((m) => m.type)).toEqual(["init", "reload"]);
    const later = await open();
    await tick();
    expect(later.messages.map((m) => m.type)).toEqual(["init"]);
    later.ws.close();
    ws.close();
    await tick();
  });

  it("WebSocket : refuse une origine étrangère et un mauvais chemin", async () => {
    let refused = false;
    try { (await open({ Origin: "https://evil.example", Host: `localhost:${PORT}` })).ws.close(); } catch { refused = true; }
    expect(refused).toBe(true);
  });
});
