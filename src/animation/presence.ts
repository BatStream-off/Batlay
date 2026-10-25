/**
 * Présence d'éléments dans une LISTE animée (fonction PURE, testée dans
 * tests/animation.test.ts) : messages du chat aujourd'hui, file d'alertes
 * demain. Un élément retiré des données peut rester affiché, marqué
 * `leaving`, le temps de son animation de sortie ; il est retiré du DOM quand
 * le rendu signale la fin de l'animation (`removeLeaving`).
 *
 * Règles :
 *   - l'ORDRE est celui des données ; un élément sortant garde sa place
 *     relative (il ne saute jamais en bas ou en haut de la liste) ;
 *   - `instant` : retraits qui ne doivent PAS être animés (message supprimé par
 *     un modérateur, chat vidé) : le contenu disparaît immédiatement ;
 *   - au plus `maxLeaving` éléments sortants : sous un flot de messages, les
 *     plus anciens sortants sont retirés sans attendre (le chat ne ralentit pas) ;
 *   - un élément qui revient pendant sa sortie redevient présent.
 */

export interface Presence<T> {
  id: string;
  item: T;
  leaving: boolean;
}

export interface ReconcileOptions {
  /** Animer les retraits ? (faux = comportement historique : retrait immédiat). */
  animateExit: boolean;
  /** Identifiants à retirer sans animation, ou `"all"`. */
  instant?: ReadonlySet<string> | "all";
  maxLeaving?: number;
}

export function reconcilePresence<T>(
  previous: readonly Presence<T>[],
  next: readonly T[],
  getId: (item: T) => string,
  { animateExit, instant, maxLeaving = 10 }: ReconcileOptions
): Presence<T>[] {
  const nextIds = new Set(next.map(getId));
  const isInstant = (id: string) => instant === "all" || (instant?.has(id) ?? false);

  // Pour chaque élément qui sort, l'élément présent qui le SUIT dans l'ancienne liste :
  // il sera réinséré juste avant lui (ou à la fin si plus rien ne le suit).
  const result: Presence<T>[] = [];
  const leavingBefore = new Map<string, Presence<T>[]>();
  const leavingAtEnd: Presence<T>[] = [];
  let carry: Presence<T>[] = [];
  for (const p of previous) {
    if (nextIds.has(p.id)) {
      if (carry.length) leavingBefore.set(p.id, carry);
      carry = [];
    } else if (animateExit && !isInstant(p.id)) {
      carry.push(p.leaving ? p : { ...p, leaving: true });
    }
  }
  leavingAtEnd.push(...carry);

  // Les sortants qui fermaient l'ancienne liste restent AVANT les nouveaux arrivants (plus récents qu'eux) :
  // juste après le dernier élément déjà présent auparavant, ou en tête s'il n'y en a aucun.
  const previousIds = new Set(previous.map((p) => p.id));
  let lastSurvivor = -1;
  next.forEach((item, i) => {
    if (previousIds.has(getId(item))) lastSurvivor = i;
  });
  if (lastSurvivor === -1) result.push(...leavingAtEnd);
  next.forEach((item, i) => {
    const id = getId(item);
    const before = leavingBefore.get(id);
    if (before) result.push(...before);
    result.push({ id, item, leaving: false });
    if (i === lastSurvivor) result.push(...leavingAtEnd);
  });

  // Trop de sortants : on retire les plus anciens (en tête de liste) immédiatement.
  let excess = result.filter((p) => p.leaving).length - Math.max(0, maxLeaving);
  if (excess <= 0) return result;
  return result.filter((p) => !(p.leaving && excess-- > 0));
}

/** Fin de l'animation de sortie : l'élément quitte enfin la liste. */
export function removeLeaving<T>(list: readonly Presence<T>[], id: string): Presence<T>[] {
  const next = list.filter((p) => !(p.leaving && p.id === id));
  return next.length === list.length ? (list as Presence<T>[]) : next;
}
