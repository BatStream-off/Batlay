import { describe, it, expect } from "vitest";
import {
  canvasFrameStyle,
  componentBoxStyle,
  defaultFill,
  defaultShadow,
  fillToCss,
  parseColor,
  renderTemplate,
  resolveBorder,
  resolveBoxShadow,
  shadowToCss,
  withAlpha,
} from "@/utils/overlay-style";
import { getPreset } from "@/presets";
import type { OverlayComponentConfig } from "@/types/overlay";

const comp = (type: OverlayComponentConfig["type"], style: OverlayComponentConfig["style"] = {}): OverlayComponentConfig => ({
  id: "c",
  type,
  visible: true,
  order: 0,
  transform: { x: 10, y: 20, width: 100, height: 40 },
  style,
});

describe("couleurs et transparence", () => {
  it("parse hex 3/6/8 chiffres et rgb(a)", () => {
    expect(parseColor("#fff")).toEqual([255, 255, 255, 1]);
    expect(parseColor("#9B6BFF")).toEqual([155, 107, 255, 1]);
    expect(parseColor("rgba(255,255,255,0.15)")).toEqual([255, 255, 255, 0.15]);
    expect(parseColor("red")).toBeNull();
  });
  it("withAlpha multiplie la transparence existante", () => {
    expect(withAlpha("#000000", 0.5)).toBe("rgba(0, 0, 0, 0.5)");
    expect(withAlpha("rgba(255,255,255,0.5)", 0.5)).toBe("rgba(255, 255, 255, 0.25)");
    expect(withAlpha("red", 0.5)).toBe("red"); // non reconnu : renvoyé tel quel, jamais de CSS invalide
  });
});

describe("fond : couleur, transparence, dégradé", () => {
  it("aucun / transparence 0 -> pas de fond", () => {
    expect(fillToCss(undefined)).toBeUndefined();
    expect(fillToCss(defaultFill({ mode: "none" }))).toBeUndefined();
    expect(fillToCss(defaultFill({ mode: "solid", opacity: 0 }))).toBeUndefined();
  });
  it("uni + transparence", () => {
    expect(fillToCss(defaultFill({ mode: "solid", color: "#102030", opacity: 0.4 }))).toBe("rgba(16, 32, 48, 0.4)");
  });
  it("dégradé linéaire : angle et transparence appliqués aux deux couleurs", () => {
    const css = fillToCss(
      defaultFill({ mode: "gradient", opacity: 0.5, gradient: { type: "linear", angle: 90, from: "#ff0000", to: "#0000ff" } })
    );
    expect(css).toBe("linear-gradient(90deg, rgba(255, 0, 0, 0.5), rgba(0, 0, 255, 0.5))");
  });
  it("dégradé radial", () => {
    const css = fillToCss(defaultFill({ mode: "gradient", opacity: 1, gradient: { type: "radial", angle: 0, from: "#fff", to: "#000" } }));
    expect(css).toMatch(/^radial-gradient\(circle at center/);
  });
});

describe("bordure, arrondi et ombre", () => {
  it("bordure moderne, avec repli sur les anciens champs des presets", () => {
    expect(resolveBorder({ border: { width: 3, color: "#fff", style: "dashed" } })).toMatchObject({ width: 3, style: "dashed" });
    expect(resolveBorder({ borderWidth: 2, borderColor: "#9B6BFF" })).toMatchObject({ width: 2, color: "#9B6BFF" });
    expect(resolveBorder({ border: { width: 0, color: "#fff", style: "solid" } })).toBeUndefined();
    expect(resolveBorder({})).toBeUndefined();
  });
  it("ombre personnalisée et ombre historique `shadow: true`", () => {
    expect(shadowToCss(defaultShadow({ x: 2, y: 4, blur: 10, spread: 1, color: "#000000", opacity: 0.3 }))).toBe(
      "2px 4px 10px 1px rgba(0, 0, 0, 0.3)"
    );
    expect(shadowToCss(defaultShadow({ enabled: false }))).toBeUndefined();
    expect(resolveBoxShadow({ shadow: true })).toBe("0 8px 24px -6px rgba(0,0,0,0.5)");
    expect(resolveBoxShadow({ shadow: true, boxShadow: defaultShadow({ enabled: false }) })).toBeUndefined();
  });
  it("componentBoxStyle applique fond + bordure + arrondi + ombre + géométrie", () => {
    const css = componentBoxStyle(
      comp("shape", {
        background: defaultFill({ color: "#000000", opacity: 0.5 }),
        border: { width: 2, color: "#ffffff", style: "solid" },
        borderRadius: 12,
        boxShadow: defaultShadow(),
      })
    );
    expect(css).toMatchObject({ left: 10, top: 20, width: 100, height: 40, boxSizing: "border-box", borderRadius: 12 });
    expect(css.background).toBe("rgba(0, 0, 0, 0.5)");
    expect(css.border).toBe("2px solid #ffffff");
    expect(css.boxShadow).toBeTruthy();
  });
  it("pochette ronde : rayon 50 %", () => {
    expect(componentBoxStyle(comp("artwork", { shape: "circle", borderRadius: 4 })).borderRadius).toBe("50%");
  });
  it("le fond de l'overlay entier est dessiné sur un calque dédié (les coordonnées des composants restent celles du canvas)", () => {
    const frame = canvasFrameStyle({
      canvasWidth: 800, canvasHeight: 250, padding: 0, gap: 0,
      background: defaultFill({ color: "#000000", opacity: 0.6 }),
      border: { width: 2, color: "#fff", style: "solid" },
      borderRadius: 20,
    });
    expect(frame).toMatchObject({ position: "absolute", pointerEvents: "none", borderRadius: 20 });
    expect(frame.background).toBe("rgba(0, 0, 0, 0.6)");
  });
  it("ne génère jamais de backdrop-filter (inopérant dans une Browser Source OBS)", () => {
    expect(JSON.stringify(canvasFrameStyle(getPreset("glass").theme))).not.toContain("backdrop");
    expect(JSON.stringify(componentBoxStyle(comp("shape", { background: defaultFill() })))).not.toContain("backdrop");
  });
});

describe("texte libre", () => {
  const values = { title: "Lean On", artist: "Major Lazer, DJ Snake, MØ", album: "Peace", source: "Spotify" };
  it("remplace les variables connues, laisse les autres", () => {
    expect(renderTemplate("♪ {title} — {artist} ({inconnu})", values)).toBe("♪ Lean On — Major Lazer, DJ Snake, MØ ({inconnu})");
  });
});

describe("rétrocompatibilité des presets", () => {
  it("chaque preset produit un CSS valide pour chacun de ses composants, sans champ nouveau requis", () => {
    for (const id of ["minimal", "modern", "glass", "neon", "compact", "large", "blank"] as const) {
      const preset = getPreset(id);
      expect(() => canvasFrameStyle(preset.theme)).not.toThrow();
      for (const c of preset.components) expect(() => componentBoxStyle(c)).not.toThrow();
    }
  });
  it("les bordures des presets Glass et Neon sont toujours rendues", () => {
    const neonArtwork = getPreset("neon").components.find((c) => c.type === "artwork")!;
    expect(componentBoxStyle(neonArtwork).border).toBe("2px solid #9B6BFF");
    const modernArtwork = getPreset("modern").components.find((c) => c.type === "artwork")!;
    expect(componentBoxStyle(modernArtwork).boxShadow).toBe("0 8px 24px -6px rgba(0,0,0,0.5)");
  });
});
