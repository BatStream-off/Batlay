import { describe, it, expect } from "vitest";
import {
  classifyTikTokError,
  normalizeTikTokSettings,
  parseTikTokUsername,
  readTikTokGift,
  parseTikTokOEmbed,
  tiktokOEmbedUrl,
  retryDelay,
  tiktokErrorDetail,
  tiktokEventToAlert,
  tiktokUserName,
  TIKTOK_RETRY,
} from "../electron/shared/tiktok";
import { TikTokLiveService, createOEmbedLookup, createRoomFinder, type TikTokConnectionLike } from "../electron/services/tiktok/tiktok-live";
import { parseLivePageHtml, parseLiveRoomApi, readLiveRoomUserInfo } from "../electron/shared/tiktok";
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
    expect(normalizeTikTokSettings({ username: "@Adil", enabled: true, giftMinDiamonds: 50 })).toEqual({ username: "adil", enabled: true, giftMinDiamonds: 50, mode: "browser" });
    expect(normalizeTikTokSettings({ username: "pas valable !", enabled: true })).toEqual({ username: null, enabled: false, giftMinDiamonds: 1, mode: "browser" });
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
  it("aucun identifiant de live (cas réel : compte hors live) → attente, pas « introuvable »", () => {
    class InvalidResponseCompositeError extends Error {
      constructor(public readonly config: unknown, msg: string) { super(msg); }
    }
    const err = new InvalidResponseCompositeError(
      { routeId: "x", requestErrs: [new Error("Failed to extract the LiveRoom object from SIGI_STATE."), new Error("Failed to extract Room ID from API."), new Error("Failed to retrieve Room ID from Euler Stream ... >>lack of permission<<")] },
      "Failed to retrieve Room ID from all sources.",
    );
    expect(classifyTikTokError(err)).toBe("no-room");
    expect(retryDelay("no-room", 0)).toBe(TIKTOK_RETRY.offline);
    const detail = tiktokErrorDetail(err)!;
    expect(detail).toContain("InvalidResponseCompositeError : Failed to retrieve Room ID from all sources.");
    expect(detail).toContain("LiveRoom");
    expect(detail.length).toBeLessThanOrEqual(800);
    // Un sous-essai qui dit « pas en live » l'emporte.
    expect(classifyTikTokError(new InvalidResponseCompositeError({ requestErrs: [new Error("The requested user isn't online :(")] }, "Failed to retrieve Room ID from all sources."))).toBe("offline");
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
    expect(t.saved()).toEqual({ username: "adil", enabled: true, giftMinDiamonds: 1, mode: "browser" });
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

  it("live introuvable : attente avec détails techniques, puis branchement", async () => {
    const t = setup({ connect: async (n) => { if (n === 0) throw new Error("Failed to retrieve Room ID from all sources."); return {}; } });
    t.service.connect("adil.bli");
    await t.flush();
    expect(t.service.getState()).toMatchObject({ status: "waiting", detail: "Failed to retrieve Room ID from all sources." });
    expect(t.service.getState().message).toContain("pas en live");
    t.timers.at(-1)!.fn();
    await t.flush();
    expect(t.service.getState()).toMatchObject({ status: "live", detail: null });
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
    expect(t.saved()).toEqual({ username: "adil", enabled: false, giftMinDiamonds: 1, mode: "browser" });

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
    expect(t.service.getSettings()).toEqual({ username: "adil", enabled: true, giftMinDiamonds: 10, mode: "browser" });
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

describe("vérification du compte (oEmbed officiel), même hors live", () => {
  const ok = {
    version: "1.0", type: "rich", title: "Adil's Creator Profile", author_url: "https://www.tiktok.com/@adil.bli", author_name: "Adil ✨",
    html: '<blockquote class="tiktok-embed" cite="https://www.tiktok.com/@adil.bli" data-unique-id="adil.bli"></blockquote>', provider_name: "TikTok",
  };
  it("adresse et lecture de la réponse", () => {
    expect(tiktokOEmbedUrl("adil.bli")).toBe("https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40adil.bli");
    expect(parseTikTokOEmbed(200, ok, "adil.bli")).toEqual({ state: "found", account: { username: "adil.bli", displayName: "Adil ✨" } });
    expect(parseTikTokOEmbed(200, { ...ok, author_url: "" }, "adil.bli").state).toBe("found");
    expect(parseTikTokOEmbed(400, null, "x").state).toBe("not-found");
    expect(parseTikTokOEmbed(404, null, "x").state).toBe("not-found");
    expect(parseTikTokOEmbed(200, { code: 400, message: "Something went wrong" }, "x").state).toBe("not-found");
    expect(parseTikTokOEmbed(200, { ...ok, author_url: "https://www.tiktok.com/@autre" }, "adil.bli").state).toBe("not-found");
    expect(parseTikTokOEmbed(503, null, "x").state).toBe("unknown");
    expect(parseTikTokOEmbed(200, "pas du json", "x").state).toBe("unknown");
  });
  it("réseau en panne : « inconnu », jamais « introuvable »", async () => {
    const lookup = createOEmbedLookup(async () => { throw new Error("getaddrinfo ENOTFOUND"); });
    expect((await lookup("adil")).state).toBe("unknown");
    const found = createOEmbedLookup(async () => ({ status: 200, json: async () => ({ ...ok, author_url: "https://www.tiktok.com/@adil" }) }));
    expect(await found("adil")).toMatchObject({ state: "found" });
  });
  it("service : compte trouvé hors live → « Hors live » avec le nom ; compte inexistant → erreur sans essai", async () => {
    class UserOfflineError extends Error {}
    const mk = (lookup: () => Promise<any>) => {
      const states: any[] = [];
      const timers: any[] = [];
      let conns = 0;
      const service = new TikTokLiveService({
        loadSettings: () => null, saveSettings: () => undefined, onState: (s) => states.push(s), onAlert: () => undefined,
        lookupAccount: lookup,
        createConnection: async () => { conns++; return { connect: async () => { throw new UserOfflineError("x"); }, disconnect: () => undefined, on: () => undefined }; },
        setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => undefined, now: () => 0,
      });
      return { service, states, timers, conns: () => conns };
    };
    const a = mk(async () => ({ state: "found", account: { username: "adil.bli", displayName: "Adil" } }));
    a.service.connect("@adil.bli");
    await new Promise((r) => setTimeout(r, 0));
    expect(a.service.getState()).toMatchObject({ status: "waiting", account: { displayName: "Adil" } });
    expect(a.service.getState().message).toContain("Pas en live");
    // Le compte n'est vérifié qu'une fois : le nouvel essai va directement au live.
    a.timers.at(-1).fn();
    await new Promise((r) => setTimeout(r, 0));
    expect(a.conns()).toBe(2);

    const b = mk(async () => ({ state: "not-found" }));
    b.service.connect("existepas");
    await new Promise((r) => setTimeout(r, 0));
    expect(b.service.getState().status).toBe("error");
    expect(b.service.getState().message).toContain("introuvable");
    expect(b.conns()).toBe(0);
    expect(b.timers).toHaveLength(0);

    const c = mk(async () => ({ state: "unknown", reason: "hors ligne" }));
    c.service.connect("adil");
    await new Promise((r) => setTimeout(r, 0));
    expect(c.conns()).toBe(1);
  });
});

describe("recherche du live par Batlay (avant la bibliothèque)", () => {
  const sigi = (info: unknown) => `<html><script id="SIGI_STATE" type="application/json">${JSON.stringify({ LiveRoom: { liveRoomUserInfo: info } })}</script></html>`;
  it("lit le statut du live : 2 = en live, 4 = terminé", () => {
    expect(readLiveRoomUserInfo({ user: { roomId: "7412345678901234567", status: 2 }, liveRoom: { status: 2 } })).toMatchObject({ state: "live", roomId: "7412345678901234567" });
    expect(readLiveRoomUserInfo({ user: { roomId: "7412345678901234567", status: 4 }, liveRoom: { status: 4 } })).toMatchObject({ state: "offline" });
    expect(readLiveRoomUserInfo({ user: { roomId: "" } })).toMatchObject({ state: "offline" });
    expect(readLiveRoomUserInfo(null)).toBe(null);
  });
  it("page du live et API", () => {
    expect(parseLivePageHtml(200, sigi({ user: { roomId: "7412345678901234567", status: 2 }, liveRoom: { status: 2 } }))).toMatchObject({ state: "live", roomId: "7412345678901234567" });
    expect(parseLivePageHtml(200, sigi({ user: { roomId: "", status: 4 } }))).toMatchObject({ state: "offline" });
    expect(parseLivePageHtml(200, '<div>"roomId":"7412345678901234567" "liveRoom":{"x":1,"status":2}</div>')).toMatchObject({ state: "live", roomId: "7412345678901234567" });
    expect(parseLivePageHtml(200, "<div id='captcha-verify'>captcha</div>").state).toBe("unknown");
    expect(parseLivePageHtml(403, "").state).toBe("unknown");
    expect(parseLiveRoomApi(200, { statusCode: 0, data: { user: { roomId: "7412345678901234567", status: 2 }, liveRoom: { status: 2 } } })).toMatchObject({ state: "live", roomId: "7412345678901234567" });
    expect(parseLiveRoomApi(200, { statusCode: 19881007, message: "user_not_found" })).toMatchObject({ state: "unknown" });
    expect(parseLiveRoomApi(200, "x").state).toBe("unknown");
  });
  it("enchaîne page puis API, et garde la trace", async () => {
    const urls: string[] = [];
    const find = createRoomFinder(async (url) => {
      urls.push(url);
      if (url.includes("/live")) return { status: 200, text: "<html>rien</html>" };
      return { status: 200, text: JSON.stringify({ statusCode: 0, data: { user: { roomId: "7412345678901234567", status: 2 }, liveRoom: { status: 2 } } }) };
    });
    const r = await find("adil.bli");
    expect(r.result).toMatchObject({ state: "live", roomId: "7412345678901234567" });
    expect(urls[0]).toBe("https://www.tiktok.com/@adil.bli/live");
    expect(urls[1]).toContain("api-live/user/room/?aid=1988");
    expect(r.trace[0]).toContain("SIGI_STATE");
    expect(r.trace[1]).toContain("EN LIVE");
    const broken = await createRoomFinder(async () => { throw new Error("net::ERR_CONNECTION_RESET"); })("x");
    expect(broken.result.state).toBe("unknown");
    expect(broken.trace.join(" ")).toContain("ERR_CONNECTION_RESET");
  });
  it("service : live trouvé → la bibliothèque reçoit l'identifiant ; pas en live → aucune connexion ouverte", async () => {
    const calls: { opts: unknown; roomId?: string }[] = [];
    const mk = (result: any) =>
      new TikTokLiveService({
        loadSettings: () => null, saveSettings: () => undefined, onState: () => undefined, onAlert: () => undefined,
        findRoom: async () => ({ result, trace: ["page du live : test"] }),
        createConnection: async (_u, opts) => {
          const c: any = { connect: async (roomId?: string) => { calls.push({ opts, roomId }); return {}; }, disconnect: () => undefined, on: () => undefined };
          return c;
        },
        setTimer: () => 1, clearTimer: () => undefined, now: () => 0,
      });
    const live = mk({ state: "live", roomId: "7412345678901234567" });
    live.connect("adil");
    await new Promise((r) => setTimeout(r, 0));
    expect(live.getState().status).toBe("live");
    expect(calls).toEqual([{ opts: { roomId: "7412345678901234567" }, roomId: "7412345678901234567" }]);

    const off = mk({ state: "offline" });
    off.connect("adil");
    await new Promise((r) => setTimeout(r, 0));
    expect(off.getState()).toMatchObject({ status: "waiting", detail: "page du live : test" });
    expect(calls).toHaveLength(1);

    const unknown = mk({ state: "unknown", reason: "bloqué" });
    unknown.connect("adil");
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.at(-1)).toEqual({ opts: { roomId: undefined }, roomId: undefined });
  });
});

describe("fenêtre Chromium invisible (navigateur intégré)", () => {
  const apiLive = JSON.stringify({ statusCode: 0, data: { user: { uniqueId: "adil.bli", nickname: "Adil", roomId: "7412345678901234567", status: 2 }, liveRoom: { status: 2 } } });
  const apiOff = JSON.stringify({ statusCode: 0, data: { user: { uniqueId: "adil.bli", nickname: "Adil", roomId: "7400000000000000001", status: 4 }, liveRoom: { status: 4 } } });
  const noFetch = async () => { throw new Error("ne doit pas être appelé"); };
  it("en live : trouvé par la page TikTok, compte inclus, sans requête supplémentaire", async () => {
    const find = createRoomFinder(noFetch, async () => ({ api: { status: 200, text: apiLive }, sigi: null, href: "https://www.tiktok.com/@adil.bli/live", title: "Adil LIVE" }));
    const r = await find("adil.bli");
    expect(r.result).toMatchObject({ state: "live", roomId: "7412345678901234567", account: { username: "adil.bli", displayName: "Adil" } });
    expect(r.trace[0]).toContain("EN LIVE");
  });
  it("une source « terminé » n'empêche pas une autre de trouver le live", async () => {
    const find = createRoomFinder(
      async (url) => (url.includes("api-live") ? { status: 200, text: apiLive } : { status: 200, text: "<html></html>" }),
      async () => ({ api: { status: 200, text: apiOff }, sigi: null, href: "https://www.tiktok.com/@adil.bli/live", title: "" }),
    );
    const r = await find("adil.bli");
    expect(r.result.state).toBe("live");
    expect(r.trace.join("\n")).toContain("pas en live (statut 4");
  });
  it("hors live partout : « pas en live » avec le compte", async () => {
    const find = createRoomFinder(async (url) => (url.includes("api-live") ? { status: 200, text: apiOff } : { status: 200, text: "<html></html>" }), async () => ({ api: { status: 200, text: apiOff }, sigi: null, href: "", title: "" }));
    const r = await find("adil.bli");
    expect(r.result).toMatchObject({ state: "offline", account: { displayName: "Adil" } });
  });
  it("captcha : signalé dans la trace, puis les autres méthodes sont essayées", async () => {
    const find = createRoomFinder(async () => ({ status: 403, text: "" }), async () => ({ api: { status: 200, text: "<html>captcha</html>" }, sigi: null, href: "https://www.tiktok.com/captcha/verify", title: "Security Check" }));
    const r = await find("adil.bli");
    expect(r.result.state).toBe("unknown");
    expect(r.trace.join("\n")).toContain("anti-robot");
    expect(r.trace.join("\n")).toContain("HTTP 403");
  });
});

describe("live caché : compte privé (réponse réelle de TikTok, octobre 2026)", () => {
  // Réponse d'api-live copiée pendant un vrai live (URL d'avatar retirées) : statut 2, identifiant vide, « secret » : true.
  const real = { data: { user: { id: "6883158089449718786", nickname: "𝐚𝐝𝐢𝐥_𝐛𝐥𝐢", secret: true, uniqueId: "adil.bli", verified: false, roomId: "", signature: "", status: 2, followStatus: 0 }, stats: { followingCount: 52, followerCount: 472 }, liveRoom: { title: "", startTime: 1792984051, status: 2, liveSubOnly: 0, liveRoomMode: 6, liveRoomStats: { enterCount: 1, userCount: 1 } } }, message: "", statusCode: 0 };
  it("n'est plus lu comme « pas en live »", () => {
    expect(parseLiveRoomApi(200, real)).toMatchObject({ state: "hidden", private: true, account: { username: "adil.bli", displayName: "𝐚𝐝𝐢𝐥_𝐛𝐥𝐢" } });
  });
  it("le service explique quoi faire et réessaie", async () => {
    const timers: any[] = [];
    let conns = 0;
    const service = new TikTokLiveService({
      loadSettings: () => null, saveSettings: () => undefined, onState: () => undefined, onAlert: () => undefined,
      findRoom: createRoomFinder(async () => ({ status: 200, text: JSON.stringify(real) })),
      createConnection: async () => { conns++; return { connect: async () => ({}), disconnect: () => undefined, on: () => undefined }; },
      setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => undefined, now: () => 0,
    });
    service.connect("adil.bli");
    await new Promise((r) => setTimeout(r, 0));
    expect(service.getState()).toMatchObject({ status: "hidden", account: { displayName: "𝐚𝐝𝐢𝐥_𝐛𝐥𝐢" } });
    expect(service.getState().message).toContain("compte TikTok est privé");
    expect(service.getState().detail).toContain("identifiant caché");
    expect(conns).toBe(0);
    expect(timers).toHaveLength(1);
  });
});

describe("connexion du compte TikTok", () => {
  it("se connecter pendant l'attente relance la recherche tout de suite ; le message change", async () => {
    let call = 0;
    const timers: any[] = [];
    const hidden = JSON.stringify({ statusCode: 0, data: { user: { uniqueId: "adil.bli", nickname: "A", secret: true, roomId: "", status: 2 }, liveRoom: { status: 2 } } });
    const live = JSON.stringify({ statusCode: 0, data: { user: { uniqueId: "adil.bli", nickname: "A", secret: true, roomId: "7412345678901234567", status: 2 }, liveRoom: { status: 2 } } });
    const rooms: (string | undefined)[] = [];
    const service = new TikTokLiveService({
      loadSettings: () => null, saveSettings: () => undefined, onState: () => undefined, onAlert: () => undefined,
      findRoom: createRoomFinder(async () => ({ status: 200, text: call++ < 2 ? hidden : live })),
      createConnection: async () => ({ connect: async (roomId?: string) => { rooms.push(roomId); return {}; }, disconnect: () => undefined, on: () => undefined }),
      setTimer: (fn, ms) => (timers.push({ fn, ms }), timers.length), clearTimer: () => undefined, now: () => 0,
    });
    service.connect("adil.bli");
    await new Promise((r) => setTimeout(r, 0));
    expect(service.getState()).toMatchObject({ status: "hidden", loggedIn: false });
    expect(service.getState().message).toContain("Se connecter à TikTok");
    service.setLoggedIn(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(service.getState()).toMatchObject({ status: "live", loggedIn: true });
    expect(rooms).toEqual(["7412345678901234567"]);
    // Même état : rien ne se passe.
    service.setLoggedIn(true);
    expect(rooms).toHaveLength(1);
  });
});

describe("diagnostic TikTok", () => {
  it("vérifie chaque étape sans ouvrir de connexion au live", async () => {
    const { formatTikTokDiagnostic: fmt } = await import("../electron/shared/tiktok");
    let connections = 0;
    const svc = new TikTokLiveService({
      loadSettings: () => ({ username: "adil.bli", enabled: true }),
      saveSettings: () => undefined, onState: () => undefined, onAlert: () => undefined,
      loadLibraryInfo: async () => ({ ok: true, version: "2.5.0" }),
      lookupAccount: async () => ({ state: "found", account: { username: "adil.bli", displayName: "Adil" } }),
      findRoom: async () => ({ result: { state: "hidden", private: true }, trace: ["navigateur intégré : en live, identifiant caché"] }),
      createConnection: async () => { connections++; throw new Error("ne doit pas être appelé"); },
      now: () => 0,
    });
    const d = await svc.diagnose();
    expect(d.steps.map((s) => `${s.label}:${s.status}`)).toEqual([
      "Bibliothèque TikTok:ok", "Pseudo:ok", "Compte:ok", "Méthode:ok", "Session TikTok dans Batlay:skip", "Live:fail", "Dernier état de la connexion:skip",
    ]);
    expect(d.steps[5].detail).toContain("compte privé");
    expect(connections).toBe(0);
    const report = fmt(d, "0.3.9");
    expect(report.split("\n")[0]).toBe("Diagnostic TikTok · Batlay 0.3.9 · 1970-01-01T00:00:00.000Z");
    expect(report).toContain("[ÉCHEC] Live : en cours mais identifiant caché");
  });
  it("bibliothèque absente et pseudo manquant : signalés clairement", async () => {
    const svc = new TikTokLiveService({
      loadSettings: () => null, saveSettings: () => undefined, onState: () => undefined, onAlert: () => undefined,
      loadLibraryInfo: async () => ({ ok: false, error: "Cannot find package 'tiktok-live-connector'" }),
      now: () => 0,
    });
    const d = await svc.diagnose();
    expect(d.steps.map((s) => s.status)).toEqual(["fail", "fail"]);
    expect(d.steps[0].detail).toContain("npm install");
  });
});

// ---------------------------------------------------------------------------
// Mode navigateur : page du live invisible, flux lu par Batlay (fausse page)
// ---------------------------------------------------------------------------

describe("mode navigateur (fenêtre invisible)", async () => {
  const { BrowserLiveConnection, BrowserNoStreamError } = await import("../electron/services/tiktok/tiktok-browser");
  const { isWebcastSocketUrl, routeWebcastMessage } = await import("../electron/shared/tiktok");

  class FakePage {
    created: ((id: string, url: string) => void)[] = [];
    frames: ((id: string, d: Uint8Array) => void)[] = [];
    closedCbs: ((id: string) => void)[] = [];
    goneCbs: ((r: string) => void)[] = [];
    closed = 0;
    onSocketCreated(cb: (id: string, url: string) => void) { this.created.push(cb); }
    onBinaryFrame(cb: (id: string, d: Uint8Array) => void) { this.frames.push(cb); }
    onSocketClosed(cb: (id: string) => void) { this.closedCbs.push(cb); }
    onGone(cb: (r: string) => void) { this.goneCbs.push(cb); }
    close() { this.closed++; }
    socket(id: string, url = "wss://webcast16-ws-useast1a.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/?room_id=1") { for (const cb of this.created) cb(id, url); }
    frame(id: string, n: number) { for (const cb of this.frames) cb(id, new Uint8Array([n])); }
    shut(id: string) { for (const cb of this.closedCbs) cb(id); }
    gone(r: string) { for (const cb of this.goneCbs) cb(r); }
  }
  /** Décodeur factice : l'octet de la trame choisit le message. */
  const MESSAGES: Record<number, { type: string; data: unknown }[]> = {
    1: [{ type: "WebcastSocialMessage", data: { common: { displayText: { key: "pm_main_follow_message_viewer_2" } }, user: { nickname: "Lina" } } }],
    2: [{ type: "WebcastSocialMessage", data: { common: { displayText: { key: "pm_mt_guidance_share" } } } }, { type: "WebcastChatMessage", data: { comment: "salut", user: { nickname: "Rémi" } } }],
    3: [{ type: "WebcastControlMessage", data: { action: 3 } }],
  };
  const decoder = { decode: async (f: Uint8Array) => MESSAGES[f[0]] ?? [], streamEnded: (d: unknown) => (d as { action: number }).action === 3 };
  function makeTimers() {
    const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
    return {
      timers,
      setTimer: (fn: () => void, ms: number) => { const t = { fn, ms, cleared: false }; timers.push(t); return t; },
      clearTimer: (h: unknown) => { (h as { cleared: boolean }).cleared = true; },
    };
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  it("reconnaît le flux du live et route les messages comme la bibliothèque", () => {
    expect(isWebcastSocketUrl("wss://webcast16-ws-useast1a.tiktok.com/webcast/im/ws_proxy/ws_reuse_supplement/?x=1")).toBe(true);
    expect(isWebcastSocketUrl("wss://im-ws.tiktok.com/ws/v2")).toBe(false);
    expect(isWebcastSocketUrl("wss://evil.example/webcast")).toBe(false);
    const never = () => false;
    expect(routeWebcastMessage("WebcastSocialMessage", { common: { displayText: { key: "pm_main_follow_message_viewer_2" } } }, never)).toBe("follow");
    expect(routeWebcastMessage("WebcastSocialMessage", { common: { displayText: { key: "pm_mt_guidance_share" } } }, never)).toBe(null);
    expect(routeWebcastMessage("WebcastBarrageMessage", { content: { key: "ttlive_superfan_commentNotif_superFanJoined" } }, never)).toBe("superFanJoin");
    expect(routeWebcastMessage("WebcastGiftMessage", {}, never)).toBe("gift");
    expect(routeWebcastMessage("WebcastControlMessage", { action: 3 }, () => true)).toBe("streamEnd");
    expect(routeWebcastMessage("WebcastLikeMessage", {}, never)).toBe(null);
  });

  it("branché dès que la page ouvre son flux ; messages décodés dans l'ordre ; fin du live", async () => {
    const page = new FakePage();
    const t = makeTimers();
    const conn = new BrowserLiveConnection({ openPage: async () => page, loadDecoder: async () => decoder, ...t });
    const events: string[] = [];
    conn.on("follow", (d) => events.push(`follow:${(d as { user: { nickname: string } }).user.nickname}`));
    conn.on("chat", (d) => events.push(`chat:${(d as { comment: string }).comment}`));
    conn.on("streamEnd", () => events.push("fin"));
    const p = conn.connect();
    await flush();
    page.socket("im-autre", "wss://im-ws.tiktok.com/ws/v2"); // autre socket de la page : ignoré
    page.socket("w1");
    await expect(p).resolves.toEqual({ mode: "browser" });
    page.frame("im-autre", 1);
    page.frame("w1", 1);
    page.frame("w1", 2);
    page.frame("w1", 3);
    await flush();
    expect(events).toEqual(["follow:Lina", "chat:salut", "fin"]);
  });

  it("aucun flux : erreur « no-stream », page fermée", async () => {
    const page = new FakePage();
    const t = makeTimers();
    const conn = new BrowserLiveConnection({ openPage: async () => page, loadDecoder: async () => decoder, ...t });
    const p = conn.connect();
    await flush();
    t.timers[0].fn();
    const err = await p.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BrowserNoStreamError);
    expect(classifyTikTokError(err)).toBe("no-stream");
    expect(page.closed).toBe(1);
  });

  it("flux rouvert par la page : pas de coupure ; flux perdu : « disconnected » après le délai", async () => {
    const page = new FakePage();
    const t = makeTimers();
    const conn = new BrowserLiveConnection({ openPage: async () => page, loadDecoder: async () => decoder, ...t });
    const lost: unknown[] = [];
    conn.on("disconnected", (r) => lost.push(r));
    const p = conn.connect();
    await flush();
    page.socket("w1");
    await p;
    page.shut("w1");
    page.socket("w2");
    const grace = t.timers.at(-1)!;
    expect(grace.cleared).toBe(true);
    page.shut("w2");
    t.timers.at(-1)!.fn();
    expect(lost).toEqual(["flux du live fermé par la page"]);
    expect(page.closed).toBe(1);
    page.gone("fenêtre fermée");
    expect(lost).toHaveLength(1);
  });

  function browserService(opts: { found: unknown; loggedIn?: boolean; connect?: (n: number, lite: boolean) => Promise<unknown> }) {
    let saved: unknown = { username: "adil.bli", enabled: true, mode: "browser" };
    const calls: boolean[] = [];
    const library: number[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    const svc = new TikTokLiveService({
      loadSettings: () => saved,
      saveSettings: (s) => (saved = s),
      onState: () => undefined,
      onAlert: () => undefined,
      findRoom: async () => ({ result: opts.found as never, trace: [] }),
      createConnection: async () => { library.push(1); return new FakeConnection(async () => ({})); },
      createBrowserConnection: (_u, { lite }) => {
        const n = calls.length;
        calls.push(lite);
        return new FakeConnection(() => (opts.connect ?? (async () => ({})))(n, lite));
      },
      now: () => 0,
      setTimer: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
      clearTimer: () => undefined,
    });
    if (opts.loggedIn) svc.setLoggedIn(true);
    return { svc, calls, library, timers, saved: () => saved };
  }

  it("compte privé connecté : le mode navigateur se branche quand même (sans service de signature)", async () => {
    const t = browserService({ found: { state: "hidden", private: true }, loggedIn: true });
    t.svc.start();
    await flush();
    expect(t.svc.getState().status).toBe("live");
    expect(t.svc.getState().message).toContain("mode navigateur");
    expect(t.calls).toEqual([true]);
    expect(t.library).toHaveLength(0);
  });

  it("compte privé NON connecté : on demande de se connecter, aucune page ouverte", async () => {
    const t = browserService({ found: { state: "hidden", private: true } });
    t.svc.start();
    await flush();
    expect(t.svc.getState().status).toBe("hidden");
    expect(t.calls).toHaveLength(0);
  });

  it("page sans flux : nouvel essai en alternant sans/avec vidéo", async () => {
    const t = browserService({
      found: { state: "live", roomId: "7" },
      connect: async (n) => { if (n < 2) throw new BrowserNoStreamError("rien"); return {}; },
    });
    t.svc.start();
    await flush();
    expect(t.svc.getState().status).toBe("waiting");
    t.timers.at(-1)!.fn();
    await flush();
    t.timers.at(-1)!.fn();
    await flush();
    expect(t.calls).toEqual([true, false, true]);
    expect(t.svc.getState().status).toBe("live");
  });

  it("changer de méthode rebranche aussitôt avec la nouvelle", async () => {
    const t = browserService({ found: { state: "live", roomId: "7" } });
    t.svc.start();
    await flush();
    expect(t.calls).toHaveLength(1);
    expect(t.svc.updateSettings({ mode: "library" }).mode).toBe("library");
    await flush();
    expect(t.library).toHaveLength(1);
    expect(t.svc.updateSettings({ mode: "n'importe quoi" }).mode).toBe("browser");
  });
});
