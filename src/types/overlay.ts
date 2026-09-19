export type OverlayComponentType =
  | "artwork"
  | "title"
  | "artist"
  | "album"
  | "progressBar"
  | "elapsedTime"
  | "duration"
  | "source";

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

export interface ComponentStyle {
  // Texte
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  textAlign?: "left" | "center" | "right";
  opacity?: number;
  maxWidth?: number;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  // Artwork
  borderRadius?: number;
  shape?: "square" | "circle";
  borderWidth?: number;
  borderColor?: string;
  shadow?: boolean;
  // Fond du bloc
  backgroundColor?: string;
  backgroundOpacity?: number;
  gradient?: string;
  blur?: number;
  // Progress bar
  trackColor?: string;
  fillColor?: string;
}

export interface OverlayComponentConfig {
  id: string;
  type: OverlayComponentType;
  visible: boolean;
  transform: ComponentTransform;
  style: ComponentStyle;
  order: number;
}

export interface OverlayTheme {
  canvasWidth: number;
  canvasHeight: number;
  padding: number;
  gap: number;
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
