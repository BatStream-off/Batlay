import { describe, it, expect } from "vitest";
import {
  addComponent,
  alignInCanvas,
  createComponent,
  duplicateComponent,
  moveLayer,
  normalizeOrder,
  removeComponent,
  reorderTo,
  COMPONENT_TYPES,
} from "@/utils/overlay-model";
import { getPreset } from "@/presets";
import type { OverlayComponentConfig } from "@/types/overlay";

const canvas = { width: 800, height: 250 };
const build = (n: number): OverlayComponentConfig[] => {
  let list: OverlayComponentConfig[] = [];
  for (let i = 0; i < n; i++) list = addComponent(list, createComponent("shape", canvas, list));
  return list;
};
const ids = (list: OverlayComponentConfig[]) => [...list].sort((a, b) => a.order - b.order).map((c) => c.id);

describe("ajout de composants", () => {
  it("chaque type peut être créé, avec une géométrie valide dans le canvas", () => {
    for (const type of COMPONENT_TYPES) {
      const c = createComponent(type, canvas, []);
      expect(c.type).toBe(type);
      expect(c.transform.width).toBeGreaterThan(0);
      expect(c.transform.x).toBeGreaterThanOrEqual(0);
      expect(c.transform.x + c.transform.width).toBeLessThanOrEqual(canvas.width);
      expect(c.transform.y + c.transform.height).toBeLessThanOrEqual(canvas.height);
    }
  });

  it("un composant plus grand que le canvas est ramené à ses dimensions", () => {
    const c = createComponent("progressBar", { width: 100, height: 20 }, []);
    expect(c.transform.width).toBe(100);
  });

  it("les ajouts successifs sont empilés vers le haut et légèrement décalés", () => {
    const list = build(3);
    expect(list.map((c) => c.order)).toEqual([0, 1, 2]);
    expect(new Set(list.map((c) => `${c.transform.x},${c.transform.y}`)).size).toBe(3);
  });

  it("le texte libre reçoit un contenu par défaut", () => {
    expect(createComponent("text", canvas, []).content).toBeTruthy();
  });

  it("aucune mutation des préréglages : un overlay vide part bien de zéro", () => {
    const blank = getPreset("blank");
    expect(blank.components).toEqual([]);
    const added = addComponent(blank.components, createComponent("title", canvas, blank.components));
    expect(added).toHaveLength(1);
    expect(getPreset("blank").components).toHaveLength(0);
  });
});

describe("suppression et duplication", () => {
  it("supprime et renumérote sans trou", () => {
    const list = build(4);
    const next = removeComponent(list, list[1].id);
    expect(next).toHaveLength(3);
    expect(next.map((c) => c.order).sort()).toEqual([0, 1, 2]);
  });

  it("duplique : copie indépendante, décalée, juste au-dessus de l'original", () => {
    const list = build(3);
    const original = list[1];
    const { components, newId } = duplicateComponent(list, original.id);
    expect(components).toHaveLength(4);
    const copy = components.find((c) => c.id === newId)!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.transform.x).toBe(original.transform.x + 16);
    expect(ids(components).indexOf(copy.id)).toBe(ids(components).indexOf(original.id) + 1);
    // indépendance : modifier la copie ne touche pas l'original
    copy.style.borderRadius = 999;
    expect(original.style.borderRadius).not.toBe(999);
  });

  it("dupliquer un id inconnu ne change rien", () => {
    const list = build(2);
    expect(duplicateComponent(list, "nope")).toEqual({ components: list, newId: null });
  });
});

describe("réorganisation", () => {
  it("front / back / forward / backward", () => {
    const list = build(4);
    const [a, b, c, d] = ids(list);
    expect(ids(moveLayer(list, a, "front"))).toEqual([b, c, d, a]);
    expect(ids(moveLayer(list, d, "back"))).toEqual([d, a, b, c]);
    expect(ids(moveLayer(list, b, "forward"))).toEqual([a, c, b, d]);
    expect(ids(moveLayer(list, c, "backward"))).toEqual([a, c, b, d]);
  });

  it("reorderTo (glisser-déposer) place le calque à l'index voulu, borné", () => {
    const list = build(4);
    const [a, b, c, d] = ids(list);
    expect(ids(reorderTo(list, a, 2))).toEqual([b, c, a, d]);
    expect(ids(reorderTo(list, d, -5))).toEqual([d, a, b, c]);
    expect(ids(reorderTo(list, a, 99))).toEqual([b, c, d, a]);
  });

  it("normalizeOrder reste stable sur des `order` en double ou décimaux", () => {
    const list = build(3).map((c, i) => ({ ...c, order: [5, 5, 1.5][i] }));
    expect(normalizeOrder(list).map((c) => c.order)).toEqual([0, 1, 2]);
  });

  it("les presets existants s'importent tels quels (rétrocompatibilité)", () => {
    const modern = getPreset("modern");
    expect(normalizeOrder(modern.components)).toHaveLength(modern.components.length);
  });
});

describe("alignement sur le canvas", () => {
  const t = { x: 13, y: 7, width: 100, height: 50 };
  it("gauche / centre / droite / haut / milieu / bas", () => {
    expect(alignInCanvas(t, canvas, "left").x).toBe(0);
    expect(alignInCanvas(t, canvas, "centerH").x).toBe(350);
    expect(alignInCanvas(t, canvas, "right").x).toBe(700);
    expect(alignInCanvas(t, canvas, "top").y).toBe(0);
    expect(alignInCanvas(t, canvas, "middleV").y).toBe(100);
    expect(alignInCanvas(t, canvas, "bottom").y).toBe(200);
  });
});
