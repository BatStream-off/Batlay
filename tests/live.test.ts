import { describe, it, expect } from "vitest";
import {
  applyTwitchOverlayMessage,
  countAlert,
  describeAlert,
  emptyCounters,
  filterActivity,
  tiktokChatToMessage,
  type LiveChatMessage,
  type LiveUpdate,
} from "../electron/shared/live";
import { LiveHub } from "../electron/services/live/live-hub";
import { AlertHub } from "../electron/services/alerts/alert-hub";
import { acceptsMessage, createFeedReducer, parseOverlayOptions, buildOverlaySearch, DEFAULT_OPTIONS } from "../twitch-overlay/chat-feed";
import type { ChatMessage } from "../electron/shared/twitch";

const twitchMsg = (id: string, userId = "u1"): ChatMessage => ({
  id, userId, login: "nyx", displayName: "Nyx", color: "#ff0000", badges: [], fragments: [{ type: "text", text: "salut" }], text: "salut", timestamp: 1, highlight: "none", replyTo: null,
});

describe("résumés lisibles", () => {
  it("décrit chaque type d'alerte", () => {
    expect(describeAlert({ kind: "follow" })).toBe("suit la chaîne");
    expect(describeAlert({ kind: "subscribe", tier: "1" })).toBe("nouvel abonnement");
    expect(describeAlert({ kind: "subscribe", tier: "2" })).toBe("abonnement niveau 2");
    expect(describeAlert({ kind: "resub", months: 12, message: "gg" })).toBe("12 mois · « gg »");
    expect(describeAlert({ kind: "gift", amount: 5 })).toBe("5 abonnements offerts");
    expect(describeAlert({ kind: "gift", amount: 1 })).toBe("1 abonnement offert");
    expect(describeAlert({ kind: "tiktokGift", amount: 3, gift: "Rose" })).toBe("3 × Rose");
  });
  it("compteurs : réels seulement, par plateforme", () => {
    let c = emptyCounters(0);
    c = countAlert(c, { kind: "follow", source: "tiktok" });
    c = countAlert(c, { kind: "tiktokGift", source: "tiktok", amount: 5 });
    c = countAlert(c, { kind: "resub", source: "twitch" });
    c = countAlert(c, { kind: "gift", source: "twitch", amount: 3 });
    const before = c;
    expect(countAlert(c, { kind: "follow", source: "test" })).toBe(before);
    expect(c.tiktok).toMatchObject({ follows: 1, gifts: 5 });
    expect(c.twitch).toMatchObject({ subs: 1, giftedSubs: 3 });
  });
});

describe("chats récents", () => {
  it("suit le chat Twitch : ajout, suppression par la modération, vidage ; ignore le message de test", () => {
    let list: LiveChatMessage[] = [];
    list = applyTwitchOverlayMessage(list, { type: "chat", message: twitchMsg("a") }, 3);
    list = applyTwitchOverlayMessage(list, { type: "chat", message: twitchMsg("b", "u2") }, 3);
    expect(list.map((m) => [m.id, m.platform])).toEqual([["a", "twitch"], ["b", "twitch"]]);
    expect(applyTwitchOverlayMessage(list, { type: "chat", message: { ...twitchMsg("t"), userId: "batlay-test" } }, 3)).toBe(list);
    list = applyTwitchOverlayMessage(list, { type: "delete", messageId: "a" }, 3);
    expect(list.map((m) => m.id)).toEqual(["b"]);
    list = [...list, { ...twitchMsg("tt-1", "tt:9"), platform: "tiktok" }];
    list = applyTwitchOverlayMessage(list, { type: "clear" }, 3);
    expect(list.map((m) => m.id)).toEqual(["tt-1"]); // le vidage du chat Twitch ne touche pas TikTok
  });
  it("limite le nombre de messages gardés", () => {
    let list: LiveChatMessage[] = [];
    for (const id of ["1", "2", "3", "4"]) list = applyTwitchOverlayMessage(list, { type: "chat", message: twitchMsg(id) }, 3);
    expect(list.map((m) => m.id)).toEqual(["2", "3", "4"]);
  });
  it("commentaire TikTok → message commun (formats v3 et anciens), texte nettoyé", () => {
    expect(tiktokChatToMessage({ user: { id: "7", displayId: "lina", nickname: "Lina ✨" }, content: "coucou​ !", common: { msgId: "123" } }, 5, 1)).toMatchObject({
      id: "tt-123", userId: "tt:7", login: "lina", displayName: "Lina ✨", text: "coucou !", platform: "tiktok", timestamp: 5,
    });
    expect(tiktokChatToMessage({ uniqueId: "old", nickname: "Old", comment: "hey" }, 5, 2)).toMatchObject({ id: "tt-5-2", displayName: "Old", text: "hey" });
    expect(tiktokChatToMessage({ user: {}, content: "   " }, 5, 3)).toBe(null);
    expect(tiktokChatToMessage(null, 5, 4)).toBe(null);
  });
});

describe("hub de la fenêtre Live", () => {
  const setup = () => {
    const updates: LiveUpdate[] = [];
    let t = 1000;
    const live = new LiveHub({ onUpdate: (u) => updates.push(u), now: () => t });
    let pages = 1;
    const alerts = new AlertHub({
      loadConfig: () => null, saveConfig: () => undefined, loadSecret: () => "a".repeat(32), saveSecret: () => undefined,
      broadcast: () => pages, pushConfig: () => undefined, now: () => t, makeId: () => `id${++t}`,
      onResult: (r, s) => live.recordAlert(r, s),
    });
    return { updates, live, alerts, setPages: (n: number) => (pages = n), tick: (ms: number) => (t += ms) };
  };

  it("journalise chaque alerte avec ce qui lui est arrivé, et compte les vraies", () => {
    const { live, alerts, setPages } = setup();
    alerts.receive({ type: "follow", user: "Lina" }, "tiktok");
    setPages(0);
    alerts.receive({ type: "tiktokGift", user: "Rémi", amount: 3, gift: "Rose" }, "tiktok");
    alerts.receive({ type: "nimportequoi" }, "tiktok");
    alerts.test("subscribe");
    const snap = live.snapshot();
    expect(snap.activity.map((e) => (e.type === "alert" ? `${e.kind}:${e.outcome}:${e.detail}` : `system:${e.level}`))).toEqual([
      "follow:shown:suit la chaîne",
      "tiktokGift:no-source:3 × Rose",
      "system:warn",
      "subscribe:no-source:nouvel abonnement",
    ]);
    expect(snap.counters.tiktok).toMatchObject({ follows: 1, gifts: 3 });
    expect(snap.counters.twitch.subs).toBe(0); // le test n'est pas compté
  });

  it("type désactivé : noté « non affichée », mais compté quand même", () => {
    const { live, alerts } = setup();
    const cfg = alerts.getConfig();
    alerts.setConfig({ ...cfg, kinds: { ...cfg.kinds, follow: { ...cfg.kinds.follow, enabled: false } } });
    alerts.receive({ type: "follow", user: "x" }, "twitch");
    const e = live.snapshot().activity[0];
    expect(e.type === "alert" && e.outcome).toBe("filtered");
    expect(live.snapshot().counters.twitch.follows).toBe(1);
  });

  it("rejouer : nouvel identifiant, même contenu", () => {
    const { live, alerts } = setup();
    const sent: string[] = [];
    alerts.receive({ type: "follow", user: "Lina" }, "tiktok");
    const entry = live.snapshot().activity[0];
    const event = live.findEvent(entry.id)!;
    const replayed = new AlertHub({
      loadConfig: () => null, saveConfig: () => undefined, loadSecret: () => "a".repeat(32), saveSecret: () => undefined,
      broadcast: (ev) => (sent.push(`${ev.id}:${ev.user}`), 1), pushConfig: () => undefined, makeId: () => "neuf",
    }).replay(event);
    expect(replayed.shown).toBe(true);
    expect(sent).toEqual(["neuf:Lina"]);
    expect(live.findEvent("inconnu")).toBe(null);
  });

  it("lignes d'état : un même message répété n'est noté qu'une fois ; remise à zéro", () => {
    const { live, tick } = setup();
    live.system("tiktok", "info", "En attente du live.");
    tick(90_000);
    live.system("tiktok", "info", "En attente du live.");
    live.system("tiktok", "success", "Branché.");
    live.system("tiktok", "info", "En attente du live.");
    expect(live.snapshot().activity).toHaveLength(3);
    live.tiktokMessage({ ...twitchMsg("tt-1", "tt:1"), platform: "tiktok" });
    const snap = live.reset();
    expect(snap.activity).toHaveLength(0);
    expect(snap.chat).toHaveLength(1);
    expect(snap.counters.tiktok.messages).toBe(0);
  });

  it("chats : messages comptés par plateforme, suppressions transmises", () => {
    const { live, updates } = setup();
    live.twitchMessage({ type: "chat", message: twitchMsg("a") });
    live.tiktokMessage({ ...twitchMsg("tt-1", "tt:1"), platform: "tiktok" });
    live.tiktokMessage({ ...twitchMsg("tt-1", "tt:1"), platform: "tiktok" }); // doublon ignoré
    live.twitchMessage({ type: "clear_user", userId: "u1" });
    expect(live.snapshot().counters.twitch.messages).toBe(1);
    expect(live.snapshot().counters.tiktok.messages).toBe(1);
    expect(updates.filter((u) => u.type === "chat-remove")).toEqual([{ type: "chat-remove", ids: ["a"] }]);
  });

  it("filtres du journal", () => {
    const { live, alerts } = setup();
    alerts.receive({ type: "follow", user: "a" }, "twitch");
    alerts.receive({ type: "follow", user: "b" }, "tiktok");
    live.system("tiktok", "info", "x");
    const all = live.snapshot().activity;
    expect(filterActivity(all, "alerts", "all")).toHaveLength(2);
    expect(filterActivity(all, "system", "all")).toHaveLength(1);
    expect(filterActivity(all, "all", "tiktok")).toHaveLength(2);
  });
});

describe("overlay du chat : plateformes", () => {
  it("src= choisit la plateforme ; absent = les deux (les anciens messages sont Twitch)", () => {
    expect(parseOverlayOptions("").sources).toBe("all");
    expect(parseOverlayOptions("?src=tiktok&pico=1")).toMatchObject({ sources: "tiktok", platformIcon: true });
    expect(parseOverlayOptions("?src=youtube").sources).toBe("all");
    expect(buildOverlaySearch({ ...DEFAULT_OPTIONS, sources: "twitch", platformIcon: true })).toBe("?src=twitch&pico=1");
    expect(acceptsMessage({ sources: "twitch" }, {})).toBe(true);
    expect(acceptsMessage({ sources: "twitch" }, { platform: "tiktok" })).toBe(false);
    const reduce = createFeedReducer({ max: 10, fadeMs: 0, sources: "tiktok" });
    const state = reduce([], { type: "add", message: twitchMsg("a"), now: 0 });
    expect(state).toHaveLength(0);
    expect(reduce(state, { type: "add", message: { ...twitchMsg("b"), platform: "tiktok" }, now: 0 })).toHaveLength(1);
  });
});

describe("préférences d'affichage de l'interface", async () => {
  const { applyUiPrefs, normalizeDensity, normalizeMotion, ACCENT_PRESETS } = await import("../src/theme/ui-prefs");
  it("valeurs inconnues → valeurs par défaut ; attributs posés sur <html>", () => {
    expect(normalizeDensity("compact")).toBe("compact");
    expect(normalizeDensity("énorme")).toBe("comfortable");
    expect(normalizeMotion(undefined)).toBe("full");
    const attrs: Record<string, string> = {};
    applyUiPrefs({ setAttribute: (k, v) => (attrs[k] = v) }, { density: "compact", uiMotion: "reduced" });
    expect(attrs).toEqual({ "data-density": "compact", "data-motion": "reduced" });
    applyUiPrefs({ setAttribute: (k, v) => (attrs[k] = v) }, {});
    expect(attrs).toEqual({ "data-density": "comfortable", "data-motion": "full" });
    for (const p of ACCENT_PRESETS) expect(p.hex).toMatch(/^#[0-9A-F]{6}$/);
  });
});

describe("infos du live envoyées aux overlays", () => {
  it("le hub publie totaux et derniers spectateurs ; la remise à zéro les vide", () => {
    const sent: any[] = [];
    const live = new LiveHub({ onUpdate: () => undefined, onStats: (s) => sent.push(s), now: () => 0 });
    live.recordAlert({ shown: true, event: { id: "1", kind: "follow", source: "tiktok", user: "Lina", at: 0 } }, "tiktok");
    live.recordAlert({ shown: false, reason: "filtered", event: { id: "2", kind: "subscribe", source: "twitch", user: "Kaya", at: 0 } }, "twitch");
    live.recordAlert({ shown: true, event: { id: "3", kind: "follow", source: "test", user: "Test", at: 0 } }, "test");
    live.tiktokMessage({ ...twitchMsg("tt-9", "tt:9"), platform: "tiktok" });
    expect(sent.at(-1)).toMatchObject({ followers: 1, subs: 1, messages: 1, lastFollower: "Lina", lastSub: "Kaya" });
    expect(sent).toHaveLength(3); // le test n'envoie rien
    live.reset();
    expect(sent.at(-1)).toMatchObject({ followers: 0, lastFollower: "" });
  });
});
