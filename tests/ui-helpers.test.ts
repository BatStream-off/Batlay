import { describe, it, expect } from "vitest";
import {
  SELECT_MENU_MAX_HEIGHT,
  ZOOM_MAX,
  ZOOM_MIN,
  clampZoom,
  computeMenuPlacement,
  formatRelativeDate,
  pickMainOverlay,
  stepZoom,
  validatePort,
} from "@/utils/ui-helpers";

describe("stepZoom", () => {
  it("passe au palier supérieur / inférieur depuis un palier", () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
  });

  it("depuis un zoom « ajusté » (hors palier), rejoint le palier le plus proche dans le bon sens", () => {
    expect(stepZoom(0.87, 1)).toBe(1);
    expect(stepZoom(0.87, -1)).toBe(0.75);
  });

  it("reste borné aux extrémités", () => {
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(0.25, -1)).toBe(0.25);
    expect(stepZoom(0.1, -1)).toBe(0.25);
  });
});

describe("clampZoom", () => {
  it("borne et arrondit à 2 décimales", () => {
    expect(clampZoom(0.001)).toBe(ZOOM_MIN);
    expect(clampZoom(99)).toBe(ZOOM_MAX);
    expect(clampZoom(1.23456)).toBe(1.23);
  });

  it("une valeur non finie retombe sur 100 %", () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe("validatePort", () => {
  it("accepte un port valide, en nombre ou en texte", () => {
    expect(validatePort("8945")).toEqual({ ok: true, port: 8945 });
    expect(validatePort(3000)).toEqual({ ok: true, port: 3000 });
    expect(validatePort(" 8945 ")).toEqual({ ok: true, port: 8945 });
  });

  it("refuse le vide, le texte, les décimaux et les négatifs", () => {
    for (const bad of ["", "abc", "80.5", "-1", "12e3"]) {
      expect(validatePort(bad).ok, bad).toBe(false);
    }
  });

  it("refuse les ports réservés (< 1024) et hors plage (> 65535)", () => {
    expect(validatePort(80).ok).toBe(false);
    expect(validatePort(1023).ok).toBe(false);
    expect(validatePort(1024).ok).toBe(true);
    expect(validatePort(65535).ok).toBe(true);
    expect(validatePort(65536).ok).toBe(false);
  });
});

describe("pickMainOverlay", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("renvoie l'overlay marqué principal", () => {
    expect(pickMainOverlay(list, "b")).toEqual({ id: "b" });
  });

  it("retombe sur le premier si le principal a disparu ou n'est pas défini", () => {
    expect(pickMainOverlay(list, "zzz")).toEqual({ id: "a" });
    expect(pickMainOverlay(list, null)).toEqual({ id: "a" });
  });

  it("renvoie null quand il n'y a aucun overlay", () => {
    expect(pickMainOverlay([], "a")).toBeNull();
  });
});

describe("formatRelativeDate", () => {
  const now = 1_700_000_000_000;

  it("formule les écarts récents en français", () => {
    expect(formatRelativeDate(now - 10_000, now)).toBe("à l'instant");
    expect(formatRelativeDate(now - 5 * 60_000, now)).toBe("il y a 5 min");
    expect(formatRelativeDate(now - 3 * 3_600_000, now)).toBe("il y a 3 h");
    expect(formatRelativeDate(now - 30 * 3_600_000, now)).toBe("hier");
    expect(formatRelativeDate(now - 4 * 86_400_000, now)).toBe("il y a 4 j");
  });

  it("un horodatage absent (0) ne produit aucun texte, et une horloge en retard ne donne pas de valeur négative", () => {
    expect(formatRelativeDate(0, now)).toBe("");
    expect(formatRelativeDate(now + 5_000, now)).toBe("à l'instant");
  });
});

describe("computeMenuPlacement", () => {
  it("ouvre vers le bas avec la hauteur maximale quand la place suffit", () => {
    expect(computeMenuPlacement(100, 140, 900)).toEqual({ openUp: false, maxHeight: SELECT_MENU_MAX_HEIGHT });
  });

  it("ouvre vers le haut quand il manque de la place dessous et qu'il y en a plus dessus", () => {
    const placement = computeMenuPlacement(700, 740, 800);
    expect(placement.openUp).toBe(true);
    expect(placement.maxHeight).toBe(SELECT_MENU_MAX_HEIGHT);
  });

  it("reste vers le bas mais réduit la hauteur si aucun côté n'a assez de place", () => {
    const placement = computeMenuPlacement(150, 190, 400);
    expect(placement.openUp).toBe(false);
    expect(placement.maxHeight).toBe(202);
  });

  it("ne descend jamais sous le plancher d'utilisabilité", () => {
    expect(computeMenuPlacement(10, 50, 60).maxHeight).toBe(80);
  });
});
