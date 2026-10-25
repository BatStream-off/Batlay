/**
 * Configuration des animations : identifiants d'effets, valeurs par défaut,
 * validation, combinaisons prêtes à l'emploi. Fonctions PURES (aucun DOM),
 * testées dans tests/animation.test.ts.
 *
 * Règle d'or : TOUT ce qui vient d'un fichier, d'un overlay importé, d'une URL
 * ou du réseau passe par une fonction `normalize*` avant d'atteindre le moteur.
 * Une valeur absente prend sa valeur par défaut ; une valeur invalide aussi.
 * Le moteur ne reçoit donc jamais de durée négative, d'effet inconnu ou de
 * fonction d'accélération que le navigateur refuserait (element.animate lève
 * une TypeError sur un `easing` invalide).
 */

// ---------------------------------------------------------------------------
// Identifiants d'effets
// ---------------------------------------------------------------------------

/**
 * Effets d'entrée. Les six premiers existaient déjà dans le modèle
 * (`AnimationKind`, stocké dans chaque overlay depuis la v0.1) : ils gardent
 * leur nom, donc les overlays enregistrés restent valides.
 * Sens des glissements = sens du MOUVEMENT : `slideUp` monte (arrive par le bas).
 */
export const ENTER_EFFECTS = ["none", "fade", "slideLeft", "slideRight", "slideUp", "slideDown", "scale", "pop", "reveal"] as const;
export type EnterEffectId = (typeof ENTER_EFFECTS)[number];

/** Effets de sortie. `scale` (ancien nom) = zoom arrière. */
export const EXIT_EFFECTS = ["none", "fade", "slideLeft", "slideRight", "slideUp", "slideDown", "scale", "shrink", "blur"] as const;
export type ExitEffectId = (typeof EXIT_EFFECTS)[number];

/** Effets décoratifs (répétés). Jamais actifs par défaut. */
export const LOOP_EFFECTS = ["none", "pulse", "glow", "shine", "float", "rotate"] as const;
export type LoopEffectId = (typeof LOOP_EFFECTS)[number];

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
export const isEnterEffect = (v: unknown): v is EnterEffectId => isOneOf(ENTER_EFFECTS, v);
export const isExitEffect = (v: unknown): v is ExitEffectId => isOneOf(EXIT_EFFECTS, v);
export const isLoopEffect = (v: unknown): v is LoopEffectId => isOneOf(LOOP_EFFECTS, v);

// ---------------------------------------------------------------------------
// Bornes
// ---------------------------------------------------------------------------

export const LIMITS = {
  durationMs: { min: 50, max: 3000 },
  delayMs: { min: 0, max: 5000 },
  staggerMs: { min: 0, max: 500 },
  intensity: { min: 0, max: 1 },
  loopPeriodMs: { min: 600, max: 30000 },
  loopRepeat: { min: 1, max: 10 },
} as const;

function clampNumber(v: unknown, fallback: number, { min, max }: { min: number; max: number }): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}
export const clampDuration = (v: unknown, fallback = 400) => Math.round(clampNumber(v, fallback, LIMITS.durationMs));
export const clampDelay = (v: unknown, fallback = 0) => Math.round(clampNumber(v, fallback, LIMITS.delayMs));
export const clampIntensity = (v: unknown, fallback = 0.5) => clampNumber(v, fallback, LIMITS.intensity);

// ---------------------------------------------------------------------------
// Fonctions d'accélération
// ---------------------------------------------------------------------------

export const EASINGS = [
  { id: "smooth", label: "Fluide", css: "cubic-bezier(0.16, 1, 0.3, 1)" },
  { id: "easeOut", label: "Décélération douce", css: "ease-out" },
  { id: "easeInOut", label: "Symétrique", css: "ease-in-out" },
  { id: "easeIn", label: "Accélération", css: "ease-in" },
  { id: "linear", label: "Linéaire", css: "linear" },
  { id: "snappy", label: "Nerveuse", css: "cubic-bezier(0.2, 0.9, 0.1, 1)" },
  { id: "back", label: "Léger dépassement", css: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
] as const;

export const DEFAULT_EASING = EASINGS[0].css;

const EASING_KEYWORDS = new Set(["linear", "ease", "ease-in", "ease-out", "ease-in-out"]);
const NUM = String.raw`\s*(-?\d+(?:\.\d+)?)\s*`;
const CUBIC = new RegExp(`^cubic-bezier\\(${NUM},${NUM},${NUM},${NUM}\\)$`);

/**
 * Accepte un mot-clé CSS ou un `cubic-bezier(x1, y1, x2, y2)` valide
 * (x1, x2 ∈ [0, 1] : sinon le navigateur refuse la valeur). Tout le reste
 * (`steps()`, texte arbitraire, `url(...)`…) retombe sur la valeur par défaut.
 */
export function normalizeEasing(v: unknown, fallback: string = DEFAULT_EASING): string {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  if (EASING_KEYWORDS.has(s)) return s;
  const m = s.match(CUBIC);
  if (!m) return fallback;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  if (x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1 || Math.abs(y1) > 10 || Math.abs(y2) > 10) return fallback;
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/** Libellé lisible d'une accélération (« Personnalisée » si elle ne fait pas partie de la liste). */
export function easingLabel(css: string): string {
  const n = normalizeEasing(css);
  return EASINGS.find((e) => normalizeEasing(e.css) === n)?.label ?? "Personnalisée";
}

// ---------------------------------------------------------------------------
// Une animation (entrée, sortie) entièrement résolue : ce que reçoit le moteur
// ---------------------------------------------------------------------------

export interface MotionSpec {
  effect: string;
  durationMs: number;
  delayMs: number;
  easing: string;
  /** 0 = à peine visible, 1 = ample. Règle distances, échelles, flou. */
  intensity: number;
}

export interface LoopSpec {
  effect: LoopEffectId;
  /** Durée d'un cycle. */
  periodMs: number;
  intensity: number;
  /**
   * `change` : rejoué quelques fois après chaque changement de morceau, puis
   * s'arrête (par défaut : aucune boucle permanente). `always` : en continu
   * tant que la musique joue (mise en pause sinon).
   */
  trigger: "change" | "always";
  /** Nombre de cycles pour `trigger: "change"`. */
  repeat: number;
}

// ---------------------------------------------------------------------------
// Overlay entier (OverlayConfig.animations) — champs historiques + nouveaux champs FACULTATIFS
// ---------------------------------------------------------------------------

export interface OverlayAnimationSettings {
  enabled: boolean;
  enter: EnterEffectId;
  exit: ExitEffectId;
  durationMs: number;
  delayMs: number;
  easing: string;
  intensity: number;
  /** Décalage entre composants, dans l'ordre d'empilement (0 = tous ensemble). */
  staggerMs: number;
  /** Respecte le réglage « réduire les animations » du système (par défaut : oui). */
  respectReducedMotion: boolean;
}

export const DEFAULT_OVERLAY_ANIMATION: OverlayAnimationSettings = {
  enabled: true,
  enter: "fade",
  exit: "fade",
  durationMs: 400,
  delayMs: 0,
  easing: DEFAULT_EASING,
  intensity: 0.5,
  staggerMs: 0,
  respectReducedMotion: true,
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Lit `OverlayConfig.animations`, quel que soit son âge : les anciens overlays
 * n'ont que `{ enter, exit, durationMs, easing }`, les très anciens ou les
 * fichiers abîmés rien du tout.
 */
export function normalizeOverlayAnimation(raw: unknown): OverlayAnimationSettings {
  const d = DEFAULT_OVERLAY_ANIMATION;
  if (!isRecord(raw)) return { ...d };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : d.enabled,
    enter: isEnterEffect(raw.enter) ? raw.enter : d.enter,
    exit: isExitEffect(raw.exit) ? raw.exit : d.exit,
    durationMs: clampDuration(raw.durationMs, d.durationMs),
    delayMs: clampDelay(raw.delayMs, d.delayMs),
    easing: normalizeEasing(raw.easing, d.easing),
    intensity: clampIntensity(raw.intensity, d.intensity),
    staggerMs: Math.round(clampNumber(raw.staggerMs, d.staggerMs, LIMITS.staggerMs)),
    respectReducedMotion: typeof raw.respectReducedMotion === "boolean" ? raw.respectReducedMotion : d.respectReducedMotion,
  };
}

// ---------------------------------------------------------------------------
// Composant (OverlayComponentConfig.animation) — facultatif : absent = « comme l'overlay »
// ---------------------------------------------------------------------------

export interface ComponentAnimationSettings {
  /** `inherit` : réglages de l'overlay · `custom` : réglages ci-dessous · `none` : jamais animé. */
  mode: "inherit" | "custom" | "none";
  enter: EnterEffectId;
  exit: ExitEffectId;
  durationMs: number;
  /** Délai propre au composant (s'ajoute à celui de l'overlay en mode `inherit`). */
  delayMs: number;
  easing: string;
  intensity: number;
  loop: LoopSpec;
}

export const DEFAULT_LOOP: LoopSpec = { effect: "none", periodMs: 1800, intensity: 0.4, trigger: "change", repeat: 2 };

export function normalizeLoop(raw: unknown): LoopSpec {
  const d = DEFAULT_LOOP;
  if (!isRecord(raw)) return { ...d };
  return {
    effect: isLoopEffect(raw.effect) ? raw.effect : d.effect,
    periodMs: Math.round(clampNumber(raw.periodMs, d.periodMs, LIMITS.loopPeriodMs)),
    intensity: clampIntensity(raw.intensity, d.intensity),
    trigger: raw.trigger === "always" ? "always" : "change",
    repeat: Math.round(clampNumber(raw.repeat, d.repeat, LIMITS.loopRepeat)),
  };
}

export function normalizeComponentAnimation(raw: unknown, overlay: OverlayAnimationSettings = DEFAULT_OVERLAY_ANIMATION): ComponentAnimationSettings {
  const r = isRecord(raw) ? raw : {};
  return {
    mode: r.mode === "custom" || r.mode === "none" ? r.mode : "inherit",
    enter: isEnterEffect(r.enter) ? r.enter : overlay.enter,
    exit: isExitEffect(r.exit) ? r.exit : overlay.exit,
    durationMs: clampDuration(r.durationMs, overlay.durationMs),
    delayMs: clampDelay(r.delayMs, 0),
    easing: normalizeEasing(r.easing, overlay.easing),
    intensity: clampIntensity(r.intensity, overlay.intensity),
    loop: normalizeLoop(r.loop),
  };
}

export interface ResolvedComponentMotion {
  /** `null` = pas d'animation d'entrée / de sortie pour ce composant. */
  enter: MotionSpec | null;
  exit: MotionSpec | null;
  loop: LoopSpec | null;
}

/**
 * Animation effective d'un composant : combine l'overlay, le composant, sa
 * place dans l'ordre d'empilement (décalage) et l'état global (désactivé,
 * mouvement réduit). C'est la seule fonction que le rendu consulte.
 */
export function resolveComponentMotion(
  overlayRaw: unknown,
  componentRaw: unknown,
  { index = 0, motionAllowed = true }: { index?: number; motionAllowed?: boolean } = {}
): ResolvedComponentMotion {
  const o = normalizeOverlayAnimation(overlayRaw);
  const c = normalizeComponentAnimation(componentRaw, o);
  if (!motionAllowed || !o.enabled || c.mode === "none") return { enter: null, exit: null, loop: null };
  const custom = c.mode === "custom";
  const base = {
    durationMs: custom ? c.durationMs : o.durationMs,
    easing: custom ? c.easing : o.easing,
    intensity: custom ? c.intensity : o.intensity,
  };
  const delayMs = clampDelay((custom ? 0 : o.delayMs + o.staggerMs * Math.max(0, index)) + c.delayMs);
  const enterId = custom ? c.enter : o.enter;
  const exitId = custom ? c.exit : o.exit;
  return {
    enter: enterId === "none" ? null : { effect: enterId, delayMs, ...base },
    // Une sortie n'attend jamais : l'ancienne information doit laisser la place tout de suite.
    exit: exitId === "none" ? null : { effect: exitId, delayMs: 0, ...base },
    loop: c.loop.effect === "none" ? null : c.loop,
  };
}

// ---------------------------------------------------------------------------
// Combinaisons prêtes à l'emploi
// ---------------------------------------------------------------------------

export interface MotionPreset {
  id: "subtle" | "smooth" | "dynamic" | "gaming" | "none";
  label: string;
  description: string;
  settings: Partial<OverlayAnimationSettings>;
}

export const MOTION_PRESETS: readonly MotionPreset[] = [
  {
    id: "subtle",
    label: "Subtil",
    description: "Fondu court, presque invisible : idéal pour Minimal et Compact.",
    settings: { enabled: true, enter: "fade", exit: "fade", durationMs: 350, delayMs: 0, staggerMs: 0, easing: "ease-out", intensity: 0.3 },
  },
  {
    id: "smooth",
    label: "Fluide",
    description: "Montée douce et décalée des éléments : Modern et Glass.",
    settings: { enabled: true, enter: "slideUp", exit: "fade", durationMs: 550, delayMs: 0, staggerMs: 60, easing: DEFAULT_EASING, intensity: 0.45 },
  },
  {
    id: "dynamic",
    label: "Dynamique",
    description: "Apparition avec léger rebond, sortie en zoom arrière : Large.",
    settings: { enabled: true, enter: "pop", exit: "scale", durationMs: 450, delayMs: 0, staggerMs: 40, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)", intensity: 0.55 },
  },
  {
    id: "gaming",
    label: "Gaming",
    description: "Glissement latéral nerveux, sortie floutée : Neon.",
    settings: { enabled: true, enter: "slideLeft", exit: "blur", durationMs: 380, delayMs: 0, staggerMs: 50, easing: "cubic-bezier(0.2, 0.9, 0.1, 1)", intensity: 0.8 },
  },
  { id: "none", label: "Sans animation", description: "Les changements s'affichent instantanément.", settings: { enabled: false } },
];

/** Applique une combinaison sans toucher aux champs qu'elle ne définit pas (ex. mouvement réduit). */
export function applyMotionPreset(current: unknown, presetId: MotionPreset["id"]): OverlayAnimationSettings {
  const preset = MOTION_PRESETS.find((p) => p.id === presetId);
  return normalizeOverlayAnimation({ ...normalizeOverlayAnimation(current), ...(preset?.settings ?? {}) });
}

/** Combinaison qui correspond exactement aux réglages actuels, ou `null` (réglages personnalisés). */
export function matchMotionPreset(current: unknown): MotionPreset["id"] | null {
  const now = normalizeOverlayAnimation(current);
  for (const p of MOTION_PRESETS) {
    if (p.id === "none") {
      if (!now.enabled) return "none";
      continue;
    }
    const target = applyMotionPreset(now, p.id);
    if ((Object.keys(p.settings) as (keyof OverlayAnimationSettings)[]).every((k) => target[k] === now[k])) return p.id;
  }
  return null;
}
