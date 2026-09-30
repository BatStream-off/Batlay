import { describe, it, expect } from "vitest";
import { normalizePointer } from "@/utils/pointer-effects";

describe("normalizePointer", () => {
  it("renvoie 0 au centre de la fenêtre et ±1 aux bords", () => {
    expect(normalizePointer(500, 300, 1000, 600)).toEqual({ x: 0, y: 0 });
    expect(normalizePointer(0, 0, 1000, 600)).toEqual({ x: -1, y: -1 });
    expect(normalizePointer(1000, 600, 1000, 600)).toEqual({ x: 1, y: 1 });
  });

  it("borne les positions hors fenêtre (pointeur qui sort pendant un glisser)", () => {
    expect(normalizePointer(-50, 9999, 1000, 600)).toEqual({ x: -1, y: 1 });
  });

  it("ne produit jamais NaN si la fenêtre n'a pas de taille", () => {
    expect(normalizePointer(10, 10, 0, 0)).toEqual({ x: 0, y: 0 });
  });
});
