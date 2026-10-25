/**
 * Transition entre deux états d'un même élément (fonctions PURES, testées dans
 * tests/animation.test.ts). Utilisé pour la pochette, le titre, les artistes…
 * de l'overlay musique, et réutilisable par les futures alertes / widgets.
 *
 * Modèle : une pile de calques. Le calque « courant » affiche la valeur la
 * plus récente ; l'ancien calque reste affiché le temps de sa sortie, puis est
 * retiré. Règles :
 *   - même clé, nouvelle valeur (ex. pochette arrivée plus tard pour le même
 *     titre) : remplacée SUR PLACE, sans animation ni clignotement ;
 *   - nouvelle clé : attente de `settleMs` avant de lancer la transition. Une
 *     rafale de mises à jour (Windows envoie souvent titre, puis artiste, puis
 *     pochette) ne produit qu'UNE transition, vers l'état final ; et un aller-
 *     retour A → B → A pendant cette attente n'anime rien du tout ;
 *   - au plus UN calque sortant : si une nouvelle transition commence pendant
 *     une sortie, le plus ancien est retiré immédiatement (jamais trois
 *     morceaux superposés, jamais une ancienne information qui « revient ») ;
 *   - animations désactivées : remplacement immédiat, aucun calque sortant.
 */

export type LayerPhase = "entering" | "present" | "exiting";

export interface Layer<T> {
  /** Identifiant unique du calque (clé React). */
  id: number;
  key: string;
  value: T;
  phase: LayerPhase;
}

export interface SwapState<T> {
  layers: Layer<T>[];
  pending: { key: string; value: T } | null;
  nextId: number;
}

export type SwapAction<T> =
  | { type: "update"; key: string; value: T; animate: boolean }
  | { type: "settle" }
  | { type: "entered"; id: number }
  | { type: "exited"; id: number };

export function initSwap<T>(key: string, value: T, animateOnMount: boolean): SwapState<T> {
  return { layers: [{ id: 1, key, value, phase: animateOnMount ? "entering" : "present" }], pending: null, nextId: 2 };
}

/** Calque courant (le plus récent qui ne sort pas). */
export function currentLayer<T>(state: SwapState<T>): Layer<T> | undefined {
  for (let i = state.layers.length - 1; i >= 0; i--) if (state.layers[i].phase !== "exiting") return state.layers[i];
  return undefined;
}

function commit<T>(state: SwapState<T>, key: string, value: T, animate: boolean): SwapState<T> {
  const current = currentLayer(state);
  if (!animate) {
    return { layers: [{ id: state.nextId, key, value, phase: "present" }], pending: null, nextId: state.nextId + 1 };
  }
  const exiting = current ? [{ ...current, phase: "exiting" as const }] : [];
  return {
    // Les calques déjà sortants disparaissent : un seul ancien état visible à la fois.
    layers: [...exiting, { id: state.nextId, key, value, phase: "entering" }],
    pending: null,
    nextId: state.nextId + 1,
  };
}

export function swapReducer<T>(state: SwapState<T>, action: SwapAction<T>): SwapState<T> {
  switch (action.type) {
    case "update": {
      const current = currentLayer(state);
      if (current && current.key === action.key) {
        // Même contenu (ou retour à l'état affiché pendant l'attente) : mise à jour sur place, attente annulée.
        const sameValue = Object.is(current.value, action.value);
        if (sameValue && state.pending === null) return state;
        return {
          ...state,
          pending: null,
          layers: sameValue ? state.layers : state.layers.map((l) => (l.id === current.id ? { ...l, value: action.value } : l)),
        };
      }
      if (!action.animate) return commit(state, action.key, action.value, false);
      return { ...state, pending: { key: action.key, value: action.value } };
    }
    case "settle":
      return state.pending ? commit(state, state.pending.key, state.pending.value, true) : state;
    case "entered":
      return {
        ...state,
        layers: state.layers.map((l) => (l.id === action.id && l.phase === "entering" ? { ...l, phase: "present" } : l)),
      };
    case "exited": {
      const layers = state.layers.filter((l) => !(l.id === action.id && l.phase === "exiting"));
      return layers.length === state.layers.length ? state : { ...state, layers };
    }
  }
}
