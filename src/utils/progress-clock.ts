import type { PlaybackState } from "@/types/track";

/**
 * Horloge de progression PARTAGÉE par le Dashboard, l'éditeur et la page
 * overlay chargée par OBS : les trois affichent exactement la même
 * trajectoire, calculée par le même code.
 *
 * Pourquoi une horloge plutôt qu'une simple addition
 * --------------------------------------------------
 * Un provider ne fournit une position que toutes les ~1-3 s (polling).
 * Entre deux mesures, on extrapole localement (position + temps écoulé).
 * L'ancienne version recalait brutalement l'affichage sur chaque nouvelle
 * mesure : la moindre erreur d'estimation (latence réseau/PowerShell,
 * gigue du timer) devenait un saut visible, souvent EN ARRIÈRE.
 *
 * Ici, chaque nouvelle mesure est comparée à la position affichée :
 *   - écart < 120 ms (bruit de mesure)      -> ignoré, la barre ne bouge pas ;
 *   - écart entre 120 ms et 4 s (dérive)    -> absorbé progressivement en
 *     accélérant ou ralentissant LÉGÈREMENT la barre (vitesse dans
 *     [0,5 ; 1,5]), donc sans saut et sans jamais reculer ;
 *   - écart > 4 s, ou autre morceau         -> vrai déplacement (seek,
 *     nouveau morceau, répétition) : la barre saute, c'est voulu ;
 *   - pause : la barre se fige où elle est (elle ne recule pas de la
 *     latence de détection de la pause, jusqu'à 2,5 s).
 *
 * Toutes les dates sont dans UNE base de temps unique, choisie par
 * l'appelant (`performance.now()` en pratique, monotone) : l'horloge ne
 * lit jamais `Date.now()` elle-même, ce qui la rend déterministe en test.
 */

export interface ProgressSample {
  /** Identifiant du morceau ; un changement déclenche un saut franc. */
  trackId: string | null;
  /** Position dans le morceau (ms) à l'instant `sampledAtMs`. */
  progressMs: number;
  /** Durée totale (ms) ; 0 si inconnue. */
  durationMs: number;
  isPlaying: boolean;
  /** Instant de la MESURE (pas de la réception), même base de temps que `nowMs`. */
  sampledAtMs: number;
}

/** Ce dont un composant d'affichage a besoin : lire la position à un instant donné. */
export interface ProgressReader {
  read(nowMs: number): number;
}

export const CLOCK_TUNING = {
  /** En dessous : bruit de mesure, on ne touche à rien. */
  deadZoneMs: 120,
  /** Au-dessus : vrai seek, on saute au lieu de rattraper. */
  seekThresholdMs: 4000,
  /** En pause, on ne fait pas reculer la barre d'un écart plus petit que ça. */
  pauseHoldToleranceMs: 2500,
  minSlewMs: 500,
  maxSlewAheadMs: 3000,
  /** Recul : durée plus longue pour que la vitesse reste positive (jamais de retour en arrière). */
  maxSlewBehindMs: 8000,
  pausedSlewMs: 300,
} as const;

export class ProgressClock implements ProgressReader {
  private hasSample = false;
  private trackId: string | null = null;
  private duration = 0;
  private playing = false;
  /** Position affichée à `baseTime`, hors correction en cours. */
  private base = 0;
  private baseTime = 0;
  /** Correction totale à absorber (ms, signée), appliquée linéairement sur `corrDur`. */
  private corr = 0;
  private corrStart = 0;
  private corrDur = 0;
  private lastSampleAt = -Infinity;

  /** Position affichée à `nowMs`. Toujours dans [0, durée]. */
  read(nowMs: number): number {
    if (!this.hasSample) return 0;
    let position = this.base;
    if (this.playing) position += Math.max(0, nowMs - this.baseTime);
    if (this.corrDur > 0) {
      const fraction = Math.min(1, Math.max(0, (nowMs - this.corrStart) / this.corrDur));
      position += this.corr * fraction;
    }
    return this.clamp(position);
  }

  /**
   * Intègre une nouvelle mesure du provider. `nowMs` = maintenant, dans la
   * même base de temps que `sample.sampledAtMs`.
   */
  sync(sample: ProgressSample, nowMs: number): void {
    // Mesure plus ancienne que celle déjà appliquée (livraison dans le
    // désordre) : l'appliquer ferait reculer la barre.
    if (this.hasSample && sample.trackId === this.trackId && sample.sampledAtMs < this.lastSampleAt - 1) {
      return;
    }

    const duration = sample.durationMs > 0 ? sample.durationMs : 0;
    // Où la lecture est réellement MAINTENANT selon cette mesure : c'est la
    // compensation de latence (la mesure a `age` ms de retard à l'arrivée).
    const age = Math.max(0, nowMs - sample.sampledAtMs);
    const target = this.clampTo(sample.progressMs + (sample.isPlaying ? age : 0), duration);

    if (!this.hasSample || sample.trackId !== this.trackId) {
      this.hardSet(sample, duration, target, nowMs);
      return;
    }

    this.duration = duration;
    this.lastSampleAt = sample.sampledAtMs;

    const current = this.read(nowMs);
    const delta = target - current;

    if (Math.abs(delta) > CLOCK_TUNING.seekThresholdMs) {
      this.hardSet(sample, duration, target, nowMs);
      return;
    }

    // Ré-ancrage sur la position AFFICHÉE : continuité parfaite, aucun saut
    // au moment de la synchronisation, quoi qu'il arrive ensuite.
    this.base = this.clampTo(current, duration);
    this.baseTime = nowMs;
    this.corr = 0;
    this.corrDur = 0;
    this.playing = sample.isPlaying;

    if (sample.isPlaying) {
      if (Math.abs(delta) >= CLOCK_TUNING.deadZoneMs) {
        // Vitesse résultante = 1 + delta/durée. Avec durée >= 2·|delta|, elle
        // reste dans [0,5 ; 1,5] : jamais négative, donc jamais de recul.
        const max = delta < 0 ? CLOCK_TUNING.maxSlewBehindMs : CLOCK_TUNING.maxSlewAheadMs;
        this.startCorrection(delta, Math.min(max, Math.max(CLOCK_TUNING.minSlewMs, Math.abs(delta) * 2)), nowMs);
      }
      return;
    }

    // Pause. Si la barre a continué un peu après l'arrêt réel (détection
    // tardive), on la laisse figée plutôt que de la faire reculer.
    const holdIt = delta < 0 && -delta <= CLOCK_TUNING.pauseHoldToleranceMs;
    if (!holdIt && Math.abs(delta) >= 1) this.startCorrection(delta, CLOCK_TUNING.pausedSlewMs, nowMs);
  }

  reset(): void {
    this.hasSample = false;
    this.trackId = null;
    this.duration = 0;
    this.playing = false;
    this.base = 0;
    this.baseTime = 0;
    this.corr = 0;
    this.corrStart = 0;
    this.corrDur = 0;
    this.lastSampleAt = -Infinity;
  }

  private hardSet(sample: ProgressSample, duration: number, target: number, nowMs: number): void {
    this.hasSample = true;
    this.trackId = sample.trackId;
    this.duration = duration;
    this.playing = sample.isPlaying;
    this.base = target;
    this.baseTime = nowMs;
    this.corr = 0;
    this.corrDur = 0;
    this.lastSampleAt = sample.sampledAtMs;
  }

  private startCorrection(delta: number, durationMs: number, nowMs: number): void {
    this.corr = delta;
    this.corrStart = nowMs;
    this.corrDur = durationMs;
  }

  private clamp(position: number): number {
    return this.clampTo(position, this.duration);
  }

  private clampTo(position: number, duration: number): number {
    const nonNegative = Math.max(0, position);
    return duration > 0 ? Math.min(nonNegative, duration) : nonNegative;
  }
}

/** Contexte de conversion état -> mesure. */
export interface SampleContext {
  /** Base de temps de l'horloge (normalement performance.now()). */
  nowMs: number;
  /** Date.now() au même instant que `nowMs`. */
  nowEpochMs: number;
  /**
   * Date.now() du PRODUCTEUR de l'état au moment de l'envoi (WebSocket).
   * Quand il est fourni, l'âge de la mesure est calculé entièrement dans
   * l'horloge du producteur (`sentAt - updatedAt`) : la page OBS n'a alors
   * plus besoin que son horloge murale soit alignée avec celle de Batlay.
   */
  sentAtEpochMs?: number;
}

export function sampleFromPlaybackState(state: PlaybackState, ctx: SampleContext): ProgressSample | null {
  const track = state.track;
  if (!track) return null;
  const ageMs = Math.max(
    0,
    ctx.sentAtEpochMs !== undefined ? ctx.sentAtEpochMs - state.updatedAt : ctx.nowEpochMs - state.updatedAt
  );
  return {
    trackId: track.id,
    progressMs: track.progress,
    durationMs: track.duration,
    isPlaying: track.isPlaying,
    sampledAtMs: ctx.nowMs - ageMs,
  };
}

/**
 * Alimente une horloge à partir d'un PlaybackState (store du renderer ou
 * message WebSocket). Aucun morceau -> l'horloge est remise à zéro.
 */
export function feedClock(clock: ProgressClock, state: PlaybackState, sentAtEpochMs?: number): void {
  const nowMs = performance.now();
  const sample = sampleFromPlaybackState(state, { nowMs, nowEpochMs: Date.now(), sentAtEpochMs });
  if (!sample) {
    clock.reset();
    return;
  }
  clock.sync(sample, nowMs);
}
