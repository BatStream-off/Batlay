import { describe, it, expect } from "vitest";
import { MAX_IMPORT_BYTES, parseOverlayImport, uniqueOverlayName } from "@/utils/overlay-import";
import { getPreset } from "@/presets";

const makeId = () => "nouvel-id";

/** Ce que produit « Exporter (.json) » : un OverlayConfig complet avec son ancien id. */
function exported(overrides: Record<string, unknown> = {}): string {
  const overlay = { ...getPreset("modern"), id: "ancien-id", name: "Mon overlay", createdAt: 1, updatedAt: 2, ...overrides };
  return JSON.stringify(overlay, null, 2);
}

describe("parseOverlayImport", () => {
  it("accepte un export Batlay et lui donne un nouvel id (jamais celui du fichier)", () => {
    const result = parseOverlayImport(exported(), [], makeId, 1000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // L'id est le lien OBS : réutiliser celui du fichier partagerait le lien de l'original.
    expect(result.overlay.id).toBe("nouvel-id");
    expect(result.overlay.name).toBe("Mon overlay");
    expect(result.overlay.createdAt).toBe(1000);
    expect(result.overlay.updatedAt).toBe(1000);
    expect(result.overlay.components.length).toBe(getPreset("modern").components.length);
    expect(result.overlay.presetId).toBe("modern");
  });

  it("renomme l'overlay si le nom existe déjà", () => {
    const result = parseOverlayImport(exported(), ["mon overlay"], makeId);
    expect(result.ok && result.overlay.name).toBe("Mon overlay (2)");
  });

  it("refuse un fichier qui n'est pas du JSON", () => {
    const result = parseOverlayImport("pas du json {", [], makeId);
    expect(result).toEqual({ ok: false, reason: "Ce fichier n'est pas un JSON valide." });
  });

  it("refuse un JSON qui n'est pas un objet (tableau, nombre, null)", () => {
    for (const text of ["[]", "42", "null", '"texte"']) {
      expect(parseOverlayImport(text, [], makeId).ok).toBe(false);
    }
  });

  it("refuse une version de schéma inconnue", () => {
    const result = parseOverlayImport(exported({ schemaVersion: 2 }), [], makeId);
    expect(result.ok).toBe(false);
  });

  it("refuse un canvas absent ou hors limites", () => {
    const base = getPreset("modern");
    expect(parseOverlayImport(exported({ theme: { ...base.theme, canvasWidth: 5 } }), [], makeId).ok).toBe(false);
    expect(parseOverlayImport(exported({ theme: { ...base.theme, canvasHeight: 99999 } }), [], makeId).ok).toBe(false);
    expect(parseOverlayImport(exported({ theme: undefined }), [], makeId).ok).toBe(false);
  });

  it("refuse un composant de type inconnu et dit lequel", () => {
    const components = [...getPreset("modern").components, { id: "x", type: "virus", transform: { x: 0, y: 0, width: 1, height: 1 }, style: {} }];
    const result = parseOverlayImport(exported({ components }), [], makeId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain(`Composant n°${components.length}`);
  });

  it("refuse un composant dont la position n'est pas numérique", () => {
    const bad = { id: "x", type: "title", transform: { x: "0", y: 0, width: 10, height: 10 }, style: {} };
    expect(parseOverlayImport(exported({ components: [bad] }), [], makeId).ok).toBe(false);
  });

  it("complète le thème et les animations manquants avec ceux d'un overlay vide", () => {
    const result = parseOverlayImport(exported({ theme: { canvasWidth: 400, canvasHeight: 100 }, animations: undefined }), [], makeId);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overlay.theme.canvasWidth).toBe(400);
    expect(result.overlay.theme.padding).toBe(getPreset("blank").theme.padding);
    expect(result.overlay.animations).toEqual(getPreset("blank").animations);
  });

  it("retombe sur « blank » si le preset du fichier est inconnu", () => {
    const result = parseOverlayImport(exported({ presetId: "inconnu" }), [], makeId);
    expect(result.ok && result.overlay.presetId).toBe("blank");
  });

  it("ne recopie pas les champs inconnus du fichier", () => {
    const result = parseOverlayImport(exported({ secret: "x" }), [], makeId);
    expect(result.ok).toBe(true);
    if (result.ok) expect("secret" in result.overlay).toBe(false);
  });

  it("refuse un fichier démesuré sans essayer de le lire", () => {
    const result = parseOverlayImport("x".repeat(MAX_IMPORT_BYTES + 1), [], makeId);
    expect(result.ok).toBe(false);
  });
});

describe("uniqueOverlayName", () => {
  it("garde le nom s'il est libre", () => {
    expect(uniqueOverlayName("Stream", ["Autre"])).toBe("Stream");
  });

  it("incrémente sans tenir compte de la casse", () => {
    expect(uniqueOverlayName("Stream", ["stream", "Stream (2)"])).toBe("Stream (3)");
  });

  it("propose un nom par défaut pour un nom vide", () => {
    expect(uniqueOverlayName("   ", [])).toBe("Overlay importé");
  });
});
