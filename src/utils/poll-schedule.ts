import type { PlaybackState } from "@/types/track";

/**
 * Cadence de polling adaptative (Spotify). Un intervalle fixe force à
 * choisir entre "réactif" et "économe" ; ici on est économe tant que rien
 * ne se passe et réactif quand un changement est probable :
 *   - juste après un changement (morceau, play/pause) : les suivants
 *     arrivent souvent en rafale (zapping) ;
 *   - à l'approche de la fin du morceau : le prochain relevé est
 *     programmé pile après la fin PRÉVUE, pour détecter le morceau suivant
 *     sans attendre un tick de 2 s ;
 *   - en pause / rien en lecture : relevé espacé ;
 *   - en cas d'erreur (réseau, 429) : recul exponentiel, sans marteler l'API.
 */
export const POLL_TUNING = {
  steadyMs: 2000,
  idleMs: 3000,
  fastMs: 700,
  /** Durée pendant laquelle on reste en cadence rapide après un changement. */
  burstMs: 5000,
  /** Distance à la fin du morceau à partir de laquelle on resserre. */
  endMarginMs: 6000,
  /** Délai après la fin prévue avant de relever (laisse Spotify basculer). */
  endGraceMs: 250,
  minMs: 250,
  errorBaseMs: 2000,
  errorMaxMs: 15000,
} as const;

export interface PollContext {
  nowEpochMs: number;
  state: PlaybackState | null;
  /** Tant que nowEpochMs < fastUntilEpochMs, cadence rapide. */
  fastUntilEpochMs: number;
  consecutiveErrors: number;
}

export function computeNextPollDelay(ctx: PollContext): number {
  if (ctx.consecutiveErrors > 0) {
    return Math.min(POLL_TUNING.errorMaxMs, POLL_TUNING.errorBaseMs * 2 ** (ctx.consecutiveErrors - 1));
  }

  const track = ctx.state?.track;
  if (!track || !track.isPlaying) {
    return ctx.nowEpochMs < ctx.fastUntilEpochMs ? POLL_TUNING.fastMs : POLL_TUNING.idleMs;
  }

  if (track.duration > 0 && ctx.state) {
    const elapsedSinceSample = Math.max(0, ctx.nowEpochMs - ctx.state.updatedAt);
    const remaining = track.duration - (track.progress + elapsedSinceSample);
    if (remaining <= POLL_TUNING.endMarginMs) {
      // Relevé pile après la fin prévue, sans jamais attendre plus que la cadence rapide.
      return Math.max(POLL_TUNING.minMs, Math.min(POLL_TUNING.fastMs, remaining + POLL_TUNING.endGraceMs));
    }
  }

  return ctx.nowEpochMs < ctx.fastUntilEpochMs ? POLL_TUNING.fastMs : POLL_TUNING.steadyMs;
}
