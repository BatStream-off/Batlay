import { describe, it, expect, beforeEach } from "vitest";
import { regenerateObsIds } from "@/utils/obs-link";
import { rekeyUnsavedDrafts, unsavedDrafts } from "@/utils/unsaved-drafts";
import type { OverlayConfig } from "@/types/overlay";

/** Générateur déterministe : n1, n2, n3... */
function counter(prefix = "n") {
  let i = 0;
  return () => `${prefix}${++i}`;
}

const overlays = [
  { id: "a", name: "A", updatedAt: 100 },
  { id: "b", name: "B", updatedAt: 200 },
  { id: "c", name: "C", updatedAt: 300 },
];

describe("regenerateObsIds", () => {
  it("ne change que l'overlay ciblé et laisse le reste intact (updatedAt compris)", () => {
    const result = regenerateObsIds(overlays, null, ["b"], counter());
    expect(result.overlays.map((o) => o.id)).toEqual(["a", "n1", "c"]);
    expect(result.overlays[1]).toEqual({ id: "n1", name: "B", updatedAt: 200 });
    expect(result.overlays[0]).toBe(overlays[0]);
    expect([...result.idMap]).toEqual([["b", "n1"]]);
  });

  it("régénère tous les overlays avec « all », chacun avec un id différent", () => {
    const result = regenerateObsIds(overlays, null, "all", counter());
    expect(result.overlays.map((o) => o.id)).toEqual(["n1", "n2", "n3"]);
    expect(result.idMap.size).toBe(3);
  });

  it("ne mute pas la liste d'origine", () => {
    regenerateObsIds(overlays, "a", "all", counter());
    expect(overlays.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("l'overlay principal suit son nouvel id", () => {
    expect(regenerateObsIds(overlays, "b", ["b"], counter()).activeOverlayId).toBe("n1");
    expect(regenerateObsIds(overlays, "b", "all", counter()).activeOverlayId).toBe("n2");
  });

  it("laisse l'overlay principal tel quel s'il n'est pas concerné (ou s'il n'y en a pas)", () => {
    expect(regenerateObsIds(overlays, "a", ["b"], counter()).activeOverlayId).toBe("a");
    expect(regenerateObsIds(overlays, null, "all", counter()).activeOverlayId).toBeNull();
  });

  it("ne régénère rien pour un id inconnu ou une liste vide", () => {
    const unknown = regenerateObsIds(overlays, null, ["zzz"], counter());
    expect(unknown.idMap.size).toBe(0);
    expect(unknown.overlays.map((o) => o.id)).toEqual(["a", "b", "c"]);
    expect(regenerateObsIds([], null, "all", counter()).idMap.size).toBe(0);
  });

  it("ne réutilise jamais un id existant, y compris l'ancien id de l'overlay (sinon l'ancien lien vivrait encore)", () => {
    // Le générateur ressort d'abord « b » (l'ancien id) puis « c » (celui d'un autre overlay).
    const queue = ["b", "c", "frais"];
    const result = regenerateObsIds(overlays, null, ["b"], () => queue.shift()!);
    expect(result.overlays[1].id).toBe("frais");
  });

  it("garantit l'unicité entre les ids générés lors d'une régénération globale", () => {
    const queue = ["x", "x", "y", "y", "z"];
    const result = regenerateObsIds(overlays, null, "all", () => queue.shift()!);
    expect(result.overlays.map((o) => o.id)).toEqual(["x", "y", "z"]);
  });

  it("échoue plutôt que de boucler si le générateur ne produit que des collisions", () => {
    expect(() => regenerateObsIds(overlays, null, ["b"], () => "a")).toThrow(/unique/);
  });
});

describe("rekeyUnsavedDrafts", () => {
  const draftOf = (id: string) => ({ id, name: `brouillon ${id}` }) as OverlayConfig;

  beforeEach(() => unsavedDrafts.clear());

  it("rattache le brouillon au nouvel id et le réécrit dans le brouillon lui-même", () => {
    unsavedDrafts.set("a", { draft: draftOf("a"), baseUpdatedAt: 100 });
    rekeyUnsavedDrafts(new Map([["a", "n1"]]));

    expect(unsavedDrafts.has("a")).toBe(false);
    const moved = unsavedDrafts.get("n1")!;
    expect(moved.draft.id).toBe("n1");
    expect(moved.draft.name).toBe("brouillon a");
    // La base ne bouge pas : le brouillon reste réutilisable (updatedAt n'a pas changé).
    expect(moved.baseUpdatedAt).toBe(100);
  });

  it("ignore les overlays sans brouillon et n'en touche aucun autre", () => {
    unsavedDrafts.set("c", { draft: draftOf("c"), baseUpdatedAt: 300 });
    rekeyUnsavedDrafts(new Map([["a", "n1"]]));
    expect([...unsavedDrafts.keys()]).toEqual(["c"]);
  });
});
