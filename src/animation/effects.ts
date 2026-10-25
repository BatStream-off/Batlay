import type { EnterEffectId, ExitEffectId, LoopEffectId } from "./config";

/**
 * Bibliothèque d'effets (données PURES : images clés Web Animations, aucun DOM).
 *
 * Ajouter un effet = ajouter une entrée ici, puis son identifiant dans
 * config.ts (ENTER_EFFECTS / EXIT_EFFECTS / LOOP_EFFECTS). Le moteur, l'éditeur
 * et le chat le proposent alors automatiquement. Voir docs/DEVELOPPEMENT.md §6nonies.
 *
 * Performances : les effets n'animent que `opacity` et `transform` (gérés par
 * le compositeur, sans recalcul de mise en page), sauf ceux qui le déclarent
 * dans `properties` (`filter` pour le flou, `clip-path` pour la révélation :
 * repeints, mais toujours sans recalcul de mise en page). Un test vérifie
 * qu'aucun effet n'anime une propriété de mise en page (width, top, margin…).
 */

export type AnimatedProperty = "opacity" | "transform" | "filter" | "clip-path";

export interface EffectContext {
  /** 0 → 1. */
  intensity: number;
  /** Distance de glissement imposée (longueur CSS, ex. « 0.4em » pour le chat). Sinon dérivée de l'intensité. */
  distance?: string;
}

export interface EffectDefinition<Id extends string = string> {
  id: Id;
  label: string;
  description: string;
  properties: readonly AnimatedProperty[];
  /** Images clés Web Animations. Le premier (entrée) ou dernier (sortie) état est l'état « caché ». */
  keyframes(ctx: EffectContext): Keyframe[];
  /** Effet pensé pour du texte (révélation) : proposé en priorité pour les composants texte. */
  textOriented?: boolean;
}

export interface LoopEffectDefinition extends EffectDefinition<LoopEffectId> {
  /**
   * `self` : anime le composant lui-même. `decoration` : anime un calque
   * décoratif posé par-dessus (lueur, brillance), dont le style statique est
   * donné par `decorationStyle` — le composant n'est jamais repeint.
   */
  target: "self" | "decoration";
  decorationStyle?: (ctx: EffectContext) => Record<string, string | number>;
  /** Le calque décoratif est rogné aux bords du composant (brillance) ; une lueur, elle, déborde. */
  clip?: boolean;
  /** Accélération imposée (rotation : linéaire, sinon elle « hoquette » à chaque tour). */
  easing?: string;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5);
/** Distance de glissement : 8 px (intensité 0) à 56 px (intensité 1). */
export const slideDistance = (ctx: EffectContext) => ctx.distance ?? `${Math.round(8 + 48 * clamp01(ctx.intensity))}px`;
const round = (n: number) => Math.round(n * 1000) / 1000;

const slide = (dx: -1 | 0 | 1, dy: -1 | 0 | 1) => (ctx: EffectContext) => {
  const d = slideDistance(ctx);
  const move = (sign: number) => `translate3d(${dx ? `calc(${sign * dx} * ${d})` : "0"}, ${dy ? `calc(${sign * dy} * ${d})` : "0"}, 0)`;
  return { from: move(-1), to: move(1) };
};

// ---------------------------------------------------------------------------
// Entrée : de l'état caché (premier) à l'état normal (dernier)
// ---------------------------------------------------------------------------

export const ENTER_EFFECT_DEFS: Record<Exclude<EnterEffectId, "none">, EffectDefinition<EnterEffectId>> = {
  fade: {
    id: "fade",
    label: "Fondu progressif",
    description: "Apparaît en douceur.",
    properties: ["opacity"],
    keyframes: () => [{ opacity: 0 }, { opacity: 1 }],
  },
  slideRight: {
    id: "slideRight",
    label: "Glissement depuis la gauche",
    description: "Arrive par la gauche.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 0, transform: slide(1, 0)(ctx).from }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
  },
  slideLeft: {
    id: "slideLeft",
    label: "Glissement depuis la droite",
    description: "Arrive par la droite.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 0, transform: slide(-1, 0)(ctx).from }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
  },
  slideDown: {
    id: "slideDown",
    label: "Glissement depuis le haut",
    description: "Descend à sa place.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 0, transform: slide(0, 1)(ctx).from }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
  },
  slideUp: {
    id: "slideUp",
    label: "Glissement depuis le bas",
    description: "Monte à sa place.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 0, transform: slide(0, -1)(ctx).from }, { opacity: 1, transform: "translate3d(0, 0, 0)" }],
  },
  scale: {
    id: "scale",
    label: "Zoom avant",
    description: "Grandit jusqu'à sa taille.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 0, transform: `scale(${round(1 - 0.35 * clamp01(ctx.intensity) - 0.05)})` }, { opacity: 1, transform: "scale(1)" }],
  },
  pop: {
    id: "pop",
    label: "Apparition avec rebond",
    description: "Grandit, dépasse légèrement, puis se pose.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => {
      const i = clamp01(ctx.intensity);
      return [
        { opacity: 0, transform: `scale(${round(0.6 - 0.2 * i)})`, offset: 0 },
        { opacity: 1, transform: `scale(${round(1 + 0.04 + 0.08 * i)})`, offset: 0.6 },
        { opacity: 1, transform: `scale(${round(1 - 0.02 * i)})`, offset: 0.82 },
        { opacity: 1, transform: "scale(1)", offset: 1 },
      ];
    },
  },
  reveal: {
    id: "reveal",
    label: "Révélation du texte",
    description: "Le texte se dévoile de gauche à droite.",
    properties: ["opacity", "clip-path"],
    textOriented: true,
    keyframes: () => [
      { clipPath: "inset(0 100% 0 0)", opacity: 0.4 },
      { clipPath: "inset(0 0% 0 0)", opacity: 1 },
    ],
  },
};

// ---------------------------------------------------------------------------
// Sortie : de l'état normal (premier) à l'état caché (dernier)
// ---------------------------------------------------------------------------

export const EXIT_EFFECT_DEFS: Record<Exclude<ExitEffectId, "none">, EffectDefinition<ExitEffectId>> = {
  fade: {
    id: "fade",
    label: "Fondu",
    description: "S'efface en douceur.",
    properties: ["opacity"],
    keyframes: () => [{ opacity: 1 }, { opacity: 0 }],
  },
  slideLeft: {
    id: "slideLeft",
    label: "Glissement vers la gauche",
    description: "Part vers la gauche.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 1, transform: "translate3d(0, 0, 0)" }, { opacity: 0, transform: slide(-1, 0)(ctx).to }],
  },
  slideRight: {
    id: "slideRight",
    label: "Glissement vers la droite",
    description: "Part vers la droite.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 1, transform: "translate3d(0, 0, 0)" }, { opacity: 0, transform: slide(1, 0)(ctx).to }],
  },
  slideUp: {
    id: "slideUp",
    label: "Glissement vers le haut",
    description: "Part vers le haut.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 1, transform: "translate3d(0, 0, 0)" }, { opacity: 0, transform: slide(0, -1)(ctx).to }],
  },
  slideDown: {
    id: "slideDown",
    label: "Glissement vers le bas",
    description: "Part vers le bas.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 1, transform: "translate3d(0, 0, 0)" }, { opacity: 0, transform: slide(0, 1)(ctx).to }],
  },
  scale: {
    id: "scale",
    label: "Zoom arrière",
    description: "Recule et s'efface.",
    properties: ["opacity", "transform"],
    keyframes: (ctx) => [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: `scale(${round(1 - 0.25 * clamp01(ctx.intensity) - 0.05)})` }],
  },
  shrink: {
    id: "shrink",
    label: "Réduction progressive",
    description: "Rétrécit jusqu'à disparaître.",
    properties: ["opacity", "transform"],
    keyframes: () => [
      { opacity: 1, transform: "scale(1)", offset: 0 },
      { opacity: 1, transform: "scale(0.35)", offset: 0.75 },
      { opacity: 0, transform: "scale(0)", offset: 1 },
    ],
  },
  blur: {
    id: "blur",
    label: "Disparition floutée",
    description: "Se trouble légèrement et s'efface.",
    // Le flou est repeint à chaque image : réservé aux sorties (courtes), plafonné à 8 px.
    properties: ["opacity", "transform", "filter"],
    keyframes: (ctx) => [
      { opacity: 1, filter: "blur(0px)", transform: "scale(1)" },
      { opacity: 0, filter: `blur(${round(2 + 6 * clamp01(ctx.intensity))}px)`, transform: `scale(${round(1 + 0.04 * clamp01(ctx.intensity))})` },
    ],
  },
};

// ---------------------------------------------------------------------------
// Décoratifs (répétés). Amplitudes volontairement faibles, aucun clignotement.
// ---------------------------------------------------------------------------

export const LOOP_EFFECT_DEFS: Record<Exclude<LoopEffectId, "none">, LoopEffectDefinition> = {
  pulse: {
    id: "pulse",
    label: "Pulsation",
    description: "Grossit très légèrement puis revient.",
    properties: ["transform"],
    target: "self",
    keyframes: (ctx) => [{ transform: "scale(1)" }, { transform: `scale(${round(1 + 0.015 + 0.05 * clamp01(ctx.intensity))})` }, { transform: "scale(1)" }],
  },
  float: {
    id: "float",
    label: "Flottement",
    description: "Monte et descend de quelques pixels.",
    properties: ["transform"],
    target: "self",
    keyframes: (ctx) => {
      const d = Math.round(2 + 6 * clamp01(ctx.intensity));
      return [{ transform: "translate3d(0, 0, 0)" }, { transform: `translate3d(0, -${d}px, 0)` }, { transform: "translate3d(0, 0, 0)" }];
    },
  },
  rotate: {
    id: "rotate",
    label: "Rotation (pochette ronde)",
    description: "Tourne lentement, comme un disque.",
    properties: ["transform"],
    target: "self",
    easing: "linear",
    keyframes: () => [{ transform: "rotate(0deg)" }, { transform: "rotate(360deg)" }],
  },
  glow: {
    id: "glow",
    label: "Lueur",
    description: "Un halo apparaît et s'estompe autour du composant.",
    properties: ["opacity"],
    target: "decoration",
    // Halo statique : seule son opacité est animée (compositeur), le halo n'est jamais redessiné.
    decorationStyle: (ctx) => ({ opacity: 0, boxShadow: `0 0 ${Math.round(10 + 22 * clamp01(ctx.intensity))}px ${Math.round(2 + 6 * clamp01(ctx.intensity))}px rgba(255, 255, 255, 0.55)`, borderRadius: "inherit" }),
    keyframes: (ctx) => [{ opacity: 0 }, { opacity: round(0.35 + 0.5 * clamp01(ctx.intensity)) }, { opacity: 0 }],
  },
  shine: {
    id: "shine",
    label: "Brillance",
    description: "Un reflet discret traverse le composant.",
    properties: ["transform"],
    target: "decoration",
    clip: true,
    decorationStyle: (ctx) => ({
      transform: "translate3d(-110%, 0, 0)",
      background: `linear-gradient(105deg, transparent 35%, rgba(255, 255, 255, ${round(0.12 + 0.28 * clamp01(ctx.intensity))}) 50%, transparent 65%)`,
    }),
    keyframes: () => [
      { transform: "translate3d(-110%, 0, 0)", offset: 0 },
      { transform: "translate3d(110%, 0, 0)", offset: 0.6 },
      { transform: "translate3d(110%, 0, 0)", offset: 1 },
    ],
  },
};

export function getEnterEffect(id: string): EffectDefinition | null {
  return (ENTER_EFFECT_DEFS as Record<string, EffectDefinition>)[id] ?? null;
}
export function getExitEffect(id: string): EffectDefinition | null {
  return (EXIT_EFFECT_DEFS as Record<string, EffectDefinition>)[id] ?? null;
}
export function getLoopEffect(id: string): LoopEffectDefinition | null {
  return (LOOP_EFFECT_DEFS as Record<string, LoopEffectDefinition>)[id] ?? null;
}

/** Options pour les listes de l'interface (« Aucune » en premier). */
export const enterEffectOptions = () => [{ value: "none", label: "Aucune" }, ...Object.values(ENTER_EFFECT_DEFS).map((e) => ({ value: e.id, label: e.label }))];
export const exitEffectOptions = () => [{ value: "none", label: "Aucune" }, ...Object.values(EXIT_EFFECT_DEFS).map((e) => ({ value: e.id, label: e.label }))];
export const loopEffectOptions = () => [{ value: "none", label: "Aucun" }, ...Object.values(LOOP_EFFECT_DEFS).map((e) => ({ value: e.id, label: e.label }))];
