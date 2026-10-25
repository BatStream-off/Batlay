import { describe, it, expect } from "vitest";
import {
  classifyTikTokError,
  normalizeTikTokSettings,
  parseTikTokUsername,
  readTikTokGift,
  retryDelay,
  tiktokEventToAlert,
  tiktokUserName,
  TIKTOK_RETRY,
} from "../electron/shared/tiktok";
import { TikTokLiveService, type TikTokConnectionLike } from "../electron/services/tiktok/tiktok-live";
import { normalizeAlertsConfig, normalizeIncomingAlert, renderAlertText, sampleAlert, ALERT_KINDS } from "../electron/shared/alerts";

describe("pseudo TikTok", () => {
  it("accepte pseudo, @pseudo et lien du live", () => {
    expect(parseTikTokUsername("Mon.Pseudo_1")).toBe("mon.pseudo_1");
    expect(parseTikTokUsername("  @adil ")).toBe("adil");
    expect(parseTikTokUsername("https://www.tiktok.com/@adil.live/live")).toBe("adil.live");
    expect(parseTikTokUsername("tiktok.com/@adil?lang=fr")).toBe("adil");
  });
  it("refuse le reste", () => {
    for (const bad of ["", "a", "nom avec espace", "x".repeat(25), "<script>", "https://evil.example/@adil", 42, null]) {
      expect(parseTikTokUsername(bad)).toBe(null);
    }
  });
  it("réglages : pseudo invalide → déconnecté, minimum borné", () => {
    expect(normalizeTikTokSettings({ username: "@Adil", enabled: true, giftMinDiamonds: 50 })).toEqual({ username: "adil", enabled: true, giftMinDiamonds: 50 });
    expect(normalizeTikTokSettings({ username: "pas valable !", enabled: true })).toEqual({ username: null, enabled: false, giftMinDiamonds: 1 });
    expect(normalizeTikTokSettings({ username: "adil", enabled: "oui", giftMinDiamonds: -3 }).enabled).toBe(false);
    expect(normalizeTikTokSettings({ giftMinDiamonds: 10_000_000 }).giftMinDiamonds).toBe(100_000);
    expect(normalizeTikTokSettings(null).giftMinDiamonds).toBe(1);
  });
});

describe("erreurs de la bibliothèque", () => {
  class UserOfflineError extends Error {}
  class SignatureRateLimitError extends Error {}
  class InvalidUniqueIdError extends Error {}
  it("reconnaît les cas utiles", () => {
    expect(classifyTikTokError(new UserOfflineError("x"))).toBe("offline");
    expect(classifyTikTokError(new Error("The requested user isn't online :("))).toBe("offline");
    expect(classifyTikTokError(new SignatureRateLimitError("x"))).toBe("rate-limit");
    expect(classifyTikTokError(new Error("Request failed with status code 429"))).toBe("rate-limit");
    expect(classifyTikTokError(new InvalidUniqueIdError("x"))).toBe("not-found");
    expect(classifyTikTokError(Object.assign(new Error("Cannot find package 'tiktok-live-connector'"), { code: "ERR_MODULE_NOT_FOUND" }))).toBe("missing-module");
    expect(classifyTikTokError(new Error("socket hang up"))).toBe("other");
    expect(classifyTikTokError("bizarre")).toBe("other");
  });
  it("délais : hors live espacé, pseudo introuvable sans nouvel essai, erreurs avec recul progressif", () => {
    expect(retryDelay("offline", 0)).toBe(TIKTOK_RETRY.offline);
    expect(retryDelay("not-found", 0)).toBe(null);
    expect(retryDelay("missing-module", 0)).toBe(null);
    expect([1, 2, 3, 4, 9].map((n) => retryDelay("other", n))).toEqual([30_000, 60_000, 120_000, 300_000, 300_000]);
  });
});

describe("événements → alertes", () => {
  const settings = { giftMinDiamonds: 1 };
  it("follow et Super Fan, formats v3 et anciens", () => {
    expect(tiktokEventToAlert("follow", { user: { nickname: "Lina ✨", displayId: "lina" } }, settings)).toEqual({ kind: "follow", user: "Lina ✨" });
    expect(tiktokEventToAlert("follow", { uniqueId: "old_style" }, settings)).toEqual({ kind: "follow", user: "old_style" });
    expect(tiktokEventToAlert("superFanJoin", { user: { displayId: "kaya" } }, settings)).toEqual({ kind: "subscribe", user: "kaya" });
    expect(tiktokUserName(null)).toBeUndefined();
  });
  it("cadeau en série : une seule alerte, à la fin", () => {
    const streak = (repeatCount: number, repeatEnd: boolean | number) => ({ user: { nickname: "Rémi" }, repeatCount, repeatEnd, gift: { type: 1, name: "Rose", diamondCount: 1 } });
    expect(tiktokEventToAlert("gift", streak(1, 0), settings)).toBe(null);
    expect(tiktokEventToAlert("gift", streak(4, 0), settings)).toBe(null);
    expect(tiktokEventToAlert("gift", streak(5, 1), settings)).toEqual({ kind: "tiktokGift", user: "Rémi", amount: 5, gift: "Rose" });
    // Ancien format : giftDetails, repeatEnd booléen.
    expect(tiktokEventToAlert("gift", { nickname: "A", repeatCount: 2, repeatEnd: true, giftDetails: { giftType: 1, giftName: "TikTok", diamondCount: 1 } }, settings)).toEqual({
      kind: "tiktokGift", user: "A", amount: 2, gift: "TikTok",
    });
    // Cadeau non « en série » : affiché tout de suite.
    expect(readTikTokGift({ repeatCount: 1, repeatEnd: false, gift: { type: 2, name: "Lion", diamondCount: 29999 } })?.final).toBe(true);
  });
  it("valeur minimale : quantité comprise", () => {
    const g = (repeatCount: number) => ({ user: { nickname: "B" }, repeatCount, repeatEnd: 1, gift: { type: 1, name: "Rose", diamondCount: 1 } });
    expect(tiktokEventToAlert("gift", g(4), { giftMinDiamonds: 5 })).toBe(null);
    expect(tiktokEventToAlert("gift", g(5), { giftMinDiamonds: 5 })).not.toBe(null);
    // Valeur inconnue : affiché (mieux vaut une alerte de trop qu'un gros cadeau manqué).
    expect(tiktokEventToAlert("gift", { user: { nickname: "C" }, repeatEnd: 1, gift: { type: 1 } }, { giftMinDiamonds: 500 })).not.toBe(null);
  });
  it("le hub nettoie le nom du cadeau et la variable {gift} s'affiche", () => {
    const e = normalizeIncomingAlert({ kind: "tiktokGift", user: "Lina", amount: 3, gift: "Ro​se\n" }, "tiktok", () => "1", 0)!;
    expect(e).toMatchObject({ kind: "tiktokGift", amount: 3, gift: "Ro se" });
    expect(renderAlertText("{user} envoie {amount} × {gift} !", { ...e, gift: "Rose" })).toBe("Lina envoie 3 × Rose !");
    expect(renderAlertText("{gift}", { ...e, gift: undefined })).toBe("cadeau");
    expect(normalizeIncomingAlert({ type: "cadeau", user: "x" }, "tiktok", () => "1", 0)?.kind).toBe("tiktokGift");
  });
  it("anciens réglages d'alertes : le type « Cadeau TikTok » reçoit ses valeurs par défaut", () => {
    const c = normalizeAlertsConfig({ version: 1, kinds: { follow: { title: "Merci {user}" } } });
    expect(ALERT_KINDS).toContain("tiktokGift");
    expect(c.kinds.follow.title).toBe("Merci {user}");
    expect(c.kinds.tiktokGift.subtitle).toContain("{gift}");
    expect(sampleAlert("tiktokGift", "s", 0).gift).toBe("Rose");
  });
});

// ---------------------------------------------------------------------------
// Service : fausse connexion, faux minuteurs
// ---------------------------------------------------------------------------

class FakeConnection implements TikTokConnectionLike {
  listeners = new Map<string, ((...a: unknown[]) => void)[]>();
  disconnected = 0;
  constructor(private readonly result: () => Promise<unknown>) {}
  connect() {
    return this.result();
  }
  disconnect() {
    this.disconnected++;
  }
  on(event: string, fn: (...a: unknown[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]);
  }
  removeAllListeners() {
    this.listeners.clear();
  }
  emit(event: string, data?: unknown) {
    for (const fn of this.listeners.get(event) ?? []) fn(data);
  }
}

function setup(opts: { connect?: (n: number) => Promise<unknown>; settings?: unknown } = {}) {
  let saved: unknown = opts.settings ?? null;
  const alerts: Record<string, unknown>[] = [];
  const states: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const conns: FakeConnection[] = [];
  const service = new TikTokLiveService({
    loadSettings: () => saved,
    saveSettings: (s) => (saved = s),
    onState: (s) => states.push(s.status),
    onAlert: (p) => alerts.push(p),
    createConnection: async () => {
      const n = conns.length;
      const c = new FakeConnection(() => (opts.connect ?? (async () => ({ roomId: "1" })))(n));
      conns.push(c);
      return c;
    },
    now: () => 1000,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => ((h as { cleared: boolean }).cleared = true),
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { service, alerts, states, timers, conns, flush, saved: () => saved };
}

describe("service du live TikTok", () => {
  it("se connecte, transmet follows / Super Fans / cadeaux, ignore un follow répété", async () => {
    const t = setup();
    expect(t.service.connect("@Adil")).toBe(true);
    await t.flush();
    expect(t.service.getState().status).toBe("live");
    expect(t.saved()).toEqual({ username: "adil", enabled: true, giftMinDiamonds: 1 });
    const c = t.conns[0];
    c.emit("follow", { user: { id: "7", nickname: "Lina" } });
    c.emit("follow", { user: { id: "7", nickname: "Lina" } });
    c.emit("superFanJoin", { user: { id: "8", nickname: "Kaya" } });
    c.emit("gift", { user: { nickname: "Rémi" }, repeatCount: 3, repeatEnd: 0, gift: { type: 1, name: "Rose", diamondCount: 1 } });
    c.emit("gift", { user: { nickname: "Rémi" }, repeatCount: 3, repeatEnd: 1, gift: { type: 1, name: "Rose", diamondCount: 1 } });
    expect(t.alerts).toEqual([
      { kind: "follow", user: "Lina" },
      { kind: "subscribe", user: "Kaya" },
      { kind: "tiktokGift", user: "Rémi", amount: 3, gift: "Rose" },
    ]);
  });

  it("refuse un pseudo invalide sans rien enregistrer", () => {
    const t = setup();
    expect(t.service.connect("pas valable !")).toBe(false);
    expect(t.saved()).toBe(null);
    expect(t.conns).toHaveLength(0);
  });

  it("hors live : attend et réessaie, puis se branche quand le live commence", async () => {
    class UserOfflineError extends Error {}
    const t = setup({ connect: async (n) => { if (n === 0) throw new UserOfflineError("offline"); return {}; } });
    t.service.connect("adil");
    await t.flush();
    expect(t.service.getState()).toMatchObject({ status: "waiting", retryAt: 1000 + TIKTOK_RETRY.offline });
    expect(t.timers.at(-1)!.ms).toBe(TIKTOK_RETRY.offline);
    t.timers.at(-1)!.fn();
    await t.flush();
    expect(t.service.getState().status).toBe("live");
  });

  it("pseudo introuvable : erreur, aucun nouvel essai", async () => {
    class InvalidUniqueIdError extends Error {}
    const t = setup({ connect: async () => { throw new InvalidUniqueIdError("nope"); } });
    t.service.connect("adil");
    await t.flush();
    expect(t.service.getState().status).toBe("error");
    expect(t.timers.filter((x) => !x.cleared)).toHaveLength(0);
  });

  it("fin du live : rebranchement programmé, événements de l'ancienne connexion ignorés", async () => {
    const t = setup();
    t.service.connect("adil");
    await t.flush();
    const old = t.conns[0];
    const followListener = old.listeners.get("follow")![0];
    old.emit("streamEnd");
    expect(t.service.getState().status).toBe("waiting");
    expect(t.timers.at(-1)!.ms).toBe(TIKTOK_RETRY.afterEnd);
    followListener({ user: { id: "1", nickname: "Trop tard" } });
    expect(t.alerts).toHaveLength(0);
    t.timers.at(-1)!.fn();
    await t.flush();
    expect(t.service.getState().status).toBe("live");
    expect(t.conns).toHaveLength(2);
  });

  it("Déconnecter : plus d'essai, pseudo gardé, reprise au démarrage seulement si actif", async () => {
    class UserOfflineError extends Error {}
    const t = setup({ connect: async () => { throw new UserOfflineError("x"); } });
    t.service.connect("adil");
    await t.flush();
    await t.service.disconnect();
    expect(t.service.getState().status).toBe("idle");
    expect(t.timers.every((x) => x.cleared)).toBe(true);
    expect(t.saved()).toEqual({ username: "adil", enabled: false, giftMinDiamonds: 1 });

    const again = setup({ settings: { username: "adil", enabled: false } });
    again.service.start();
    await again.flush();
    expect(again.conns).toHaveLength(0);
    const resume = setup({ settings: { username: "adil", enabled: true } });
    resume.service.start();
    await resume.flush();
    expect(resume.service.getState().status).toBe("live");
  });

  it("valeur minimale des cadeaux modifiable en direct", async () => {
    const t = setup();
    t.service.connect("adil");
    await t.flush();
    t.service.updateSettings({ giftMinDiamonds: 10, username: "pirate", enabled: false });
    expect(t.service.getSettings()).toEqual({ username: "adil", enabled: true, giftMinDiamonds: 10 });
    t.conns[0].emit("gift", { user: { nickname: "B" }, repeatCount: 3, repeatEnd: 1, gift: { type: 1, name: "Rose", diamondCount: 1 } });
    expect(t.alerts).toHaveLength(0);
  });

  it("module absent : erreur claire, Batlay continue", async () => {
    const t = setup({ connect: async () => { throw Object.assign(new Error("Cannot find package 'tiktok-live-connector'"), { code: "ERR_MODULE_NOT_FOUND" }); } });
    t.service.connect("adil");
    await t.flush();
    expect(t.service.getState()).toMatchObject({ status: "error" });
    expect(t.service.getState().message).toContain("npm install");
  });
});
