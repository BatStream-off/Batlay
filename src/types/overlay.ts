export type OverlayComponentType =
  | "artwork"
  | "title"
  | "artist"
  | "album"
  | "progressBar"
  | "elapsedTime"
  | "remainingTime"
  | "duration"
  | "source"
  /** Texte libre, avec variables {title} {artist} {album} {source}. */
  | "text"
  /** Rectangle décoratif : carte, séparateur, pastille... */
  | "shape";

export type AnimationKind =
  | "fade"
  | "slideLeft"
  | "slideRight"
  | "slideUp"
  | "slideDown"
  | "scale";

export interface AnimationConfig {
  enter: AnimationKind;
  exit: AnimationKind;
  durationMs: number;
  easing: string; // ex. "ease-out", "cubic-bezier(0.16, 1, 0.3, 1)"
}

export interface ComponentTransform {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Briques de style réutilisables (composants ET fond de l'overlay) ---

export interface GradientConfig {
  type: "linear" | "radial";
  /** Degrés CSS : 0 = vers le haut, 90 = vers la droite, 180 = vers le bas. */
  angle: number;
  from: string;
  to: string;
}

/** Remplissage d'un fond : aucun, uni ou dégradé, avec transparence. */
export interface FillConfig {
  mode: "none" | "solid" | "gradient";
  color: string;
  /** Transparence : 0 = invisible, 1 = opaque. S'applique à l'uni comme au dégradé. */
  opacity: number;
  gradient: GradientConfig;
}

export interface BorderConfig {
  width: number;
  color: string;
  style: "solid" | "dashed" | "dotted";
}

export interface ShadowConfig {
  enabled: boolean;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  /** 0 à 1, appliqué à `color`. */
  opacity: number;
}

export type TextOverflowMode =
  /** Coupe avec « … » (comportement historique). */
  | "ellipsis"
  /** Passe à la ligne, dans la limite de la hauteur du bloc. */
  | "wrap"
  /** Défile en boucle SEULEMENT si le texte est plus large que le bloc. */
  | "marquee";

export interface ComponentStyle {
  // --- Texte ---
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  textAlign?: "left" | "center" | "right";
  verticalAlign?: "top" | "middle" | "bottom";
  italic?: boolean;
  letterSpacing?: number;
  lineHeight?: number;
  opacity?: number;
  maxWidth?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  textShadow?: ShadowConfig;
  /** Comportement quand le texte est plus large que le bloc. Défaut : « ellipsis » (« marquee » pour l'artiste). */
  overflow?: TextOverflowMode;
  /** Vitesse du défilement, en px/s. */
  marqueeSpeed?: number;
  /** Séparateur des artistes (défaut « , »). Ne s'applique qu'au composant Artiste. */
  artistSeparator?: string;

  // --- Bloc (tous les composants) ---
  /** Fond du bloc : couleur, transparence, dégradé. */
  background?: FillConfig;
  border?: BorderConfig;
  boxShadow?: ShadowConfig;
  borderRadius?: number;
  /** Marge intérieure (px), utile pour un texte sur fond coloré. */
  padding?: number;

  // --- Artwork ---
  shape?: "square" | "circle";
  objectFit?: "cover" | "contain";

  // --- Progress bar ---
  trackColor?: string;
  fillColor?: string;

  // --- Formats hérités (antérieurs à l'éditeur v2) : toujours lus, plus écrits ---
  /** @deprecated Remplacé par `border` (lu en repli pour les anciens overlays et les presets). */
  borderWidth?: number;
  /** @deprecated Remplacé par `border`. */
  borderColor?: string;
  /** @deprecated Remplacé par `boxShadow` ; `true` = ombre douce par défaut. */
  shadow?: boolean;
  /** @deprecated Remplacé par `background`. */
  backgroundColor?: string;
  /** @deprecated Remplacé par `background.opacity`. */
  backgroundOpacity?: number;
}

export interface OverlayComponentConfig {
  id: string;
  type: OverlayComponentType;
  visible: boolean;
  transform: ComponentTransform;
  style: ComponentStyle;
  /** Ordre d'empilement : le plus grand est dessiné au-dessus. */
  order: number;
  /** Nom du calque affiché dans l'éditeur. */
  name?: string;
  /** Verrouillé : ne peut plus être déplacé ni redimensionné à la souris. */
  locked?: boolean;
  /** Contenu du composant « text » (avec variables). */
  content?: string;
}

export interface OverlayTheme {
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
  gap: number;
  /** Fond de l'overlay entier (le canvas). Absent = transparent. */
  background?: FillConfig;
  border?: BorderConfig;
  borderRadius?: number;
  boxShadow?: ShadowConfig;
}

export interface OverlayConfig {
  schemaVersion: 1;
  id: string;
  name: string;
  presetId: PresetId;
  components: OverlayComponentConfig[];
  theme: OverlayTheme;
  animations: AnimationConfig;
  createdAt: number;
  updatedAt: number;
}

export type PresetId =
  | "minimal"
  | "modern"
  | "glass"
  | "neon"
  | "compact"
  | "large"
  | "blank";
