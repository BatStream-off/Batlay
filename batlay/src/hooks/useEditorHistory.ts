import { useCallback, useState } from "react";

const MAX_HISTORY = 100;

interface HistoryState<T> {
  present: T;
  past: T[];
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

export interface ApplyOptions {
  /**
   * Regroupe des modifications successives en UNE étape d'annulation :
   * déplacer un composant à la souris produit des dizaines de changements, un
   * seul Ctrl+Z doit tous les défaire. Même clé + délai < `windowMs` = fusion.
   */
  key?: string;
  windowMs?: number;
}

/**
 * Historique annuler/rétablir d'un document. `apply` reçoit une fonction pure
 * (ancien -> nouveau) ; si elle renvoie la même référence, rien ne change.
 */
export function useEditorHistory<T>(initial: T) {
  const [state, setState] = useState<HistoryState<T>>({
    present: initial,
    past: [],
    future: [],
    lastKey: null,
    lastAt: 0,
  });

  const apply = useCallback((fn: (current: T) => T, options: ApplyOptions = {}) => {
    setState((s) => {
      const next = fn(s.present);
      if (next === s.present) return s;
      const now = Date.now();
      const merge = options.key !== undefined && s.lastKey === options.key && now - s.lastAt < (options.windowMs ?? 800);
      return {
        present: next,
        past: merge ? s.past : [...s.past, s.present].slice(-MAX_HISTORY),
        future: [],
        lastKey: options.key ?? null,
        lastAt: now,
      };
    });
  }, []);

  const undo = useCallback(() => {
    setState((s) => {
      if (s.past.length === 0) return s;
      const previous = s.past[s.past.length - 1];
      return { present: previous, past: s.past.slice(0, -1), future: [s.present, ...s.future], lastKey: null, lastAt: 0 };
    });
  }, []);

  const redo = useCallback(() => {
    setState((s) => {
      if (s.future.length === 0) return s;
      const [next, ...rest] = s.future;
      return { present: next, past: [...s.past, s.present], future: rest, lastKey: null, lastAt: 0 };
    });
  }, []);

  /** Remplace le document et vide l'historique (chargement, retour à la version enregistrée). */
  const reset = useCallback((value: T) => {
    setState({ present: value, past: [], future: [], lastKey: null, lastAt: 0 });
  }, []);

  return {
    present: state.present,
    apply,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
