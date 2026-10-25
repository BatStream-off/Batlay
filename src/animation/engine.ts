import type { LoopSpec, MotionSpec } from "./config";
import { getEnterEffect, getExitEffect, getLoopEffect, type EffectContext } from "./effects";

/**
 * Moteur d'animation : une fine couche au-dessus de la Web Animations API
 * (`element.animate`), native dans Chromium — donc dans OBS, Streamlabs,
 * Electron et les autres sources Web. Aucune dépendance, aucune boucle
 * JavaScript : le navigateur interpole lui-même, sur le compositeur pour
 * `opacity` / `transform`.
 *
 * Garanties (testées dans tests/animation.test.ts avec de faux éléments) :
 *   - une seule animation par élément ET par canal (« main » : entrée/sortie,
 *     « loop » : décoratif) : en lancer une nouvelle annule la précédente ;
 *   - `finished` se résout toujours (« finished », « cancelled » ou
 *     « skipped »), jamais de promesse rejetée ni pendante ;
 *   - sans `element.animate` (vieux moteur, rendu serveur) ou animations
 *     désactivées : rien n'est lancé, `finished` se résout immédiatement ;
 *   - `cancelAll(el)` quand un élément quitte le DOM : aucune animation orpheline.
 */

/** Sous-ensemble de `Animation` utilisé par le moteur. */
export interface AnimationLike {
  cancel(): void;
  finish?(): void;
  pause?(): void;
  play?(): void;
  readonly finished: Promise<unknown>;
  playState?: string;
}

/** Sous-ensemble d'`Element` : permet de tester le moteur sans DOM. */
export interface Animatable {
  animate(keyframes: Keyframe[], options: KeyframeAnimationOptions): AnimationLike;
}

export type AnimationOutcome = "finished" | "cancelled" | "skipped";

export interface AnimationHandle {
  readonly finished: Promise<AnimationOutcome>;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export type Channel = "main" | "loop";

const SKIPPED: AnimationHandle = {
  finished: Promise.resolve("skipped"),
  cancel: () => undefined,
  pause: () => undefined,
  resume: () => undefined,
};

const canAnimate = (el: unknown): el is Animatable => !!el && typeof (el as Animatable).animate === "function";

const running = new WeakMap<object, Map<Channel, AnimationLike>>();

function track(el: object, channel: Channel, animation: AnimationLike | null): void {
  let byChannel = running.get(el);
  if (!byChannel) {
    if (!animation) return;
    byChannel = new Map();
    running.set(el, byChannel);
  }
  if (animation) byChannel.set(channel, animation);
  else byChannel.delete(channel);
}

/** Annule l'animation en cours sur ce canal (sans effet s'il n'y en a pas). */
export function cancelChannel(el: object | null | undefined, channel: Channel): void {
  if (!el) return;
  const current = running.get(el)?.get(channel);
  if (current) {
    track(el, channel, null);
    try {
      current.cancel();
    } catch {
      /* animation déjà détachée */
    }
  }
}

/** Annule TOUT sur cet élément : à appeler quand il quitte le DOM. */
export function cancelAll(el: object | null | undefined): void {
  cancelChannel(el, "main");
  cancelChannel(el, "loop");
}

/** Nombre d'animations suivies pour un élément (diagnostic, tests). */
export function activeChannels(el: object): Channel[] {
  return [...(running.get(el)?.keys() ?? [])];
}

/**
 * Lance des images clés sur un élément. Remplace l'animation en cours sur le
 * même canal. `fill: "both"` pendant le délai évite qu'un élément entrant soit
 * visible (non animé) avant le début de son animation.
 */
export function playKeyframes(
  el: unknown,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
  channel: Channel = "main"
): AnimationHandle {
  if (!canAnimate(el) || keyframes.length === 0) return SKIPPED;
  cancelChannel(el, channel);
  let animation: AnimationLike;
  try {
    animation = el.animate(keyframes, options);
  } catch {
    // Valeur refusée par le navigateur (ne devrait jamais arriver : tout est normalisé) : on n'anime pas.
    return SKIPPED;
  }
  track(el, channel, animation);
  let cancelled = false;
  const finished = animation.finished.then(
    () => (cancelled ? "cancelled" : "finished") as AnimationOutcome,
    () => "cancelled" as AnimationOutcome // cancel() rejette `finished` avec une AbortError : c'est attendu.
  ).finally(() => {
    if (running.get(el)?.get(channel) === animation) track(el, channel, null);
  });
  return {
    finished,
    cancel() {
      cancelled = true;
      if (running.get(el)?.get(channel) === animation) track(el, channel, null);
      try {
        animation.cancel();
      } catch {
        /* déjà terminée */
      }
    },
    pause: () => animation.pause?.(),
    resume: () => animation.play?.(),
  };
}

function motionOptions(spec: MotionSpec, fill: FillMode): KeyframeAnimationOptions {
  return { duration: spec.durationMs, delay: spec.delayMs, easing: spec.easing, fill };
}

/**
 * Animation d'entrée. Après la fin, l'état final est l'état naturel de
 * l'élément : rien n'est « figé » (fill backwards seulement, pendant le délai).
 */
export function playEnter(el: unknown, spec: MotionSpec | null, ctx: Partial<EffectContext> = {}): AnimationHandle {
  if (!spec) return SKIPPED;
  const def = getEnterEffect(spec.effect);
  if (!def) return SKIPPED;
  return playKeyframes(el, def.keyframes({ intensity: spec.intensity, ...ctx }), motionOptions(spec, "backwards"));
}

/**
 * Animation de sortie. `fill: "forwards"` garde l'élément caché entre la fin
 * de l'animation et son retrait du DOM (sinon il réapparaîtrait une image).
 */
export function playExit(el: unknown, spec: MotionSpec | null, ctx: Partial<EffectContext> = {}): AnimationHandle {
  if (!spec) return SKIPPED;
  const def = getExitEffect(spec.effect);
  if (!def) return SKIPPED;
  return playKeyframes(el, def.keyframes({ intensity: spec.intensity, ...ctx }), motionOptions(spec, "forwards"));
}

/**
 * Effet décoratif répété. `trigger: "change"` = `repeat` cycles puis arrêt ;
 * `always` = en boucle (à mettre en pause par l'appelant quand rien ne joue).
 */
export function playLoop(el: unknown, spec: LoopSpec | null, delayMs = 0): AnimationHandle {
  if (!spec) return SKIPPED;
  const def = getLoopEffect(spec.effect);
  if (!def) return SKIPPED;
  return playKeyframes(
    el,
    def.keyframes({ intensity: spec.intensity }),
    {
      duration: spec.periodMs,
      delay: delayMs,
      easing: def.easing ?? "ease-in-out",
      iterations: spec.trigger === "always" ? Infinity : spec.repeat,
    },
    "loop"
  );
}

// ---------------------------------------------------------------------------
// Mouvement réduit
// ---------------------------------------------------------------------------

export interface MediaQueryLike {
  matches: boolean;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

/** Vrai si le système demande de réduire les animations. Faux hors navigateur. */
export function prefersReducedMotion(match: ((q: string) => MediaQueryLike) | undefined = globalThis.matchMedia?.bind(globalThis)): boolean {
  try {
    return !!match?.(REDUCED_QUERY).matches;
  } catch {
    return false;
  }
}

/** Suit le réglage « réduire les animations » ; renvoie la fonction de désabonnement. */
export function watchReducedMotion(
  onChange: (reduced: boolean) => void,
  match: ((q: string) => MediaQueryLike) | undefined = globalThis.matchMedia?.bind(globalThis)
): () => void {
  let mq: MediaQueryLike | undefined;
  try {
    mq = match?.(REDUCED_QUERY);
  } catch {
    return () => undefined;
  }
  if (!mq?.addEventListener) return () => undefined;
  const listener = () => onChange(!!mq?.matches);
  mq.addEventListener("change", listener);
  return () => mq?.removeEventListener?.("change", listener);
}

/** Les animations jouent-elles ? (désactivées, ou mouvement réduit respecté). */
export function isMotionAllowed({ enabled, respectReducedMotion }: { enabled: boolean; respectReducedMotion: boolean }, reduced: boolean): boolean {
  return enabled && !(respectReducedMotion && reduced);
}
