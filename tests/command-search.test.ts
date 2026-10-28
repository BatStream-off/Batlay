import { describe, it, expect } from "vitest";
import { fold, searchCommands } from "@/utils/command-search";

const cmds = [
  { id: "1", title: "Vue d'ensemble", group: "Aller à" },
  { id: "2", title: "Paramètres", group: "Aller à", keywords: "reglages options" },
  { id: "3", title: "Copier l'URL des alertes", group: "Copier", keywords: "follow lien obs" },
  { id: "4", title: "Copier l'URL du chat", group: "Copier", keywords: "twitch tiktok lien obs" },
  { id: "5", title: "Tester l'alerte « Nouveau follower »", group: "Alertes", keywords: "essai" },
];

describe("palette de commandes : recherche", () => {
  it("sans accents ni majuscules", () => {
    expect(fold("Paramètres É")).toBe("parametres e");
    expect(searchCommands(cmds, "parametres").map((c) => c.id)).toEqual(["2"]);
    expect(searchCommands(cmds, "RÉGLAGES").map((c) => c.id)).toEqual(["2"]);
  });
  it("tous les mots doivent correspondre, le titre compte plus que les mots-clés", () => {
    expect(searchCommands(cmds, "copier chat").map((c) => c.id)).toEqual(["4"]);
    expect(searchCommands(cmds, "follow").map((c) => c.id)).toEqual(["5", "3"]);
    expect(searchCommands(cmds, "obs").map((c) => c.id)).toEqual(["3", "4"]);
    expect(searchCommands(cmds, "introuvable")).toEqual([]);
  });
  it("requête vide : tout, dans l'ordre", () => {
    expect(searchCommands(cmds, "   ").map((c) => c.id)).toEqual(["1", "2", "3", "4", "5"]);
  });
});
