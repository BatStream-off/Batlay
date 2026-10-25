import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { componentContentKey, NO_TRACK_KEY } from "@/utils/overlay-motion";
import { isStalePlayback, STALE_WINDOW_MS } from "@/utils/playback-order";
import { OverlayCanvas, SAMPLE_TRACK, SAMPLE_TRACK_ALT } from "@/components/OverlayPreview";
import { AnimationProvider } from "@/animation/react";
import { getPreset, listPresetIds } from "@/presets";
import { parseOverlayImport } from "@/utils/overlay-import";
import { DEFAULT_OVERLAY_ANIMATION } from "@/animation/config";
import type { OverlayComponentConfig, OverlayConfig } from "@/types/overlay";
import type { Track } from "@/types/track";
import {
  DEFAULT_OPTIONS,
  buildOverlaySearch,
  chatMotion,
  parseOverlayOptions,
} from "../twitch-overlay/chat-feed";

beforeAll(() => {
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    original(...args);
  });
});
afterAll(() => vi.restoreAllMocks());

const comp = (type: OverlayComponentConfig["type"], extra: Partial<OverlayComponentConfig> = {}) =>
  ({ id: type, type, visible: true, order: 0, transform: { x: 0, y: 0, width: 10, height: 10 }, style: {}, ...extra }) as OverlayComponentConfig;

describe("overlay musique : identité du contenu de chaque composant", () => {
  it("changement de morceau : titre, artistes, album, pochette changent de clé", () => {
    for (const type of ["title", "artist", "album", "artwork"] as const) {
      const a = componentContentKey(comp(type), { ...SAMPLE_TRACK, artwork: "/api/artwork/1" });
      const b = componentContentKey(comp(type), { ...SAMPLE_TRACK_ALT, artwork: "/api/artwork/2" });
      expect(a, type).not.toBe(b);
    }
  });
  it("barre, temps et formes ne « changent » pas d'un morceau à l'autre (aucune transition parasite)", () => {
    for (const type of ["progressBar", "elapsedTime", "remainingTime", "shape"] as const) {
      expect(componentContentKey(comp(type), SAMPLE_TRACK), type).toBe(componentContentKey(comp(type), SAMPLE_TRACK_ALT));
    }
  });
  it("seule la pochette change quand elle arrive après le titre (Lecture système)", () => {
    const before = { ...SAMPLE_TRACK, artwork: undefined };
    const after = { ...SAMPLE_TRACK, artwork: "/api/artwork/abc" };
    expect(componentContentKey(comp("artwork"), before)).not.toBe(componentContentKey(comp("artwork"), after));
    expect(componentContentKey(comp("title"), before)).toBe(componentContentKey(comp("title"), after));
  });
  it("accents et plusieurs artistes conservés dans la clé ; séparateur choisi pris en compte", () => {
    const key = componentContentKey(comp("artist", { style: { artistSeparator: " & " } }), SAMPLE_TRACK_ALT);
    expect(key).toBe("artist:Angèle & Roméo Elvis");
    expect(componentContentKey(comp("text", { content: "{title} — {artist}" }), SAMPLE_TRACK_ALT)).toBe("text:Tout oublier — Angèle, Roméo Elvis");
  });
  it("aucun morceau : clé dédiée (sortie animée de l'overlay)", () => {
    expect(componentContentKey(comp("title"), null)).toBe(NO_TRACK_KEY);
    expect(componentContentKey(comp("shape"), null)).toBe(NO_TRACK_KEY);
  });
});

describe("mises à jour tardives : l'ancien morceau ne revient jamais", () => {
  it("un état mesuré avant celui affiché est ignoré", () => {
    expect(isStalePlayback({ updatedAt: 10_000 }, { updatedAt: 9_000 })).toBe(true);
    expect(isStalePlayback({ updatedAt: 10_000 }, { updatedAt: 10_000 })).toBe(false); // ré-émission (pochette arrivée)
    expect(isStalePlayback({ updatedAt: 10_000 }, { updatedAt: 10_001 })).toBe(false);
    expect(isStalePlayback(null, { updatedAt: 1 })).toBe(false);
  });
  it("un saut d'horloge (Batlay relancé, heure resynchronisée) n'immobilise jamais l'overlay", () => {
    expect(isStalePlayback({ updatedAt: 100_000 }, { updatedAt: 100_000 - STALE_WINDOW_MS - 1 })).toBe(false);
    expect(isStalePlayback({ updatedAt: Number.NaN }, { updatedAt: 5 })).toBe(false);
  });
});

const overlayFrom = (id: Parameters<typeof getPreset>[0]): OverlayConfig => ({ ...getPreset(id), id: "o", name: "t", createdAt: 0, updatedAt: 0 });
const render = (overlay: OverlayConfig, track: Track | null, animated: boolean) =>
  renderToStaticMarkup(
    animated
      ? createElement(AnimationProvider, null, createElement(OverlayCanvas, { overlay, track, reader: null }))
      : createElement(OverlayCanvas, { overlay, track, reader: null })
  );

describe("non-régression du rendu et des presets", () => {
  it("les six presets s'affichent à l'identique avec ou sans contexte d'animation (premier rendu)", () => {
    for (const id of ["minimal", "modern", "glass", "neon", "compact", "large"] as const) {
      const overlay = overlayFrom(id);
      // Au premier rendu, l'état animé est porté par Web Animations (après montage) : le HTML est le même.
      expect(render(overlay, SAMPLE_TRACK_ALT, true), id).toBe(render(overlay, SAMPLE_TRACK_ALT, false));
      expect(render(overlay, SAMPLE_TRACK_ALT, false), id).toContain("Angèle, Roméo Elvis");
    }
  });
  it("sans musique : canvas vide, comme avant", () => {
    const html = render(overlayFrom("glass"), null, true);
    expect(html).not.toContain("<style>");
    expect(html).toMatch(/^<div style="[^"]*"><\/div>$/);
  });
  it("presets et anciens overlays : aucune donnée d'animation obligatoire ajoutée", () => {
    for (const id of listPresetIds()) {
      const a = getPreset(id).animations;
      expect(Object.keys(a).sort(), id).toEqual(["durationMs", "easing", "enter", "exit"]);
    }
  });
  it("import : animations d'un ancien export conservées, valeurs invalides corrigées", () => {
    const exported = (animations: unknown, components: unknown[] = []) =>
      JSON.stringify({ schemaVersion: 1, name: "x", presetId: "glass", theme: { canvasWidth: 400, canvasHeight: 100 }, components, animations });
    const legacy = parseOverlayImport(exported({ enter: "slideLeft", exit: "slideRight", durationMs: 350, easing: "ease-out" }), [], () => "id1");
    expect(legacy.ok && legacy.overlay.animations).toMatchObject({ enter: "slideLeft", exit: "slideRight", durationMs: 350, easing: "ease-out" });
    const bad = parseOverlayImport(exported({ enter: "<script>", durationMs: -1, easing: "url(evil)" }), [], () => "id2");
    expect(bad.ok && bad.overlay.animations).toMatchObject({ enter: DEFAULT_OVERLAY_ANIMATION.enter, durationMs: 50, easing: DEFAULT_OVERLAY_ANIMATION.easing });
    const badComponent = parseOverlayImport(
      exported(undefined, [{ id: "c", type: "title", visible: true, order: 0, transform: { x: 0, y: 0, width: 1, height: 1 }, style: {}, animation: "pulse" }]),
      [],
      () => "id3"
    );
    expect(badComponent.ok && badComponent.overlay.components[0].animation).toBeUndefined();
  });
});

describe("chat : paramètres d'animation dans l'URL", () => {
  it("anciennes URL inchangées : aucun nouveau paramètre écrit pour les réglages par défaut", () => {
    expect(buildOverlaySearch(DEFAULT_OPTIONS)).toBe("");
    const old = "?size=28&max=15&fade=30&badges=0&bg=1&opacity=70&font=mono&shadow=0&nocmd=1&top=1&w=420&h=640";
    const parsed = parseOverlayOptions(old);
    expect(parsed).toMatchObject({ enterEffect: "slideUp", exitEffect: "fade", animMs: 180, motion: "auto" });
    expect(buildOverlaySearch(parsed)).toBe(old);
  });
  it("aller-retour des nouveaux paramètres (URL compacte)", () => {
    const options = { ...DEFAULT_OPTIONS, enterEffect: "pop" as const, exitEffect: "slideLeft" as const, animMs: 300, motion: "on" as const };
    const search = buildOverlaySearch(options);
    expect(search).toBe("?anim=pop&out=slideLeft&ad=300&motion=on");
    expect(parseOverlayOptions(search)).toEqual(options);
  });
  it("valeurs absentes ou invalides → défauts", () => {
    expect(parseOverlayOptions("?anim=explode&out=<x>&ad=-5&motion=maybe")).toMatchObject({ enterEffect: "slideUp", exitEffect: "fade", animMs: 180, motion: "auto" });
    expect(parseOverlayOptions("?ad=99999").animMs).toBe(2000);
    expect(parseOverlayOptions("?ad=10").animMs).toBe(50);
  });
  it("arrivée par défaut = l'ancienne animation CSS (montée de 0,4 em, 180 ms, ease-out)", () => {
    const m = chatMotion(DEFAULT_OPTIONS, false);
    expect(m.enter).toEqual({ effect: "slideUp", durationMs: 180, delayMs: 0, easing: "ease-out", intensity: 0.3 });
    expect(m.distance("slideUp")).toBe("0.4em");
    expect(m.distance("slideLeft")).toBe("1.5em");
  });
  it("désactivation : motion=off, mouvement réduit respecté (auto), forcé (on), effets « none »", () => {
    expect(chatMotion({ ...DEFAULT_OPTIONS, motion: "off" }, false)).toMatchObject({ enter: null, exit: null });
    expect(chatMotion(DEFAULT_OPTIONS, true)).toMatchObject({ enter: null, exit: null });
    expect(chatMotion({ ...DEFAULT_OPTIONS, motion: "on" }, true).enter).not.toBeNull();
    expect(chatMotion({ ...DEFAULT_OPTIONS, enterEffect: "none", exitEffect: "none" }, false)).toMatchObject({ enter: null, exit: null });
  });
});
