/**
 * Régénération des liens OBS (fonction pure, testée dans tests/obs-link.test.ts).
 *
 * L'URL OBS d'un overlay est `http://localhost:<port>/overlay/<id>` : le lien
 * et l'identité de l'overlay partagent le même identifiant (la page overlay,
 * servie statiquement, ne connaît que lui). Régénérer un lien revient donc à
 * donner un nouvel `id` à l'overlay : le serveur ne connaît alors plus
 * l'ancien, qui cesse de fonctionner (voir OverlayServer.setOverlayConfigs).
 */

export interface RegenerationResult<T extends { id: string }> {
  overlays: T[];
  /** Suit l'overlay principal : sinon il « disparaîtrait » au profit du premier de la liste. */
  activeOverlayId: string | null;
  /** ancien id -> nouvel id, uniquement pour les overlays réellement changés. */
  idMap: Map<string, string>;
}

/** Garde-fou : nanoid ne collisionne pas en pratique, mais une boucle infinie serait pire qu'une erreur. */
const MAX_ATTEMPTS = 20;

/**
 * Donne un nouvel id aux overlays ciblés (`"all"` = tous), sans toucher au
 * reste : `updatedAt` reste inchangé, car ce n'est pas une modification du
 * contenu (« modifié il y a… » ne doit pas mentir).
 *
 * Le nouvel id ne peut jamais valoir un id déjà présent — y compris l'ancien
 * id d'un overlay régénéré : sinon l'ancien lien continuerait de marcher.
 */
export function regenerateObsIds<T extends { id: string }>(
  overlays: readonly T[],
  activeOverlayId: string | null,
  target: readonly string[] | "all",
  generateId: () => string
): RegenerationResult<T> {
  const targeted = target === "all" ? null : new Set(target);
  const taken = new Set(overlays.map((o) => o.id));
  const idMap = new Map<string, string>();

  const next = overlays.map((overlay) => {
    if (targeted && !targeted.has(overlay.id)) return overlay;

    let id = generateId();
    for (let attempt = 1; taken.has(id); attempt++) {
      if (attempt >= MAX_ATTEMPTS) throw new Error("Impossible de générer un identifiant de lien unique.");
      id = generateId();
    }
    taken.add(id);
    idMap.set(overlay.id, id);
    return { ...overlay, id };
  });

  return {
    overlays: next,
    activeOverlayId: activeOverlayId === null ? null : (idMap.get(activeOverlayId) ?? activeOverlayId),
    idMap,
  };
}
