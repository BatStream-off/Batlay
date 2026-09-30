import { describe, it, expect } from "vitest";
import { NAV_GROUPS } from "@/layouts/nav";

const routes = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));

describe("navigation : ordre du menu", () => {
  it("trois blocs, sans titres de section", () => {
    expect(NAV_GROUPS.map((g) => g.items.map((i) => i.label))).toEqual([
      ["Vue d'ensemble", "Overlays"],
      ["Lecture en cours", "Chat Twitch", "Connexions"],
      ["Paramètres"],
    ]);
    for (const g of NAV_GROUPS) expect(g.label).toBeNull();
  });
  it("routes dans l'ordre : /, /overlays, /musique, /chat, /connections, /settings", () => {
    expect(routes).toEqual(["/", "/overlays", "/musique", "/chat", "/connections", "/settings"]);
  });
  it("routes uniques", () => {
    expect(new Set(routes).size).toBe(routes.length);
  });
  it("conserve les routes historiques", () => {
    for (const r of ["/overlays", "/connections", "/settings"]) expect(routes).toContain(r);
  });
});
