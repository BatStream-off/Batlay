import type { OverlayConfig } from "@/types/overlay";

/**
 * Brouillons non enregistrés de l'éditeur, conservés le temps de la session :
 * quitter l'éditeur (menu latéral...) puis y revenir ne fait plus perdre le
 * travail. Un brouillon n'est réutilisé que si l'overlay n'a pas été modifié
 * depuis (`baseUpdatedAt`).
 *
 * Vit hors de la page Editor pour que le store puisse déplacer un brouillon
 * quand le lien OBS (donc l'id) de l'overlay change : sans cela, le travail
 * non enregistré serait perdu en silence.
 */
export const unsavedDrafts = new Map<string, { draft: OverlayConfig; baseUpdatedAt: number }>();

/**
 * Rattache le brouillon d'un overlay à son nouvel id. L'id est aussi réécrit
 * DANS le brouillon : « Enregistrer » retrouve l'overlay par cet id, et avec
 * l'ancien la sauvegarde ne correspondrait à rien.
 */
export function rekeyUnsavedDrafts(idMap: ReadonlyMap<string, string>): void {
  for (const [oldId, newId] of idMap) {
    const entry = unsavedDrafts.get(oldId);
    if (!entry) continue;
    unsavedDrafts.delete(oldId);
    unsavedDrafts.set(newId, { ...entry, draft: { ...entry.draft, id: newId } });
  }
}
