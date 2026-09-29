import { describe, it, expect } from "vitest";
import { resizeRect, snapRect, type Rect } from "@/utils/editor-geometry";

const r: Rect = { x: 100, y: 50, width: 200, height: 100 };

describe("resizeRect", () => {
  it("poignée est : le bord gauche reste fixe", () => {
    expect(resizeRect(r, "e", 30, 0)).toEqual({ x: 100, y: 50, width: 230, height: 100 });
  });
  it("poignée ouest : le bord DROIT reste fixe", () => {
    const out = resizeRect(r, "w", -40, 0);
    expect(out).toEqual({ x: 60, y: 50, width: 240, height: 100 });
    expect(out.x + out.width).toBe(300);
  });
  it("poignée nord-ouest : le coin sud-est reste fixe", () => {
    const out = resizeRect(r, "nw", 20, 10);
    expect(out.x + out.width).toBe(300);
    expect(out.y + out.height).toBe(150);
  });
  it("jamais de taille négative ni sous le minimum, même en tirant trop loin", () => {
    const out = resizeRect(r, "e", -1000, 0, { minSize: 10 });
    expect(out.width).toBe(10);
    const west = resizeRect(r, "w", 1000, 0, { minSize: 10 });
    expect(west.width).toBe(10);
    expect(west.x + west.width).toBe(300); // bord droit toujours fixe
  });
  it("Maj (keepAspect) : conserve le rapport sur une poignée d'angle", () => {
    const out = resizeRect(r, "se", 100, 5, { keepAspect: true });
    expect(out.width / out.height).toBeCloseTo(2, 1);
  });
  it("Alt (fromCenter) : le centre reste fixe", () => {
    const out = resizeRect(r, "e", 20, 0, { fromCenter: true });
    expect(out.x + out.width / 2).toBe(200);
    expect(out.width).toBe(240);
  });
});

describe("snapRect", () => {
  const canvas = { width: 800, height: 250 };
  it("s'aligne sur le bord du canvas à moins de 6 px", () => {
    const out = snapRect({ x: 4, y: 100, width: 50, height: 50 }, [], canvas, 6);
    expect(out.rect.x).toBe(0);
    expect(out.guides).toContainEqual({ axis: "x", position: 0 });
  });
  it("s'aligne sur le centre du canvas", () => {
    const out = snapRect({ x: 373, y: 10, width: 50, height: 20 }, [], canvas, 6);
    expect(out.rect.x + 25).toBe(400);
  });
  it("s'aligne sur les bords d'un autre composant", () => {
    const other: Rect = { x: 200, y: 60, width: 100, height: 40 };
    const out = snapRect({ x: 297, y: 300, width: 40, height: 20 }, [other], { width: 2000, height: 2000 }, 6);
    expect(out.rect.x).toBe(300); // bord gauche sur le bord droit de l'autre
  });
  it("ne bouge pas quand rien n'est à portée", () => {
    const out = snapRect({ x: 120, y: 90, width: 50, height: 20 }, [], canvas, 6);
    expect(out.rect).toMatchObject({ x: 120, y: 90 });
    expect(out.guides).toEqual([]);
  });
});
