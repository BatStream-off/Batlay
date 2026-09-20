import type { CSSProperties } from "react";
import type {
  BorderConfig,
  ComponentStyle,
  FillConfig,
  OverlayComponentConfig,
  OverlayTheme,
  ShadowConfig,
} from "@/types/overlay";

/**
 * Traduction (pure) de la configuration d'un overlay en CSS. Utilisée à
 * l'identique par la page OBS, l'éditeur et les miniatures : ce que l'on
 * règle dans l'éditeur est exactement ce qui s'affiche à l'antenne.
 *
 * Volontairement AUCUN `backdrop-filter` : dans une Browser Source OBS, la
 * page est transparente et n'a rien derrière elle à flouter (le flou ne
 * s'applique pas à la scène). Proposer ce réglage serait trompeur.
 */

// ---------------------------------------------------------------------------
// Couleurs
// ---------------------------------------------------------------------------

/** "#abc", "#aabbcc", "rgb(...)", "rgba(...)" -> [r,g,b,a] ; null si non reconnu. */
export function parseColor(input: string): [number, number, number, number] | null {
  const value = input.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(value);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
  }
  return null;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1));

/**
 * Applique une transparence à une couleur (multipliée avec celle qu'elle a
 * déjà). Une couleur non reconnue (nom CSS...) est renvoyée telle quelle :
 * on préfère ignorer la transparence plutôt que produire un CSS invalide.
 */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color);
  if (!parsed) return color;
  const [r, g, b, a] = parsed;
  return `rgba(${r}, ${g}, ${b}, ${round(a * clamp01(alpha))})`;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

// ---------------------------------------------------------------------------
// Valeurs par défaut
// ---------------------------------------------------------------------------

export function defaultFill(overrides: Partial<FillConfig> = {}): FillConfig {
  return {
    mode: "solid",
    color: "#000000",
    opacity: 0.6,
    gradient: { type: "linear", angle: 135, from: "#9B6BFF", to: "#37E29A" },
    ...overrides,
  };
}

export function defaultBorder(overrides: Partial<BorderConfig> = {}): BorderConfig {
  return { width: 2, color: "#FFFFFF", style: "solid", ...overrides };
}

export function defaultShadow(overrides: Partial<ShadowConfig> = {}): ShadowConfig {
  return { enabled: true, x: 0, y: 8, blur: 24, spread: -6, color: "#000000", opacity: 0.5, ...overrides };
}

/** Ombre douce historique (`shadow: true` des presets). */
const LEGACY_SHADOW = "0 8px 24px -6px rgba(0,0,0,0.5)";

// ---------------------------------------------------------------------------
// Remplissage / bordure / ombre -> CSS
// ---------------------------------------------------------------------------

/** CSS `background` d'un remplissage, ou undefined s'il n'y en a pas. */
export function fillToCss(fill: FillConfig | undefined): string | undefined {
  if (!fill || fill.mode === "none") return undefined;
  if (fill.mode === "solid") {
    if (clamp01(fill.opacity) === 0) return undefined;
    return withAlpha(fill.color, fill.opacity);
  }
  const { type, angle, from, to } = fill.gradient;
  const a = withAlpha(from, fill.opacity);
  const b = withAlpha(to, fill.opacity);
  return type === "radial" ? `radial-gradient(circle at center, ${a}, ${b})` : `linear-gradient(${round(angle)}deg, ${a}, ${b})`;
}

/**
 * Fond effectif d'un composant : `background` s'il existe, sinon l'ancien
 * couple backgroundColor/backgroundOpacity (déclaré avant l'éditeur v2 mais
 * jamais rendu jusqu'ici).
 */
export function resolveFill(style: ComponentStyle): FillConfig | undefined {
  if (style.background) return style.background;
  if (style.backgroundColor) {
    return defaultFill({ color: style.backgroundColor, opacity: style.backgroundOpacity ?? 1 });
  }
  return undefined;
}

/** Bordure effective : `border`, sinon borderWidth/borderColor hérités (presets Glass, Neon). */
export function resolveBorder(style: ComponentStyle): BorderConfig | undefined {
  if (style.border) return style.border.width > 0 ? style.border : undefined;
  if (style.borderWidth) return defaultBorder({ width: style.borderWidth, color: style.borderColor ?? "transparent" });
  return undefined;
}

export function shadowToCss(shadow: ShadowConfig | undefined): string | undefined {
  if (!shadow || !shadow.enabled) return undefined;
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${withAlpha(shadow.color, shadow.opacity)}`;
}

/** Ombre de texte : pas de « spread » en CSS. */
export function textShadowToCss(shadow: ShadowConfig | undefined): string | undefined {
  if (!shadow || !shadow.enabled) return undefined;
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${withAlpha(shadow.color, shadow.opacity)}`;
}

export function resolveBoxShadow(style: ComponentStyle): string | undefined {
  if (style.boxShadow) return shadowToCss(style.boxShadow);
  return style.shadow ? LEGACY_SHADOW : undefined;
}

// ---------------------------------------------------------------------------
// Polices
// ---------------------------------------------------------------------------

/**
 * Polices proposées. OBS n'a pas accès aux polices web de Batlay : seules
 * celles INSTALLÉES sur le PC qui fait tourner OBS s'affichent, d'où des
 * piles de repli systématiques.
 */
export const FONT_OPTIONS: { label: string; value: string }[] = [
  { label: "Inter (défaut)", value: "'Inter', system-ui, sans-serif" },
  { label: "Segoe UI", value: "'Segoe UI', system-ui, sans-serif" },
  { label: "Arial", value: "Arial, Helvetica, sans-serif" },
  { label: "Verdana", value: "Verdana, Geneva, sans-serif" },
  { label: "Trebuchet MS", value: "'Trebuchet MS', sans-serif" },
  { label: "Impact", value: "Impact, 'Arial Narrow Bold', sans-serif" },
  { label: "Georgia (serif)", value: "Georgia, 'Times New Roman', serif" },
  { label: "Courier New (mono)", value: "'Courier New', Courier, monospace" },
  { label: "Consolas (mono)", value: "Consolas, 'Courier New', monospace" },
];

export const DEFAULT_FONT_STACK = FONT_OPTIONS[0].value;

export function fontStack(family: string | undefined): string {
  return family && family.trim() ? family : DEFAULT_FONT_STACK;
}

// ---------------------------------------------------------------------------
// Styles CSS
// ---------------------------------------------------------------------------

/** Cadre (fond, bordure, arrondi, ombre) de l'overlay entier. Dessiné sur un calque dédié : les coordonnées des composants restent celles du canvas. */
export function canvasFrameStyle(theme: OverlayTheme): CSSProperties {
  const border = theme.border && theme.border.width > 0 ? theme.border : undefined;
  return {
    position: "absolute",
    inset: 0,
    boxSizing: "border-box",
    pointerEvents: "none",
    background: fillToCss(theme.background),
    border: border ? `${border.width}px ${border.style} ${border.color}` : undefined,
    borderRadius: theme.borderRadius || undefined,
    boxShadow: shadowToCss(theme.boxShadow),
  };
}

/** Géométrie + habillage communs à tous les composants. */
export function componentBoxStyle(component: OverlayComponentConfig): CSSProperties {
  const s = component.style;
  const border = resolveBorder(s);
  const isCircleArtwork = component.type === "artwork" && s.shape === "circle";
  return {
    position: "absolute",
    boxSizing: "border-box",
    left: component.transform.x,
    top: component.transform.y,
    width: component.transform.width,
    height: component.transform.height,
    background: fillToCss(resolveFill(s)),
    border: border ? `${border.width}px ${border.style} ${border.color}` : undefined,
    borderRadius: isCircleArtwork ? "50%" : s.borderRadius || undefined,
    boxShadow: resolveBoxShadow(s),
    opacity: s.opacity ?? undefined,
    padding: s.padding || undefined,
  };
}

const V_ALIGN: Record<NonNullable<ComponentStyle["verticalAlign"]>, CSSProperties["alignItems"]> = {
  top: "flex-start",
  middle: "center",
  bottom: "flex-end",
};

/** Style du conteneur d'un composant texte (le texte lui-même est dans un enfant, voir OverlayPreview). */
export function textBoxStyle(component: OverlayComponentConfig): CSSProperties {
  const s = component.style;
  return {
    display: "flex",
    alignItems: V_ALIGN[s.verticalAlign ?? "top"],
    overflow: "hidden",
    maxWidth: s.maxWidth,
    fontSize: s.fontSize ?? 16,
    fontWeight: s.fontWeight ?? 400,
    fontStyle: s.italic ? "italic" : undefined,
    color: s.color ?? "#FFFFFF",
    textAlign: s.textAlign ?? "left",
    textTransform: s.textTransform ?? "none",
    letterSpacing: s.letterSpacing ? `${s.letterSpacing}px` : undefined,
    lineHeight: s.lineHeight ? String(s.lineHeight) : undefined,
    textShadow: textShadowToCss(s.textShadow),
    fontFamily: fontStack(s.fontFamily),
  };
}

// ---------------------------------------------------------------------------
// Texte
// ---------------------------------------------------------------------------

/** Remplace {title} {artist} {album} {source} dans un texte libre. Variable inconnue : laissée telle quelle. */
export function renderTemplate(
  template: string,
  values: { title: string; artist: string; album: string; source: string }
): string {
  return template.replace(/\{(title|artist|album|source)\}/g, (_m, key: keyof typeof values) => values[key]);
}
