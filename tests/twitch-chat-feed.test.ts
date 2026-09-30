import { describe, it, expect } from "vitest";
import { DEFAULT_OPTIONS, buildOverlaySearch, createFeedReducer, emoteUrl, isCommand, parseOverlayOptions, readableNameColor } from "../twitch-overlay/chat-feed";
import type { ChatMessage } from "../electron/shared/twitch";

const msg = (id: string, userId = "u1"): ChatMessage => ({
  id, userId, login: "l", displayName: "L", color: null, badges: [], fragments: [{ type: "text", text: id }], text: id, timestamp: 0, highlight: "none", replyTo: null,
});

describe("parseOverlayOptions", () => {
  it("valeurs par défaut", () => {
    expect(parseOverlayOptions("")).toEqual(DEFAULT_OPTIONS);
  });
  it("lit et borne les réglages", () => {
    expect(parseOverlayOptions("?size=28&max=15&fade=30&badges=0&bg=1")).toMatchObject({ size: 28, max: 15, fadeMs: 30_000, showBadges: false, background: true });
    expect(parseOverlayOptions("?size=1&max=9999&fade=99999")).toMatchObject({ size: 12, max: 100, fadeMs: 3_600_000 });
  });
  it("une valeur invalide retombe sur le défaut", () => {
    expect(parseOverlayOptions("?size=abc&max=-3&fade=1.5&badges=peut-etre")).toMatchObject({ size: 22, max: 20, fadeMs: 0, showBadges: true });
  });
});

describe("createFeedReducer", () => {
  const reduce = createFeedReducer({ max: 3, fadeMs: 1000 });
  it("ajoute, ignore les doublons et plafonne au maximum", () => {
    let s = reduce([], { type: "add", message: msg("a"), now: 0 });
    s = reduce(s, { type: "add", message: msg("a"), now: 0 });
    expect(s.length).toBe(1);
    for (const id of ["b", "c", "d"]) s = reduce(s, { type: "add", message: msg(id), now: 0 });
    expect(s.map((i) => i.message.id)).toEqual(["b", "c", "d"]);
  });
  it("applique suppression, purge d'un spectateur et purge totale", () => {
    let s = ["a", "b"].reduce((acc, id) => reduce(acc, { type: "add", message: msg(id, id === "a" ? "x" : "y"), now: 0 }), [] as ReturnType<typeof reduce>);
    s = reduce(s, { type: "delete", messageId: "a" });
    expect(s.map((i) => i.message.id)).toEqual(["b"]);
    s = reduce(s, { type: "clear_user", userId: "y" });
    expect(s).toEqual([]);
    s = reduce([{ message: msg("z"), addedAt: 0 }], { type: "clear" });
    expect(s).toEqual([]);
  });
  it("purge les messages trop vieux, et garde la même référence s'il n'y a rien à retirer", () => {
    const s = [{ message: msg("old"), addedAt: 0 }, { message: msg("new"), addedAt: 900 }];
    expect(reduce(s, { type: "prune", now: 1500 }).map((i) => i.message.id)).toEqual(["new"]);
    expect(reduce(s, { type: "prune", now: 950 })).toBe(s);
    expect(createFeedReducer({ max: 3, fadeMs: 0 })(s, { type: "prune", now: 1e9 })).toBe(s);
  });
  it("rejoue l'historique en respectant le maximum", () => {
    const s = reduce([], { type: "backlog", messages: ["1", "2", "3", "4"].map((i) => msg(i)), now: 5 });
    expect(s.map((i) => i.message.id)).toEqual(["2", "3", "4"]);
  });
});

describe("affichage", () => {
  it("URL d'émote encodée", () => {
    expect(emoteUrl("25")).toBe("https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0");
    expect(emoteUrl("a/b")).toContain("a%2Fb");
  });
  it("éclaircit les couleurs trop sombres, garde les claires, et est stable sans couleur", () => {
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(lum(readableNameColor("#0000ff", "u"))).toBeGreaterThan(lum("#0000ff"));
    expect(readableNameColor("#ffffff", "u")).toBe("#ffffff");
    expect(readableNameColor(null, "user-1")).toBe(readableNameColor(null, "user-1"));
    expect(readableNameColor(null, "user-1")).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("buildOverlaySearch", () => {
  it("URL vide pour les réglages par défaut", () => {
    expect(buildOverlaySearch(parseOverlayOptions(""))).toBe("");
  });
  it("aller-retour fidèle avec parseOverlayOptions", () => {
    const options = { size: 30, max: 12, fadeMs: 45_000, showBadges: false, background: true };
    expect(buildOverlaySearch(options)).toBe("?size=30&max=12&fade=45&badges=0&bg=1");
    expect(parseOverlayOptions(buildOverlaySearch(options))).toEqual(options);
  });
});

describe("options de personnalisation", () => {
  it("lit police, opacité, ombre, commandes et ordre", () => {
    expect(parseOverlayOptions("?font=mono&opacity=70&shadow=0&nocmd=1&top=1")).toMatchObject({
      font: "mono", bgOpacity: 70, shadow: false, hideCommands: true, newestTop: true,
    });
  });
  it("une police inconnue ou une opacité hors bornes retombe sur une valeur sûre", () => {
    expect(parseOverlayOptions("?font=comic&opacity=900")).toMatchObject({ font: "segoe", bgOpacity: 100 });
    expect(parseOverlayOptions("?font=__proto__")).toMatchObject({ font: "segoe" });
  });
  it("buildOverlaySearch et parseOverlayOptions sont inverses l'un de l'autre", () => {
    const custom = { ...DEFAULT_OPTIONS, font: "serif" as const, bgOpacity: 30, shadow: false, hideCommands: true, newestTop: true, background: true };
    expect(parseOverlayOptions(buildOverlaySearch(custom))).toEqual(custom);
    expect(buildOverlaySearch(DEFAULT_OPTIONS)).toBe("");
  });
  it("taille de la zone : 0 = automatique, valeurs bornées, aller-retour dans l'URL", () => {
    expect(parseOverlayOptions("")).toMatchObject({ width: 0, height: 0 });
    expect(parseOverlayOptions("?w=420&h=640")).toMatchObject({ width: 420, height: 640 });
    expect(parseOverlayOptions("?w=99999&h=abc")).toMatchObject({ width: 3840, height: 0 });
    expect(buildOverlaySearch({ ...DEFAULT_OPTIONS, width: 420, height: 640 })).toBe("?w=420&h=640");
  });
  it("détecte les commandes de bot", () => {
    expect(isCommand({ text: "!uptime" })).toBe(true);
    expect(isCommand({ text: "  !so ninja" })).toBe(true);
    expect(isCommand({ text: "salut !" })).toBe(false);
  });
  it("masque les commandes (ajout et historique) seulement si demandé", () => {
    const cmd = { ...msg("c"), text: "!discord" };
    const on = createFeedReducer({ max: 5, fadeMs: 0, hideCommands: true });
    expect(on([], { type: "add", message: cmd, now: 0 })).toEqual([]);
    expect(on([], { type: "backlog", messages: [msg("a"), cmd], now: 0 }).map((i) => i.message.id)).toEqual(["a"]);
    const off = createFeedReducer({ max: 5, fadeMs: 0 });
    expect(off([], { type: "add", message: cmd, now: 0 }).length).toBe(1);
  });
});
