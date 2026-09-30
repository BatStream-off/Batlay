import { describe, it, expect } from "vitest";
import { TwitchChatClient, type SocketLike, type ChatStatus } from "../electron/services/twitch/twitch-chat";
import type { OverlayMessage, TwitchError } from "../electron/shared/twitch";

class FakeSocket implements SocketLike {
  handlers: Record<string, ((...a: any[]) => void)[]> = {};
  closed = false;
  constructor(public url: string) {}
  on(event: string, fn: (...a: any[]) => void) { (this.handlers[event] ??= []).push(fn); return this; }
  emit(event: string, ...args: any[]) { for (const fn of this.handlers[event] ?? []) fn(...args); }
  close(code = 1000) { if (this.closed) return; this.closed = true; this.emit("close", code); }
  terminate() { this.close(1006); }
  receive(obj: unknown) { this.emit("message", Buffer.from(JSON.stringify(obj))); }
}

const meta = (message_type: string, extra: object = {}) => ({ message_id: `m-${Math.random()}`, message_type, ...extra });
const welcome = (id = "S1") => ({ metadata: meta("session_welcome"), payload: { session: { id, keepalive_timeout_seconds: 10 } } });
const notif = (type: string, event: object, id: string) => ({ metadata: { message_id: id, message_type: "notification", subscription_type: type }, payload: { event } });
const chatEvent = (id = "msg-1") => ({
  broadcaster_user_id: "42", chatter_user_id: "7", chatter_user_login: "v", chatter_user_name: "V", message_id: id,
  message: { text: "yo", fragments: [{ type: "text", text: "yo" }] }, color: "", badges: [], message_type: "text", cheer: null, reply: null,
});
const flush = () => new Promise((r) => setTimeout(r, 5));

function setup(responder: (url: string, body: any) => number = () => 202) {
  const sockets: FakeSocket[] = [];
  const calls: { url: string; init: any; body: any }[] = [];
  const emitted: OverlayMessage[] = [];
  const statuses: ChatStatus[] = [];
  const fatals: TwitchError[] = [];
  const transient: (TwitchError | null)[] = [];
  const fetchFn = (async (url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    return new Response(JSON.stringify({ message: "détail" }), { status: responder(url, body) });
  }) as unknown as typeof fetch;
  const client = new TwitchChatClient({
    clientId: "CID", getToken: () => "TOKEN", fetchFn, backoff: () => 0, now: () => 1234,
    createSocket: (url) => { const s = new FakeSocket(url); sockets.push(s); return s; },
    emit: (m) => emitted.push(m), onStatus: (s) => statuses.push(s),
    onFatal: (e) => fatals.push(e), onTransientError: (e) => transient.push(e),
  });
  return { client, sockets, calls, emitted, statuses, fatals, transient };
}

describe("TwitchChatClient", () => {
  it("s'abonne aux 4 types avec le bon jeton puis passe en « live »", async () => {
    const t = setup();
    t.client.start("42");
    expect(t.sockets[0].url).toBe("wss://eventsub.wss.twitch.tv/ws");
    t.sockets[0].receive(welcome("SESSION"));
    await flush();
    expect(t.calls.map((c) => c.body.type)).toEqual([
      "channel.chat.message", "channel.chat.message_delete", "channel.chat.clear_user_messages", "channel.chat.clear",
    ]);
    expect(t.calls[0].init.headers.Authorization).toBe("Bearer TOKEN");
    expect(t.calls[0].init.headers["Client-Id"]).toBe("CID");
    expect(t.calls[0].body.transport).toEqual({ method: "websocket", session_id: "SESSION" });
    expect(t.calls[0].body.condition).toEqual({ broadcaster_user_id: "42", user_id: "42" });
    expect(t.statuses).toEqual(["connecting", "live"]);
    t.client.stop();
  });

  it("émet les messages, une seule fois même si Twitch les renvoie", async () => {
    const t = setup();
    t.client.start("42");
    t.sockets[0].receive(welcome());
    await flush();
    t.sockets[0].receive(notif("channel.chat.message", chatEvent("a"), "n1"));
    t.sockets[0].receive(notif("channel.chat.message", chatEvent("a"), "n1"));
    t.sockets[0].receive(notif("channel.chat.message_delete", { message_id: "a" }, "n2"));
    expect(t.emitted.map((m) => m.type)).toEqual(["chat", "delete"]);
    t.client.stop();
  });

  it("401 à l'abonnement : arrêt définitif, session expirée", async () => {
    const t = setup(() => 401);
    t.client.start("42");
    t.sockets[0].receive(welcome());
    await flush();
    expect(t.fatals.map((e) => e.code)).toEqual(["token_expired"]);
    expect(t.client.getStatus()).toBe("off");
  });

  it("403 sur l'abonnement obligatoire : permission manquante", async () => {
    const t = setup(() => 403);
    t.client.start("42");
    t.sockets[0].receive(welcome());
    await flush();
    expect(t.fatals.map((e) => e.code)).toEqual(["missing_scope"]);
  });

  it("l'échec d'un abonnement de modération n'empêche pas le chat", async () => {
    const t = setup((_u, body) => (body.type === "channel.chat.message" ? 202 : 400));
    t.client.start("42");
    t.sockets[0].receive(welcome());
    await flush();
    expect(t.client.getStatus()).toBe("live");
    expect(t.fatals).toEqual([]);
    t.client.stop();
  });

  it("erreur 500 sur l'abonnement obligatoire : erreur affichée puis nouvelle tentative", async () => {
    const t = setup(() => 500);
    t.client.start("42");
    t.sockets[0].receive(welcome());
    await flush();
    expect(t.transient[0]?.code).toBe("subscription_failed");
    expect(t.sockets.length).toBeGreaterThan(1); // nouvelle connexion ouverte
    expect(t.fatals).toEqual([]);
    t.client.stop();
  });

  it("connexion perdue : se reconnecte et se réabonne", async () => {
    const t = setup();
    t.client.start("42");
    t.sockets[0].receive(welcome("S1"));
    await flush();
    t.sockets[0].close(1006);
    expect(t.client.getStatus()).toBe("reconnecting");
    await flush();
    expect(t.sockets.length).toBe(2);
    t.sockets[1].receive(welcome("S2"));
    await flush();
    expect(t.calls.filter((c) => c.body.transport.session_id === "S2").length).toBe(4);
    expect(t.client.getStatus()).toBe("live");
    t.client.stop();
  });

  it("session_reconnect : bascule sur le nouveau socket SANS se réabonner", async () => {
    const t = setup();
    t.client.start("42");
    t.sockets[0].receive(welcome("S1"));
    await flush();
    const before = t.calls.length;
    t.sockets[0].receive({ metadata: meta("session_reconnect"), payload: { session: { reconnect_url: "wss://eventsub.wss.twitch.tv/ws?c=1" } } });
    expect(t.sockets[1].url).toContain("c=1");
    t.sockets[1].receive(welcome("S1"));
    await flush();
    expect(t.calls.length).toBe(before);
    expect(t.sockets[0].closed).toBe(true);
    expect(t.client.getStatus()).toBe("live");
    t.sockets[1].receive(notif("channel.chat.message", chatEvent("z"), "nz"));
    expect(t.emitted.length).toBe(1);
    t.client.stop();
  });

  it("révocation d'autorisation : session terminée", async () => {
    const t = setup();
    t.client.start("42");
    t.sockets[0].receive(welcome());
    await flush();
    t.sockets[0].receive({ metadata: meta("revocation"), payload: { subscription: { type: "channel.chat.message", status: "authorization_revoked" } } });
    expect(t.fatals.map((e) => e.code)).toEqual(["token_expired"]);
  });

  it("après stop(), plus aucune reconnexion ni aucun message", async () => {
    const t = setup();
    t.client.start("42");
    t.sockets[0].receive(welcome());
    await flush();
    const s = t.sockets[0];
    t.client.stop();
    await flush();
    s.receive(notif("channel.chat.message", chatEvent("late"), "nl"));
    expect(t.emitted).toEqual([]);
    expect(t.sockets.length).toBe(1);
    expect(t.client.getStatus()).toBe("off");
  });
});
