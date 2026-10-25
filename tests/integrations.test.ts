import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CANVAS_FORMATS,
  CHAT_RECOMMENDED_SIZE,
  PLATFORM_IDS,
  STATUS_LABELS,
  TESTING_NOTE,
  buildDiagnostics,
  buildOverlayUrlVariant,
  chatOverlaySourceSize,
  computeFitScale,
  dimensionsClipboardText,
  formatDimensions,
  getCanvasFormat,
  getPlatform,
  identifyOverlayUrl,
  isValidOverlayId,
  listPlatforms,
  musicOverlaySourceSize,
  normalizePlatformId,
  parseOverlayDisplayParams,
  placeInScene,
  type DiagnosticInput,
} from "@/integrations";
import { PLATFORM_DOCS, resolvePlatformDocsUrl } from "../electron/shared/integrations";
import { OverlayPreview } from "@/components/OverlayPreview";
import { getPreset, listPresetIds } from "@/presets";
import type { OverlayConfig } from "@/types/overlay";
import { DEFAULT_OPTIONS, buildOverlaySearch, parseOverlayOptions } from "../twitch-overlay/chat-feed";
import { regenerateObsIds } from "@/utils/obs-link";

// ---------------------------------------------------------------------------
// Registre des logiciels
// ---------------------------------------------------------------------------

describe("registre des logiciels de streaming", () => {
  it("couvre au minimum OBS, TikTok LIVE Studio, Streamlabs, XSplit et « Autre »", () => {
    expect(listPlatforms().map((p) => p.id)).toEqual(["obs", "tiktok-live-studio", "streamlabs", "xsplit", "other"]);
    expect([...PLATFORM_IDS]).toEqual(listPlatforms().map((p) => p.id));
  });

  it("chaque logiciel a un nom, une méthode, des étapes et un champ de taille", () => {
    for (const p of listPlatforms()) {
      expect(p.name.length, p.id).toBeGreaterThan(2);
      expect(p.method.length, p.id).toBeGreaterThan(10);
      expect(p.steps.length, p.id).toBeGreaterThanOrEqual(3);
      expect(p.sizeField.length, p.id).toBeGreaterThan(3);
      expect(STATUS_LABELS[p.status], p.id).toBeTruthy();
    }
  });

  it("aucune compatibilité théorique présentée comme confirmée : seul OBS est « référence »", () => {
    for (const p of listPlatforms()) {
      if (p.id !== "obs") expect(p.status, p.id).not.toBe("reference");
      // « Vérifié » n'est autorisé que là où le rendu a réellement été testé (Chromium = moteur d'OBS).
      for (const cap of [p.liveUpdates, p.transparency, p.localAccess]) {
        if (p.id !== "obs") expect(cap.certainty, p.id).not.toBe("verified");
      }
    }
    expect(TESTING_NOTE).toMatch(/Aucun de ces logiciels n'a été lancé avec Batlay/);
  });

  it("TikTok LIVE Studio : compatibilité partielle, source Link, portrait, méthode de secours réelle", () => {
    const tiktok = getPlatform("tiktok-live-studio");
    expect(tiktok.status).toBe("partial");
    expect(tiktok.sourceName).toMatch(/Link/);
    expect(tiktok.defaultFormat).toBe("portrait");
    expect(tiktok.recommendFit).toBe(true);
    expect(tiktok.localAccess.certainty).toBe("unknown");
    expect(tiktok.transparency.certainty).toBe("unknown");
    expect(tiktok.alternatives.map((a) => a.title).join(" ")).toMatch(/Caméra virtuelle d'OBS/);
    // Aucun contournement : jamais de serveur public, jamais de clé « obtenue » par Batlay.
    const all = JSON.stringify(tiktok);
    expect(all).toMatch(/rien n'est exposé sur Internet/);
    // Le champ « Lien » refuse localhost / 127.0.0.1 (constaté) : l'URL proposée utilise le nom local batlay.test.
    expect(tiktok.preferredHost).toBe("batlay.test");
    expect(tiktok.steps[0]).toContain("127.0.0.1 batlay.test");
    // Les autres logiciels prennent l'hôte fourni par Batlay (batlay.test une fois configuré, sinon localhost).
    for (const p of listPlatforms()) if (p.id !== "tiktok-live-studio") expect(p.preferredHost, p.id).toBeNull();
    expect(all).not.toMatch(/0\.0\.0\.0|ngrok|tunnel/i);
  });

  it("sélection : identifiant inconnu ou corrompu → repli sans planter", () => {
    expect(getPlatform("xsplit").name).toBe("XSplit Broadcaster");
    expect(getPlatform("inconnu").id).toBe("other");
    expect(getPlatform(undefined).id).toBe("other");
    expect(normalizePlatformId("streamlabs")).toBe("streamlabs");
    expect(normalizePlatformId(null)).toBe("tiktok-live-studio");
    expect(normalizePlatformId('"><script>')).toBe("tiktok-live-studio");
    expect(normalizePlatformId(42, "obs")).toBe("obs");
  });
});

describe("documentation officielle : liste fermée, ouverte par identifiant seulement", () => {
  it("toutes les adresses sont en https, sur le domaine de l'éditeur", () => {
    const expectedHost: Record<string, RegExp> = {
      obs: /^obsproject\.com$/,
      "tiktok-live-studio": /^www\.tiktok\.com$/,
      streamlabs: /^streamlabs\.com$/,
      xsplit: /^support\.xsplit\.com$/,
    };
    for (const [id, docs] of Object.entries(PLATFORM_DOCS)) {
      if (!docs) continue;
      const url = new URL(docs.url);
      expect(url.protocol, id).toBe("https:");
      expect(url.hostname, id).toMatch(expectedHost[id]);
    }
    expect(PLATFORM_DOCS.other).toBeNull();
  });
  it("resolvePlatformDocsUrl n'accepte qu'un identifiant connu, jamais une URL", () => {
    expect(resolvePlatformDocsUrl("obs")).toBe("https://obsproject.com/kb/browser-source");
    expect(resolvePlatformDocsUrl("other")).toBeNull();
    expect(resolvePlatformDocsUrl("https://evil.example")).toBeNull();
    expect(resolvePlatformDocsUrl("file:///C:/Windows/System32/calc.exe")).toBeNull();
    expect(resolvePlatformDocsUrl({ toString: () => "obs" })).toBeNull();
    expect(resolvePlatformDocsUrl(undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Formats et dimensions
// ---------------------------------------------------------------------------

describe("formats de scène et dimensions recommandées", () => {
  it("paysage 1920×1080, portrait 1080×1920, carré 1080×1080", () => {
    expect(CANVAS_FORMATS.map((f) => [f.id, f.width, f.height])).toEqual([
      ["landscape", 1920, 1080],
      ["portrait", 1080, 1920],
      ["square", 1080, 1080],
    ]);
    expect(getCanvasFormat("portrait").height).toBe(1920);
    expect(getCanvasFormat("n'importe quoi").id).toBe("landscape");
  });

  it("overlay musical : la taille de source est TOUJOURS celle du canvas (aucune dimension modifiée)", () => {
    for (const id of listPresetIds()) {
      const preset = getPreset(id);
      expect(musicOverlaySourceSize(preset.theme), id).toEqual({ width: preset.theme.canvasWidth, height: preset.theme.canvasHeight });
    }
    // Overlay importé abîmé : jamais 0, NaN ou négatif.
    expect(musicOverlaySourceSize({ canvasWidth: Number.NaN, canvasHeight: -5 })).toEqual({ width: 800, height: 250 });
  });

  it("placement : taille réelle si l'overlay tient, sinon réduction proportionnelle à 90 % de la scène", () => {
    const portrait = getCanvasFormat("portrait");
    expect(placeInScene({ width: 800, height: 250 }, portrait)).toEqual({
      source: { width: 800, height: 250 },
      displayed: { width: 800, height: 250 },
      scale: 1,
      fitsNatively: true,
    });
    const wide = placeInScene({ width: 1920, height: 1080 }, portrait);
    expect(wide.fitsNatively).toBe(false);
    expect(wide.source).toEqual({ width: 1920, height: 1080 }); // la source garde la taille du canvas
    expect(wide.scale).toBe(0.5); // 1080 × 0,9 / 1920 = 0,506 → 0,50
    expect(wide.displayed.width).toBeLessThanOrEqual(portrait.width);
    const square = placeInScene({ width: 1200, height: 300 }, getCanvasFormat("square"));
    expect(square.displayed.width).toBeLessThanOrEqual(1080);
  });

  it("chat : zone choisie si fixée, sinon recommandation du format", () => {
    expect(chatOverlaySourceSize({ width: 0, height: 0 }, "landscape")).toEqual({ width: 420, height: 640 });
    expect(chatOverlaySourceSize({ width: 0, height: 0 }, "portrait")).toEqual(CHAT_RECOMMENDED_SIZE.portrait);
    expect(chatOverlaySourceSize({ width: 500, height: 0 }, "square")).toEqual({ width: 500, height: 640 });
    expect(chatOverlaySourceSize({ width: 600, height: 300 }, "portrait")).toEqual({ width: 600, height: 300 });
    // En portrait, la zone conseillée tient dans la largeur et reste hors du tiers inférieur.
    expect(CHAT_RECOMMENDED_SIZE.portrait.width).toBeLessThanOrEqual(1080);
    expect(CHAT_RECOMMENDED_SIZE.portrait.height).toBeLessThanOrEqual(1920 * (2 / 3));
  });

  it("dimensions : lisibles à l'écran, ASCII dans le presse-papiers", () => {
    expect(formatDimensions({ width: 1080, height: 1920 })).toBe("1080 × 1920 px");
    expect(dimensionsClipboardText({ width: 1080, height: 1920 })).toBe("1080x1920");
  });
});

// ---------------------------------------------------------------------------
// URL : préservation des liens existants, variantes, validation
// ---------------------------------------------------------------------------

const MUSIC_URL = "http://localhost:3000/overlay/abc123XYZ_";
const CHAT_URL = `http://localhost:4000/overlay/chat${buildOverlaySearch({ ...DEFAULT_OPTIONS, size: 30, fadeMs: 45_000, showBadges: false, width: 420, height: 640 })}`;

describe("URL d'overlay : les liens existants ne changent pas", () => {
  it("sans option, l'URL est rendue à l'identique (musique et chat)", () => {
    expect(buildOverlayUrlVariant(MUSIC_URL)).toBe(MUSIC_URL);
    expect(buildOverlayUrlVariant(CHAT_URL)).toBe(CHAT_URL);
  });

  it("variante 127.0.0.1 : même port, même chemin, mêmes réglages", () => {
    expect(buildOverlayUrlVariant(MUSIC_URL, { host: "127.0.0.1" })).toBe("http://127.0.0.1:3000/overlay/abc123XYZ_");
    const chat = buildOverlayUrlVariant(CHAT_URL, { host: "127.0.0.1" })!;
    expect(chat.startsWith("http://127.0.0.1:4000/overlay/chat?")).toBe(true);
    // Les réglages du chat survivent à l'aller-retour, valeur par valeur.
    expect(parseOverlayOptions(new URL(chat).search)).toEqual(parseOverlayOptions(new URL(CHAT_URL).search));
    // Retour à localhost = URL d'origine.
    expect(buildOverlayUrlVariant(chat, { host: "localhost" })).toBe(CHAT_URL);
  });

  it("variante batlay.test (TikTok LIVE Studio) : même port, même chemin, mêmes réglages", () => {
    expect(buildOverlayUrlVariant(MUSIC_URL, { host: "batlay.test" })).toBe("http://batlay.test:3000/overlay/abc123XYZ_");
    const chat = buildOverlayUrlVariant(CHAT_URL, { host: "batlay.test" })!;
    expect(chat.startsWith("http://batlay.test:4000/overlay/chat?")).toBe(true);
    expect(parseOverlayOptions(new URL(chat).search)).toEqual(parseOverlayOptions(new URL(CHAT_URL).search));
    expect(buildOverlayUrlVariant(chat, { host: "localhost" })).toBe(CHAT_URL);
    // Un autre nom en .test, ou un sous-domaine, n'est jamais accepté.
    expect(buildOverlayUrlVariant("http://autre.test:3000/overlay/a")).toBeNull();
    expect(buildOverlayUrlVariant("http://batlay.test.evil.example:3000/overlay/a")).toBeNull();
  });

  it("fit=contain ajouté ou retiré sans toucher au reste", () => {
    const fitted = buildOverlayUrlVariant(MUSIC_URL, { fit: true })!;
    expect(fitted).toBe(`${MUSIC_URL}?fit=contain`);
    expect(buildOverlayUrlVariant(fitted, { fit: false })).toBe(MUSIC_URL);
    expect(buildOverlayUrlVariant(fitted, { fit: true })).toBe(fitted); // idempotent
    expect(buildOverlayUrlVariant(`${MUSIC_URL}?fit=contain`, {})).toBe(fitted);
  });

  it("refuse toute URL qui n'est pas une adresse http locale de Batlay", () => {
    for (const bad of [
      "https://localhost:3000/overlay/a",
      "http://example.com:3000/overlay/a",
      "http://0.0.0.0:3000/overlay/a",
      "http://192.168.1.10:3000/overlay/a",
      "http://user:pass@localhost:3000/overlay/a",
      "http://localhost/overlay/a",
      "javascript:alert(1)",
      "file:///C:/overlay.html",
      "",
      "pas une url",
    ]) {
      expect(buildOverlayUrlVariant(bad), bad).toBeNull();
    }
  });

  it("la régénération des liens (OBS) reste l'unique façon de révoquer un lien, pour tous les logiciels", () => {
    const { overlays, idMap } = regenerateObsIds([{ id: "abc123XYZ_" }], null, "all", () => "nouveau123");
    const before = buildOverlayUrlVariant(MUSIC_URL, { host: "127.0.0.1", fit: true })!;
    const ctx = { musicPort: 3000, chatPort: 4000, chatPath: "/overlay/chat", overlays: overlays.map((o) => ({ ...o, name: "Mon overlay" })) };
    expect(idMap.get("abc123XYZ_")).toBe("nouveau123");
    // L'ancienne URL, même en variante, désigne un lien révoqué.
    expect(identifyOverlayUrl(before, ctx)).toMatchObject({ kind: "music", overlayId: "abc123XYZ_", overlayName: null });
  });
});

describe("paramètres d'affichage de la page overlay (fit)", () => {
  it("absent ou inconnu = comportement historique (taille native)", () => {
    expect(parseOverlayDisplayParams("")).toEqual({ fit: "none" });
    expect(parseOverlayDisplayParams("?fit=cover")).toEqual({ fit: "none" });
    expect(parseOverlayDisplayParams("?fit=<script>")).toEqual({ fit: "none" });
    expect(parseOverlayDisplayParams("?size=30")).toEqual({ fit: "none" });
  });
  it("contain / 1 / true activent la mise à l'échelle", () => {
    for (const v of ["contain", "CONTAIN", "1", "true", " contain "]) {
      expect(parseOverlayDisplayParams(`?fit=${encodeURIComponent(v)}`), v).toEqual({ fit: "contain" });
    }
  });
  it("échelle : canvas entièrement visible, proportions gardées, bornée", () => {
    expect(computeFitScale(1080, 1920, 800, 250)).toBeCloseTo(1.35, 5);
    expect(computeFitScale(400, 400, 800, 250)).toBe(0.5);
    expect(computeFitScale(1920, 1080, 1920, 1080)).toBe(1);
    // Source à 0 × 0 (bug signalé de certaines sources Link) ou valeurs invalides : jamais 0 ni l'infini.
    expect(computeFitScale(0, 0, 800, 250)).toBe(1);
    expect(computeFitScale(1080, 1920, 0, 250)).toBe(1);
    expect(computeFitScale(Number.NaN, 1920, 800, 250)).toBe(1);
    expect(computeFitScale(1, 1, 8000, 8000)).toBe(0.05);
    expect(computeFitScale(100_000, 100_000, 10, 10)).toBe(8);
  });
});

describe("identification d'une URL collée par l'utilisateur", () => {
  const ctx = {
    musicPort: 3000,
    chatPort: 4000,
    chatPath: "/overlay/chat",
    overlays: [{ id: "abc123XYZ_", name: "Glass principal" }],
  };
  it("overlay musical connu (localhost ou 127.0.0.1, avec ou sans fit)", () => {
    expect(identifyOverlayUrl(MUSIC_URL, ctx)).toEqual({ kind: "music", overlayId: "abc123XYZ_", overlayName: "Glass principal", host: "localhost", fit: "none" });
    expect(identifyOverlayUrl("  http://127.0.0.1:3000/overlay/abc123XYZ_/?fit=contain ", ctx)).toMatchObject({
      kind: "music",
      overlayName: "Glass principal",
      host: "127.0.0.1",
      fit: "contain",
    });
  });
  it("URL batlay.test reconnue (copiée depuis TikTok LIVE Studio)", () => {
    expect(identifyOverlayUrl("http://batlay.test:3000/overlay/abc123XYZ_?fit=contain", ctx)).toMatchObject({ kind: "music", overlayName: "Glass principal", host: "batlay.test", fit: "contain" });
    expect(identifyOverlayUrl("http://batlay.test:4000/overlay/chat?size=30", ctx)).toMatchObject({ kind: "chat", host: "batlay.test" });
  });
  it("chat, lien révoqué, port inconnu, chemin inattendu", () => {
    expect(identifyOverlayUrl(CHAT_URL, ctx)).toMatchObject({ kind: "chat", host: "localhost" });
    expect(identifyOverlayUrl("http://localhost:3000/overlay/ancien", ctx)).toMatchObject({ kind: "music", overlayName: null });
    expect(identifyOverlayUrl("http://localhost:5555/overlay/abc", ctx)).toMatchObject({ kind: "invalid" });
    expect(identifyOverlayUrl("http://localhost:3000/api/overlays/abc", ctx)).toMatchObject({ kind: "invalid" });
    expect(identifyOverlayUrl("http://localhost:4000/overlay/autre", ctx)).toMatchObject({ kind: "invalid" });
    expect(identifyOverlayUrl("http://localhost:3000/overlay/%E0%A4%A", ctx)).toMatchObject({ kind: "invalid" });
    expect(identifyOverlayUrl("https://tikfinity.example/widget", ctx)).toMatchObject({ kind: "invalid" });
    expect(identifyOverlayUrl("", ctx)).toMatchObject({ kind: "invalid" });
  });
  it("identifiants d'overlay : format nanoid uniquement", () => {
    expect(isValidOverlayId("V1StGXR8_Z")).toBe(true);
    expect(isValidOverlayId("../etc")).toBe(false);
    expect(isValidOverlayId("a b")).toBe(false);
    expect(isValidOverlayId("")).toBe(false);
    expect(isValidOverlayId("x".repeat(65))).toBe(false);
    expect(isValidOverlayId(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Vérifications (diagnostic)
// ---------------------------------------------------------------------------

describe("vérifications de compatibilité", () => {
  const base: DiagnosticInput = {
    platform: getPlatform("tiktok-live-studio"),
    musicServerRunning: true,
    musicPort: 3000,
    overlayCount: 2,
    musicClients: 0,
    chatServerRunning: true,
    chatPort: 4000,
    chatClients: 0,
  };
  const byId = (input: DiagnosticInput) => Object.fromEntries(buildDiagnostics(input).map((c) => [c.id, c]));

  it("tout en ligne, aucune source : invite à coller l'URL dans la bonne source du bon logiciel", () => {
    const checks = byId(base);
    expect(checks["music-server"].status).toBe("ok");
    expect(checks["music-clients"].status).toBe("info");
    expect(checks["music-clients"].hint).toContain("« Link (selon les versions : « Lien ») » de TikTok LIVE Studio");
    expect(checks["tiktok-fallback"]).toBeDefined();
  });
  it("sources connectées : comptées et accordées", () => {
    expect(byId({ ...base, musicClients: 1 })["music-clients"].label).toBe("1 source musicale connectée");
    expect(byId({ ...base, musicClients: 3 })["music-clients"].label).toBe("3 sources musicales connectées");
    expect(byId({ ...base, chatClients: 2 })["chat-clients"].label).toBe("2 sources de chat connectées");
  });
  it("serveur arrêté, aucun overlay, mesure indisponible", () => {
    const down = byId({ ...base, musicServerRunning: false, chatServerRunning: false });
    expect(down["music-server"].status).toBe("error");
    expect(down["chat-server"].status).toBe("error");
    expect(down["music-clients"]).toBeUndefined();
    expect(byId({ ...base, overlayCount: 0 })["music-overlays"].status).toBe("warn");
    expect(byId({ ...base, musicClients: null })["music-clients"].label).toMatch(/indisponible/);
  });
  it("le conseil de secours TikTok n'apparaît que pour TikTok", () => {
    expect(byId({ ...base, platform: getPlatform("obs") })["tiktok-fallback"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Non-régression du rendu : même moteur, même HTML
// ---------------------------------------------------------------------------

beforeAll(() => {
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    original(...args);
  });
});
afterAll(() => vi.restoreAllMocks());

describe("rendu de l'overlay : « Ajuster à la source » ne change que l'échelle", () => {
  const overlay: OverlayConfig = { ...getPreset("glass"), id: "o", name: "t", createdAt: 0, updatedAt: 0 };
  const track = { id: "t", title: "Titre", artist: "A, B", artists: ["A", "B"], duration: 1000, progress: 0, isPlaying: true };

  it("taille native (comportement historique) : un bloc à la taille du canvas, sans transformation", () => {
    const html = renderToStaticMarkup(createElement(OverlayPreview, { overlay, track, reader: null, scale: "1:1" }));
    expect(html.startsWith(`<div style="width:${overlay.theme.canvasWidth}px;height:${overlay.theme.canvasHeight}px">`)).toBe(true);
    expect(html).not.toContain("transform:scale");
  });
  it("mise à l'échelle : même contenu, enveloppé dans un scale() ancré en haut à gauche", () => {
    const native = renderToStaticMarkup(createElement(OverlayPreview, { overlay, track, reader: null, scale: "1:1" }));
    const scaled = renderToStaticMarkup(createElement(OverlayPreview, { overlay, track, reader: null, scale: 1.35 }));
    expect(scaled).toContain("transform:scale(1.35)");
    expect(scaled).toContain("transform-origin:top left");
    // Le contenu de l'overlay (composants, textes) est strictement le même.
    const inner = (html: string) => html.slice(html.indexOf('<div style="position:relative'));
    const canvas = inner(native).slice(0, -"</div>".length); // retire la fermeture de l'enveloppe native
    expect(inner(scaled)).toBe(`${canvas}</div></div>`);
    expect(canvas).toContain("A, B");
  });
});
