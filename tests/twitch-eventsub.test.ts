import { describe, it, expect } from "vitest";
import {
  CHAT_SUBSCRIPTIONS,
  buildSubscriptionBody,
  isTrustedReconnectUrl,
  normalizeChatMessage,
  parseBadgeSets,
  parseEventSubMessage,
  reconnectDelayMs,
  toOverlayMessage,
} from "../electron/services/twitch/twitch-eventsub";

const meta = (message_type: string, extra: object = {}) => ({ message_id: "m1", message_type, message_timestamp: "2026-09-30T10:00:00Z", ...extra });

const chatEvent = (over: object = {}) => ({
  broadcaster_user_id: "1",
  chatter_user_id: "42",
  chatter_user_login: "viewer",
  chatter_user_name: "Viewer",
  message_id: "msg-1",
  message: {
    text: "Salut Kappa @adil",
    fragments: [
      { type: "text", text: "Salut ", cheermote: null, emote: null, mention: null },
      { type: "emote", text: "Kappa", cheermote: null, emote: { id: "25", emote_set_id: "0", owner_id: "0", format: ["static"] }, mention: null },
      { type: "text", text: " ", cheermote: null, emote: null, mention: null },
      { type: "mention", text: "@adil", cheermote: null, emote: null, mention: { user_id: "1" } },
    ],
  },
  color: "#FF69B4",
  badges: [{ set_id: "moderator", id: "1", info: "" }, { set_id: "subscriber", id: "12", info: "14" }],
  message_type: "text",
  cheer: null,
  reply: null,
  ...over,
});

describe("parseEventSubMessage", () => {
  it("lit le message de bienvenue", () => {
    const raw = JSON.stringify({ metadata: meta("session_welcome"), payload: { session: { id: "S1", keepalive_timeout_seconds: 10 } } });
    expect(parseEventSubMessage(raw)).toEqual({ kind: "welcome", sessionId: "S1", keepaliveSeconds: 10 });
  });

  it("lit keepalive, notification et révocation", () => {
    expect(parseEventSubMessage(JSON.stringify({ metadata: meta("session_keepalive"), payload: {} }))).toEqual({ kind: "keepalive" });
    const n = parseEventSubMessage(
      JSON.stringify({ metadata: meta("notification", { subscription_type: "channel.chat.message" }), payload: { event: { a: 1 } } })
    );
    expect(n).toEqual({ kind: "notification", messageId: "m1", subscriptionType: "channel.chat.message", event: { a: 1 } });
    const r = parseEventSubMessage(
      JSON.stringify({ metadata: meta("revocation"), payload: { subscription: { type: "channel.chat.message", status: "authorization_revoked" } } })
    );
    expect(r).toEqual({ kind: "revocation", subscriptionType: "channel.chat.message", status: "authorization_revoked" });
  });

  it("n'accepte une URL de reconnexion que si elle pointe vers Twitch en wss", () => {
    const withUrl = (u: string) => JSON.stringify({ metadata: meta("session_reconnect"), payload: { session: { reconnect_url: u } } });
    expect(parseEventSubMessage(withUrl("wss://eventsub.wss.twitch.tv/ws?challenge=abc"))).toEqual({
      kind: "reconnect",
      url: "wss://eventsub.wss.twitch.tv/ws?challenge=abc",
    });
    expect(parseEventSubMessage(withUrl("wss://evil.example/ws"))).toBeNull();
    expect(parseEventSubMessage(withUrl("ws://eventsub.wss.twitch.tv/ws"))).toBeNull();
    expect(isTrustedReconnectUrl("wss://twitch.tv.evil.example/")).toBe(false);
    expect(isTrustedReconnectUrl("pas une url")).toBe(false);
  });

  it("ignore le JSON invalide et les types inconnus", () => {
    expect(parseEventSubMessage("pas du json")).toBeNull();
    expect(parseEventSubMessage("{}")).toBeNull();
    expect(parseEventSubMessage(JSON.stringify({ metadata: meta("inconnu"), payload: {} }))).toBeNull();
    expect(parseEventSubMessage(JSON.stringify({ metadata: meta("session_welcome"), payload: {} }))).toBeNull();
  });
});

describe("normalizeChatMessage", () => {
  it("normalise pseudo, couleur, badges, émotes et mentions", () => {
    const m = normalizeChatMessage(chatEvent(), 1000)!;
    expect(m.id).toBe("msg-1");
    expect(m.displayName).toBe("Viewer");
    expect(m.color).toBe("#ff69b4");
    expect(m.badges).toEqual([{ setId: "moderator", id: "1" }, { setId: "subscriber", id: "12" }]);
    expect(m.fragments.map((f) => f.type)).toEqual(["text", "emote", "text", "mention"]);
    expect(m.fragments[1]).toEqual({ type: "emote", text: "Kappa", emoteId: "25" });
    expect(m.timestamp).toBe(1000);
    expect(m.highlight).toBe("none");
  });

  it("couleur absente ou invalide -> null", () => {
    expect(normalizeChatMessage(chatEvent({ color: "" }), 0)!.color).toBeNull();
    expect(normalizeChatMessage(chatEvent({ color: "red; background:url(x)" }), 0)!.color).toBeNull();
  });

  it("un identifiant d'émote suspect est traité comme du texte (pas d'URL forgée)", () => {
    const event = chatEvent({
      message: { text: "x", fragments: [{ type: "emote", text: "x", emote: { id: "../../evil?x=1" } }] },
    });
    expect(normalizeChatMessage(event, 0)!.fragments).toEqual([{ type: "text", text: "x" }]);
  });

  it("reconnaît mise en avant, cheer, réponse", () => {
    expect(normalizeChatMessage(chatEvent({ message_type: "channel_points_highlighted" }), 0)!.highlight).toBe("channel_points");
    expect(normalizeChatMessage(chatEvent({ cheer: { bits: 100 } }), 0)!.highlight).toBe("cheer");
    expect(normalizeChatMessage(chatEvent({ reply: { parent_user_name: "Adil" } }), 0)!.replyTo).toBe("Adil");
  });

  it("chat partagé : un message d'une autre chaîne porte les badges de sa chaîne d'origine", () => {
    const m = normalizeChatMessage(
      chatEvent({ source_broadcaster_user_id: "999", source_badges: [{ set_id: "vip", id: "1", info: "" }] }),
      0
    )!;
    expect(m.badges).toEqual([{ setId: "vip", id: "1" }]);
  });

  it("rejette un événement incomplet", () => {
    expect(normalizeChatMessage(null, 0)).toBeNull();
    expect(normalizeChatMessage({ message: { text: "x" } }, 0)).toBeNull();
    expect(normalizeChatMessage(chatEvent({ chatter_user_id: undefined }), 0)).toBeNull();
  });

  it("sans fragments, retombe sur le texte brut", () => {
    const m = normalizeChatMessage(chatEvent({ message: { text: "brut", fragments: [] } }), 0)!;
    expect(m.fragments).toEqual([{ type: "text", text: "brut" }]);
  });
});

describe("toOverlayMessage", () => {
  it("traduit message, suppression, purge d'un spectateur et purge totale", () => {
    expect(toOverlayMessage("channel.chat.message", chatEvent(), 5)!.type).toBe("chat");
    expect(toOverlayMessage("channel.chat.message_delete", { message_id: "msg-1" }, 5)).toEqual({ type: "delete", messageId: "msg-1" });
    expect(toOverlayMessage("channel.chat.clear_user_messages", { target_user_id: "42" }, 5)).toEqual({ type: "clear_user", userId: "42" });
    expect(toOverlayMessage("channel.chat.clear", {}, 5)).toEqual({ type: "clear" });
  });
  it("ignore ce qu'il ne connaît pas", () => {
    expect(toOverlayMessage("channel.follow", {}, 5)).toBeNull();
    expect(toOverlayMessage("channel.chat.message_delete", {}, 5)).toBeNull();
  });
});

describe("abonnements", () => {
  it("seul channel.chat.message est obligatoire", () => {
    expect(CHAT_SUBSCRIPTIONS.filter((s) => s.required).map((s) => s.type)).toEqual(["channel.chat.message"]);
    expect(CHAT_SUBSCRIPTIONS.length).toBe(4);
  });
  it("corps de requête : sa propre chaîne, transport WebSocket", () => {
    expect(buildSubscriptionBody("channel.chat.message", "42", "SESSION")).toEqual({
      type: "channel.chat.message",
      version: "1",
      condition: { broadcaster_user_id: "42", user_id: "42" },
      transport: { method: "websocket", session_id: "SESSION" },
    });
  });
});

describe("parseBadgeSets", () => {
  it("aplatit les ensembles de badges et ne garde que les images Twitch en https", () => {
    const out = parseBadgeSets({
      data: [
        { set_id: "moderator", versions: [{ id: "1", image_url_2x: "https://static-cdn.jtvnw.net/badges/v1/x/2" }] },
        { set_id: "evil", versions: [{ id: "1", image_url_2x: "https://evil.example/x.png" }] },
        { set_id: "http", versions: [{ id: "1", image_url_1x: "http://static-cdn.jtvnw.net/x" }] },
      ],
    });
    expect(out).toEqual({ "moderator/1": "https://static-cdn.jtvnw.net/badges/v1/x/2" });
    expect(parseBadgeSets(null)).toEqual({});
  });
});

describe("reconnectDelayMs", () => {
  it("double à chaque tentative, plafonné à 30 s", () => {
    expect([0, 1, 2, 3].map(reconnectDelayMs)).toEqual([1000, 2000, 4000, 8000]);
    expect(reconnectDelayMs(20)).toBe(30_000);
    expect(reconnectDelayMs(-3)).toBe(1000);
  });
});
