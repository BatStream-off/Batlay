import { describe, it, expect } from "vitest";
import { getPreset, listPresetIds } from "@/presets";

describe("Presets", () => {
  it("expose exactement les 7 presets requis", () => {
    expect(listPresetIds().sort()).toEqual(
      ["blank", "compact", "glass", "large", "minimal", "modern", "neon"].sort()
    );
  });

  it("chaque preset a un thème avec des dimensions positives", () => {
    for (const id of listPresetIds()) {
      const preset = getPreset(id);
      expect(preset.theme.canvasWidth).toBeGreaterThan(0);
      expect(preset.theme.canvasHeight).toBeGreaterThan(0);
    }
  });

  it("le preset blank n'a aucun composant", () => {
    expect(getPreset("blank").components).toHaveLength(0);
  });

  it("les presets non-blank ont au moins artwork/title/artist", () => {
    for (const id of listPresetIds().filter((p) => p !== "blank")) {
      const preset = getPreset(id);
      const types = preset.components.map((c) => c.type);
      expect(types).toContain("artwork");
      expect(types).toContain("title");
      expect(types).toContain("artist");
    }
  });

  it("getPreset retourne une copie indépendante à chaque appel", () => {
    const a = getPreset("modern");
    const b = getPreset("modern");
    a.components[0].transform.x = 999;
    expect(b.components[0].transform.x).not.toBe(999);
  });
});
