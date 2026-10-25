import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { LoopSpec, MotionSpec } from "./config";
import { getLoopEffect, type EffectContext } from "./effects";
import { cancelAll, cancelChannel, playEnter, playExit, playLoop, prefersReducedMotion, watchReducedMotion, type AnimationHandle } from "./engine";
import { initSwap, swapReducer, type Layer } from "./swap";

/**
 * Adaptateurs React du moteur. Ils ne contiennent AUCUNE règle d'animation :
 * la logique est dans swap.ts / presence.ts (pures) et engine.ts (WAAPI).
 * Styles inline uniquement : ces composants sont rendus par la page OBS, qui
 * n'embarque pas Tailwind.
 */

// ---------------------------------------------------------------------------
// Contexte : les animations ne jouent que là où on les autorise explicitement
// (page OBS, éditeur). Miniatures, listes, rendu serveur : jamais d'animation.
// ---------------------------------------------------------------------------

export interface AnimationEnvironment {
  enabled: boolean;
  /** Le système demande de réduire les animations. */
  reducedMotion: boolean;
}

const AnimationContext = createContext<AnimationEnvironment>({ enabled: false, reducedMotion: false });

export function AnimationProvider({ enabled = true, children }: { enabled?: boolean; children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion());
  useEffect(() => watchReducedMotion(setReducedMotion), []);
  return <AnimationContext.Provider value={{ enabled, reducedMotion }}>{children}</AnimationContext.Provider>;
}

export function useAnimationEnvironment(): AnimationEnvironment {
  return useContext(AnimationContext);
}

// ---------------------------------------------------------------------------
// Transition entre deux états d'un même élément
// ---------------------------------------------------------------------------

/** Attente avant une transition : regroupe les mises à jour partielles (titre, puis artiste, puis pochette). */
export const DEFAULT_SETTLE_MS = 140;

export interface AnimatedSwapProps<T> {
  /** Identité du contenu affiché : une nouvelle clé = une transition. */
  swapKey: string;
  value: T;
  /** Rendu d'un calque ; `null` = rien à afficher (aucun élément dans le DOM). */
  render: (value: T) => ReactNode | null;
  /** Style du calque : en pratique la boîte du composant (position absolue). */
  layerStyle: CSSProperties;
  enter: MotionSpec | null;
  exit: MotionSpec | null;
  loop?: LoopSpec | null;
  /** Boucle `always` : jouée seulement si vrai (ex. musique en lecture). */
  loopActive?: boolean;
  /** Le premier affichage est-il animé ? */
  animateOnMount?: boolean;
  settleMs?: number;
  effectContext?: Partial<EffectContext>;
}

export function AnimatedSwap<T>({
  swapKey,
  value,
  render,
  layerStyle,
  enter,
  exit,
  loop = null,
  loopActive = true,
  animateOnMount = true,
  settleMs = DEFAULT_SETTLE_MS,
  effectContext,
}: AnimatedSwapProps<T>) {
  const env = useAnimationEnvironment();
  const animate = env.enabled && (enter !== null || exit !== null);
  const [state, dispatch] = useReducer(swapReducer<T>, undefined, () => initSwap(swapKey, value, animate && animateOnMount));

  // Données reçues → réducteur (remplacement sur place, ou transition en attente).
  useLayoutEffect(() => {
    dispatch({ type: "update", key: swapKey, value, animate });
  }, [swapKey, value, animate]);

  // Attente de stabilisation : chaque nouvelle clé en attente relance le minuteur.
  const pendingKey = state.pending?.key ?? null;
  useEffect(() => {
    if (pendingKey === null) return;
    const timer = setTimeout(() => dispatch({ type: "settle" }), Math.max(0, settleMs));
    return () => clearTimeout(timer);
  }, [pendingKey, settleMs]);

  return (
    <>
      {state.layers.map((layer) => (
        <SwapLayer
          key={layer.id}
          layer={layer}
          render={render}
          layerStyle={layerStyle}
          enter={animate ? enter : null}
          exit={animate ? exit : null}
          loop={env.enabled ? loop : null}
          loopActive={loopActive}
          effectContext={effectContext}
          onEntered={(id) => dispatch({ type: "entered", id })}
          onExited={(id) => dispatch({ type: "exited", id })}
        />
      ))}
    </>
  );
}

interface SwapLayerProps<T> {
  layer: Layer<T>;
  render: (value: T) => ReactNode | null;
  layerStyle: CSSProperties;
  enter: MotionSpec | null;
  exit: MotionSpec | null;
  loop: LoopSpec | null;
  loopActive: boolean;
  effectContext?: Partial<EffectContext>;
  onEntered: (id: number) => void;
  onExited: (id: number) => void;
}

function SwapLayer<T>({ layer, render, layerStyle, enter, exit, loop, loopActive, effectContext, onEntered, onExited }: SwapLayerProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const decoRef = useRef<HTMLSpanElement>(null);
  const content = render(layer.value);
  const empty = content === null || content === undefined || content === false;
  // Les rappels changent à chaque rendu du parent : on garde les derniers sans relancer les animations.
  const callbacks = useRef({ onEntered, onExited });
  callbacks.current = { onEntered, onExited };

  // Entrée / sortie : relancées uniquement quand la phase change.
  useLayoutEffect(() => {
    const el = ref.current;
    let handle: AnimationHandle | null = null;
    let alive = true;
    if (layer.phase === "entering") {
      handle = empty ? null : playEnter(el, enter, effectContext);
      void (handle?.finished ?? Promise.resolve()).then((outcome) => {
        if (alive && outcome !== "cancelled") callbacks.current.onEntered(layer.id);
      });
    } else if (layer.phase === "exiting") {
      // La boucle décorative s'arrête : elle animerait la même propriété que la sortie.
      cancelChannel(el, "loop");
      cancelChannel(decoRef.current, "loop");
      handle = empty ? null : playExit(el, exit, effectContext);
      void (handle?.finished ?? Promise.resolve()).then(() => {
        if (alive) callbacks.current.onExited(layer.id);
      });
    }
    return () => {
      alive = false;
    };
    // Dépendances volontairement réduites : volontaire : une animation par changement de phase
  }, [layer.phase]);

  // Effet décoratif, une fois le calque arrivé.
  const loopDef = loop ? getLoopEffect(loop.effect) : null;
  const loopTarget = loopDef?.target ?? null;
  const loopRunning = useRef<AnimationHandle | null>(null);
  useEffect(() => {
    if (!loop || !loopDef || layer.phase !== "present" || empty) return;
    const target = loopDef.target === "decoration" ? decoRef.current : ref.current;
    loopRunning.current = playLoop(target, loop);
    return () => {
      loopRunning.current?.cancel();
      loopRunning.current = null;
    };
    // Dépendances volontairement réduites : relancé si l'effet ou son réglage change
  }, [layer.phase, empty, loop?.effect, loop?.periodMs, loop?.intensity, loop?.trigger, loop?.repeat]);

  // Boucle continue : en pause quand rien ne joue (aucun calcul inutile).
  useEffect(() => {
    if (!loop || loop.trigger !== "always") return;
    if (loopActive) loopRunning.current?.resume();
    else loopRunning.current?.pause();
  }, [loopActive, loop, layer.phase]);

  // Démontage : aucune animation orpheline.
  useEffect(() => {
    const el = ref.current;
    const deco = decoRef.current;
    return () => {
      cancelAll(el);
      cancelAll(deco);
    };
  }, []);

  if (empty) return null;
  const exiting = layer.phase === "exiting";
  const decoration =
    loopDef && loopTarget === "decoration" && loop ? (
      <span
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: "inherit", overflow: loopDef.clip ? "hidden" : "visible" }}
      >
        <span ref={decoRef} style={{ position: "absolute", inset: 0, borderRadius: "inherit", ...(loopDef.decorationStyle?.({ intensity: loop.intensity }) ?? {}) }} />
      </span>
    ) : null;
  return (
    <div
      ref={ref}
      // L'ancien contenu ne capte plus rien (clics de l'éditeur, lecteurs d'écran) pendant sa sortie.
      aria-hidden={exiting || undefined}
      style={exiting ? { ...layerStyle, pointerEvents: "none" } : layerStyle}
    >
      {content}
      {decoration}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Élément de liste : entrée au montage, sortie quand `leaving` passe à vrai
// ---------------------------------------------------------------------------

export function useListItemMotion(
  ref: { current: Element | null },
  { leaving, enter, exit, onExited, effectContext }: {
    leaving: boolean;
    enter: MotionSpec | null;
    exit: MotionSpec | null;
    onExited: () => void;
    effectContext?: Partial<EffectContext>;
  }
): void {
  const done = useRef(onExited);
  done.current = onExited;
  useLayoutEffect(() => {
    const el = ref.current;
    let alive = true;
    if (!leaving) {
      playEnter(el, enter, effectContext);
    } else {
      void playExit(el, exit, effectContext).finished.then(() => {
        if (alive) done.current();
      });
    }
    return () => {
      alive = false;
    };
    // Dépendances volontairement réduites : une animation par changement d'état
  }, [leaving]);
  useEffect(() => {
    const el = ref.current;
    return () => cancelAll(el);
  }, [ref]);
}
