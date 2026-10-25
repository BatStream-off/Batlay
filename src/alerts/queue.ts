import type { AlertEvent } from "../../electron/shared/alerts";

/**
 * File d'alertes de la page overlay (fonctions PURES, testées dans
 * tests/alerts.test.ts) : une alerte à la fois, dans l'ordre d'arrivée.
 *   - un même événement (même id, renvoyé par Twitch ou un outil) n'est
 *     affiché qu'une fois ;
 *   - file bornée : sous une rafale (raid de follows…), les plus anciennes
 *     en attente sont abandonnées plutôt que d'enchaîner des alertes pendant
 *     des minutes ;
 *   - « Passer » vide tout.
 */
export interface AlertQueueState {
  current: AlertEvent | null;
  pending: AlertEvent[];
  /** Identifiants déjà vus (bornés), pour l'anti-doublon. */
  seen: string[];
}

export const MAX_PENDING = 30;
const SEEN_SIZE = 200;

export const emptyQueue = (): AlertQueueState => ({ current: null, pending: [], seen: [] });

export type AlertQueueAction = { type: "enqueue"; event: AlertEvent } | { type: "done" } | { type: "skip" };

export function alertQueueReducer(state: AlertQueueState, action: AlertQueueAction): AlertQueueState {
  switch (action.type) {
    case "enqueue": {
      if (state.seen.includes(action.event.id)) return state;
      const seen = [...state.seen, action.event.id].slice(-SEEN_SIZE);
      if (!state.current) return { current: action.event, pending: state.pending, seen };
      const pending = [...state.pending, action.event];
      return { current: state.current, pending: pending.slice(-MAX_PENDING), seen };
    }
    case "done": {
      const [next, ...rest] = state.pending;
      return { ...state, current: next ?? null, pending: rest };
    }
    case "skip":
      return state.current === null && state.pending.length === 0 ? state : { ...state, current: null, pending: [] };
  }
}
