import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ALERTS_CONFIG,
  normalizeAlertsConfig,
  normalizeIncomingAlert,
  parseAlertKind,
  renderAlertText,
  sampleAlert,
  shouldShowAlert,
  type AlertEvent,
} from "../electron/shared/alerts";
import { AlertHub, RATE_LIMIT } from "../electron/services/alerts/alert-hub";
import { AlertMediaStore, detectMediaType } from "../electron/services/alerts/alert-media-store";
import { ALERT_SUBSCRIPTIONS, buildAlertSubscriptionBody, toAlertPayload } from "../electron/services/twitch/twitch-eventsub";
import { alertScopesFrom } from "../electron/shared/twitch";
import { interpretValidation } from "../electron/services/twitch/twitch-oauth";
import { alertQueueReducer, emptyQueue, MAX_PENDING } from "@/alerts/queue";
import { alertMotion } from "@/alerts/AlertPlayer";
import { artworkBackdropStyle, fillToCss, resolveArtworkFill, defaultFill } from "@/utils/overlay-style";
import { componentContentKey } from "@/utils/overlay-motion";

let n = 0;
const id = () => `id${++n}`;

describe("événements entrants (webhook TikTok, tests)", () => {
  it("type reconnu sous plusieurs noms ; inconnu refusé", () => {
    for (const [raw, kind] of [["follow", "follow"], ["Follower", "follow"], ["sub", "subscribe"], ["subscription", "subscribe"], ["re-sub", "resub"], ["sub_gift", "gift"], ["GIFT", "gift"]] as const) {
      expect(parseAlertKind(raw), raw).toBe(kind);
    }
    for (const raw of ["like", "share", "", 3, null, "follow; drop"]) expect(parseAlertKind(raw), String(raw)).toBeNull();
  });

  it("textes nettoyés et bornés, nombres validés, champs inconnus ignorés", () => {
    const e = normalizeIncomingAlert(
      { type: "gift", user: "  Zoé\u0000​  la\nreine  ", amount: "5", months: -3, message: "x".repeat(500), __proto__: { evil: 1 }, html: "<b>" },
      "tiktok",
      id,
      1000
    )!;
    expect(e).toEqual({ id: e.id, kind: "gift", source: "tiktok", user: "Zoé la reine", amount: 5, message: "x".repeat(200), at: 1000 });
    expect(normalizeIncomingAlert({ type: "follow" }, "tiktok", id, 0)!.user).toBe("Quelqu'un");
    expect(normalizeIncomingAlert({ type: "follow", user: "A".repeat(80) }, "tiktok", id, 0)!.user).toHaveLength(40);
    expect(normalizeIncomingAlert({ type: "gift", user: "x", amount: 99999 }, "tiktok", id, 0)!.amount).toBe(1000);
    expect(normalizeIncomingAlert("follow", "tiktok", id, 0)).toBeNull();
    expect(normalizeIncomingAlert({ user: "x" }, "tiktok", id, 0)).toBeNull();
  });

  it("variables du texte ; le résultat reste du texte (jamais du HTML)", () => {
    const e: AlertEvent = { id: "1", kind: "resub", source: "twitch", user: "<img src=x onerror=alert(1)>", months: 14, message: "Salut", at: 0 };
    expect(renderAlertText("{user} — {months} mois sur {platform} : {message} {inconnu}", e)).toBe("<img src=x onerror=alert(1)> — 14 mois sur Twitch : Salut {inconnu}");
    expect(renderAlertText("{amount}", { ...e, kind: "gift" })).toBe("1");
  });
});

describe("réglages des alertes", () => {
  it("absents ou illisibles → valeurs par défaut", () => {
    for (const raw of [undefined, null, 3, "x", {}]) expect(normalizeAlertsConfig(raw)).toEqual(DEFAULT_ALERTS_CONFIG);
  });
  it("valeurs invalides corrigées champ par champ", () => {
    const c = normalizeAlertsConfig({
      kinds: {
        follow: { enabled: false, title: "T".repeat(300), volume: 7, durationMs: -1, accentColor: "red", imageId: "../../etc/passwd", sound: { type: "file", mediaId: "x.exe" }, enter: "<script>", layout: "diagonal" },
      },
      sources: { tiktok: false },
      gapMs: 99999,
    });
    expect(c.kinds.follow).toMatchObject({ enabled: false, volume: 1, durationMs: 1000, accentColor: "#9B6BFF", imageId: null, sound: { type: "chime" }, enter: "pop", layout: "stack" });
    expect(c.kinds.follow.title).toHaveLength(120);
    expect(c.kinds.subscribe).toEqual(DEFAULT_ALERTS_CONFIG.kinds.subscribe);
    expect(c.sources).toEqual({ twitch: true, tiktok: false });
    expect(c.gapMs).toBe(5000);
  });
  it("fichiers importés : seuls les identifiants « hash.extension » sont acceptés", () => {
    const good = "0123456789abcdef01234567";
    const c = normalizeAlertsConfig({ kinds: { gift: { imageId: `${good}.gif`, sound: { type: "file", mediaId: `${good}.mp3` } } } });
    expect(c.kinds.gift.imageId).toBe(`${good}.gif`);
    expect(c.kinds.gift.sound).toEqual({ type: "file", mediaId: `${good}.mp3` });
    // Un son ne peut pas servir d'image et inversement.
    expect(normalizeAlertsConfig({ kinds: { gift: { imageId: `${good}.mp3` } } }).kinds.gift.imageId).toBeNull();
  });
  it("filtrage : type désactivé, source refusée ; un test passe si le type est activé", () => {
    const c = normalizeAlertsConfig({ kinds: { resub: { enabled: false } }, sources: { tiktok: false } });
    const ev = (kind: AlertEvent["kind"], source: AlertEvent["source"]): AlertEvent => ({ id: "x", kind, source, user: "u", at: 0 });
    expect(shouldShowAlert(c, ev("follow", "twitch"))).toBe(true);
    expect(shouldShowAlert(c, ev("follow", "tiktok"))).toBe(false);
    expect(shouldShowAlert(c, ev("follow", "test"))).toBe(true);
    expect(shouldShowAlert(c, ev("resub", "test"))).toBe(false);
  });
  it("animations des alertes : effets revalidés, mouvement réduit respecté", () => {
    const s = { ...DEFAULT_ALERTS_CONFIG.kinds.follow, enter: "inexistant", exit: "none", animMs: 300 };
    expect(alertMotion(s, false).enter?.effect).toBe("fade");
    expect(alertMotion(s, false).exit).toBeNull();
    expect(alertMotion(DEFAULT_ALERTS_CONFIG.kinds.follow, true)).toEqual({ enter: null, exit: null });
  });
});

describe("file d'alertes (page overlay)", () => {
  const ev = (i: string): AlertEvent => ({ id: i, kind: "follow", source: "twitch", user: i, at: 0 });
  it("une à la fois, dans l'ordre, sans doublon", () => {
    let q = emptyQueue();
    for (const i of ["a", "b", "a", "c", "b"]) q = alertQueueReducer(q, { type: "enqueue", event: ev(i) });
    expect(q.current?.id).toBe("a");
    expect(q.pending.map((e) => e.id)).toEqual(["b", "c"]);
    q = alertQueueReducer(q, { type: "done" });
    expect(q.current?.id).toBe("b");
    q = alertQueueReducer(alertQueueReducer(q, { type: "done" }), { type: "done" });
    expect(q.current).toBeNull();
    // Un événement déjà affiché ne revient pas.
    expect(alertQueueReducer(q, { type: "enqueue", event: ev("a") })).toBe(q);
  });
  it("rafale : file bornée, les plus anciennes en attente abandonnées", () => {
    let q = emptyQueue();
    for (let i = 0; i < 100; i++) q = alertQueueReducer(q, { type: "enqueue", event: ev(String(i)) });
    expect(q.current?.id).toBe("0");
    expect(q.pending).toHaveLength(MAX_PENDING);
    expect(q.pending.at(-1)?.id).toBe("99");
  });
  it("« Passer » vide tout", () => {
    let q = alertQueueReducer(alertQueueReducer(emptyQueue(), { type: "enqueue", event: ev("a") }), { type: "enqueue", event: ev("b") });
    q = alertQueueReducer(q, { type: "skip" });
    expect(q.current).toBeNull();
    expect(q.pending).toEqual([]);
  });
});

function hub(overrides: { pages?: number; now?: () => number } = {}) {
  const sent: AlertEvent[] = [];
  let saved: unknown = null;
  let key: string | null = null;
  const h = new AlertHub({
    loadConfig: () => saved,
    saveConfig: (c) => (saved = c),
    loadSecret: () => key,
    saveSecret: (k) => (key = k),
    broadcast: (e) => {
      sent.push(e);
      return overrides.pages ?? 1;
    },
    pushConfig: () => undefined,
    now: overrides.now,
    makeId: id,
  });
  return { h, sent, key: () => key };
}

describe("hub des alertes (process principal)", () => {
  it("clé secrète : 32 caractères hexadécimaux, conservée, régénérable", () => {
    const { h, key } = hub();
    expect(h.getSecret()).toMatch(/^[0-9a-f]{32}$/);
    expect(key()).toBe(h.getSecret());
    const before = h.getSecret();
    expect(h.regenerateSecret()).not.toBe(before);
  });
  it("adresse locale : mauvaise clé → 404 sans rien afficher ; bonne clé → alerte TikTok", () => {
    const { h, sent } = hub();
    expect(h.handleHook("mauvaise", { type: "follow", user: "x" }).status).toBe(404);
    expect(h.handleHook(h.getSecret().slice(0, 31), { type: "follow" }).status).toBe(404);
    expect(sent).toHaveLength(0);
    expect(h.handleHook(h.getSecret(), { type: "follow", user: "Léa" })).toMatchObject({ status: 200 });
    expect(sent[0]).toMatchObject({ kind: "follow", source: "tiktok", user: "Léa" });
    expect(h.handleHook(h.getSecret(), { type: "like" }).status).toBe(400);
  });
  it("débit limité : au plus 20 alertes par 10 s (hors tests)", () => {
    let t = 0;
    const { h, sent } = hub({ now: () => t });
    for (let i = 0; i < 30; i++) h.receive({ type: "follow", user: `u${i}` }, "twitch");
    expect(sent).toHaveLength(RATE_LIMIT.max);
    expect(h.handleHook(h.getSecret(), { type: "follow", user: "x" }).status).toBe(429);
    expect(h.test("follow").shown).toBe(true); // un test n'est jamais limité
    t += RATE_LIMIT.windowMs;
    expect(h.receive({ type: "follow", user: "après" }, "twitch").shown).toBe(true);
  });
  it("source ou type désactivé : rien n'est diffusé ; aucune page ouverte : signalé", () => {
    const { h, sent } = hub();
    h.setConfig({ sources: { tiktok: false }, kinds: { gift: { enabled: false } } });
    expect(h.handleHook(h.getSecret(), { type: "follow", user: "x" }).status).toBe(202);
    expect(h.receive({ type: "gift", user: "x", amount: 2 }, "twitch").reason).toBe("filtered");
    expect(sent).toHaveLength(0);
    expect(hub({ pages: 0 }).h.test("follow").reason).toBe("no-source");
  });
  it("test : événement d'exemple du type demandé (type inconnu → follow)", () => {
    const { h, sent } = hub();
    h.test("resub");
    h.test("<script>");
    expect(sent.map((e) => [e.kind, e.source])).toEqual([["resub", "test"], ["follow", "test"]]);
    expect(sampleAlert("gift", "x", 0).amount).toBe(5);
  });
});

describe("Twitch : follows et abonnements (EventSub)", () => {
  it("abonnements : follow v2 avec modérateur = la chaîne elle-même ; abonnements v1", () => {
    expect(ALERT_SUBSCRIPTIONS.map((s) => `${s.type}@${s.version}`)).toEqual([
      "channel.follow@2",
      "channel.subscribe@1",
      "channel.subscription.message@1",
      "channel.subscription.gift@1",
    ]);
    expect(buildAlertSubscriptionBody(ALERT_SUBSCRIPTIONS[0], "42", "s").condition).toEqual({ broadcaster_user_id: "42", moderator_user_id: "42" });
    expect(buildAlertSubscriptionBody(ALERT_SUBSCRIPTIONS[1], "42", "s").condition).toEqual({ broadcaster_user_id: "42" });
  });
  it("conversion des événements Twitch", () => {
    expect(toAlertPayload("channel.follow", { user_name: "Nyx", user_login: "nyx" })).toEqual({ type: "follow", user: "Nyx" });
    expect(toAlertPayload("channel.subscribe", { user_name: "Kaya", tier: "2000", is_gift: false })).toEqual({ type: "subscribe", user: "Kaya", tier: "2" });
    // Destinataire d'un abonnement offert : pas d'alerte en double (l'alerte « offert » suffit).
    expect(toAlertPayload("channel.subscribe", { user_name: "Kaya", tier: "1000", is_gift: true })).toBeNull();
    expect(toAlertPayload("channel.subscription.message", { user_name: "Rémi", tier: "1000", cumulative_months: 14, message: { text: "Merci !" } })).toEqual({
      type: "resub",
      user: "Rémi",
      tier: "1",
      months: 14,
      message: "Merci !",
    });
    expect(toAlertPayload("channel.subscription.gift", { user_name: null, is_anonymous: true, total: 10, tier: "1000" })).toMatchObject({ type: "gift", user: "Un donateur anonyme", amount: 10 });
    expect(toAlertPayload("channel.cheer", { user_name: "x" })).toBeNull();
    expect(toAlertPayload("channel.follow", "pas un objet")).toBeNull();
  });
  it("permissions : les alertes sont facultatives, la session de chat reste valide sans elles", () => {
    expect(alertScopesFrom(["user:read:chat"])).toEqual({ follows: false, subscriptions: false });
    expect(alertScopesFrom(["user:read:chat", "moderator:read:followers", "channel:read:subscriptions"])).toEqual({ follows: true, subscriptions: true });
    const r = interpretValidation(200, { client_id: "c", login: "a", user_id: "1", scopes: ["user:read:chat"], expires_in: 10 }, { clientId: "c" });
    expect(r.ok).toBe(true);
  });
});

describe("fichiers importés (images, sons)", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  it("type reconnu par le contenu, jamais par le nom", () => {
    expect(detectMediaType(png)).toBe("png");
    expect(detectMediaType(mp3)).toBe("mp3");
    expect(detectMediaType(new TextEncoder().encode("GIF89a........"))).toBe("gif");
    expect(detectMediaType(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBe("webp");
    expect(detectMediaType(new TextEncoder().encode("RIFF....WAVEfmt "))).toBe("wav");
    expect(detectMediaType(new TextEncoder().encode("OggS..........."))).toBe("ogg");
    expect(detectMediaType(new TextEncoder().encode("MZ\x90\x00 exécutable"))).toBeNull();
    expect(detectMediaType(new TextEncoder().encode("<svg onload=x>    "))).toBeNull();
  });
  it("stockage sous un nom calculé ; type attendu vérifié ; lecture par identifiant validé seulement", () => {
    const dir = mkdtempSync(join(tmpdir(), "alert-media-"));
    const store = new AlertMediaStore(dir);
    const saved = store.save(png, "image");
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.id).toMatch(/^[0-9a-f]{24}\.png$/);
    expect(readdirSync(dir)).toEqual([saved.id]);
    expect(store.save(png, "image")).toEqual(saved); // même contenu = même fichier
    expect(store.save(png, "sound")).toMatchObject({ ok: false });
    expect(store.save(new Uint8Array(0), "image")).toMatchObject({ ok: false });
    expect(store.read(saved.id)?.mime).toBe("image/png");
    for (const bad of ["../../secret.png", saved.id.toUpperCase(), "x.png", `${saved.id}/..`]) expect(store.read(bad), bad).toBeNull();
  });
});

describe("fond « pochette floutée »", () => {
  const fill = defaultFill({ mode: "artwork", color: "#101018", opacity: 0.9, artwork: { blur: 30, zoom: 1.6, dim: 0.4 } });
  it("réglages validés (fichier importé, ancienne version)", () => {
    expect(resolveArtworkFill(defaultFill({ mode: "artwork" }))).toEqual({ blur: 24, zoom: 1.4, dim: 0.35 });
    expect(resolveArtworkFill({ ...fill, artwork: { blur: 999, zoom: 0, dim: -1 } })).toEqual({ blur: 60, zoom: 1, dim: 0 });
  });
  it("image floutée, agrandie, assombrie ; couleur de secours sans pochette", () => {
    expect(artworkBackdropStyle(fill)).toMatchObject({ transform: "scale(1.6)", filter: "blur(30px) brightness(0.6)", opacity: 0.9, objectFit: "cover" });
    expect(fillToCss(fill)).toBe("rgba(16, 16, 24, 0.9)");
  });
  it("fondu d'une pochette à l'autre : la clé d'un composant à fond pochette suit la pochette", () => {
    const shape = { type: "shape" as const, style: { background: fill } };
    // La clé de contenu reste la même ; c'est OverlayPreview qui y ajoute la pochette (testé dans le navigateur).
    expect(componentContentKey(shape, { id: "a", title: "t", artist: "a", duration: 1, progress: 0, isPlaying: true, artwork: "/a" })).toBe("present");
  });
});
