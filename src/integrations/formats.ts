/**
 * Formats de scène et tailles de source recommandées (fonctions pures, testées
 * dans tests/integrations.test.ts).
 *
 * Principe : l'overlay musical est dessiné à la taille EXACTE de son canvas
 * (overlay.theme.canvasWidth × canvasHeight, rendu « 1:1 » dans la page). La
 * source Web du logiciel de streaming doit donc avoir cette taille-là ; c'est
 * ensuite dans la scène qu'on la réduit si elle est trop grande pour le format
 * du live. Aucune dimension d'overlay n'est modifiée par Batlay.
 */

export type CanvasFormatId = "landscape" | "portrait" | "square";

export interface CanvasFormat {
  id: CanvasFormatId;
  label: string;
  width: number;
  height: number;
  hint: string;
}

export const CANVAS_FORMATS: readonly CanvasFormat[] = [
  { id: "landscape", label: "Paysage", width: 1920, height: 1080, hint: "Twitch, YouTube, scène OBS classique" },
  { id: "portrait", label: "Portrait", width: 1080, height: 1920, hint: "TikTok LIVE, formats verticaux" },
  { id: "square", label: "Carré", width: 1080, height: 1080, hint: "Formats carrés" },
];

export function getCanvasFormat(id: unknown): CanvasFormat {
  return CANVAS_FORMATS.find((f) => f.id === id) ?? CANVAS_FORMATS[0];
}

export function isCanvasFormatId(value: unknown): value is CanvasFormatId {
  return CANVAS_FORMATS.some((f) => f.id === value);
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Part maximale de la scène qu'un overlay devrait occuper avant qu'on conseille
 * de le réduire. 90 % : il reste une marge pour ne pas coller aux bords.
 */
const MAX_SCENE_SHARE = 0.9;

export interface Placement {
  /** Taille à saisir dans la source Web (largeur/hauteur, ou résolution personnalisée). */
  source: Size;
  /** Taille conseillée une fois l'overlay placé dans la scène. */
  displayed: Size;
  /** Facteur de réduction conseillé dans la scène (1 = taille native). */
  scale: number;
  /** Vrai si l'overlay tient dans la scène sans réduction. */
  fitsNatively: boolean;
}

/** Nombre fini et strictement positif, sinon `fallback`. Les tailles d'un overlay importé ne sont pas garanties. */
function positive(n: unknown, fallback: number): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.round(n) : fallback;
}

/** Placement d'une source de taille `source` dans une scène au format `format`. */
export function placeInScene(source: Size, format: CanvasFormat): Placement {
  const width = positive(source.width, 1);
  const height = positive(source.height, 1);
  const limitW = format.width * MAX_SCENE_SHARE;
  const limitH = format.height * MAX_SCENE_SHARE;
  const fitsNatively = width <= format.width && height <= format.height;
  const scale = fitsNatively ? 1 : Math.min(limitW / width, limitH / height);
  // Arrondi au centième : c'est la précision des champs « échelle » des logiciels.
  const rounded = Math.floor(scale * 100) / 100;
  return {
    source: { width, height },
    displayed: { width: Math.round(width * rounded), height: Math.round(height * rounded) },
    scale: rounded,
    fitsNatively,
  };
}

/** Taille de source recommandée pour un overlay musical : celle de son canvas, jamais autre chose. */
export function musicOverlaySourceSize(theme: { canvasWidth: number; canvasHeight: number }): Size {
  return { width: positive(theme.canvasWidth, 800), height: positive(theme.canvasHeight, 250) };
}

/**
 * Zone de chat conseillée quand l'utilisateur a laissé largeur/hauteur sur
 * « Auto ». Paysage : la valeur déjà documentée (420 × 640). Portrait : plus
 * large (l'écran est étroit, les lignes courtes deviennent illisibles) et moins
 * haute, pour rester au-dessus du tiers inférieur que l'interface TikTok
 * recouvre. Ce sont des recommandations, modifiables dans Overlays → Chat.
 */
export const CHAT_RECOMMENDED_SIZE: Record<CanvasFormatId, Size> = {
  landscape: { width: 420, height: 640 },
  portrait: { width: 860, height: 640 },
  square: { width: 480, height: 640 },
};

/** Taille de source pour le chat : la zone choisie dans Overlays → Chat si elle est fixée, sinon la recommandation du format. */
export function chatOverlaySourceSize(options: { width: number; height: number }, format: CanvasFormatId): Size {
  const recommended = CHAT_RECOMMENDED_SIZE[format];
  return {
    width: options.width > 0 ? Math.round(options.width) : recommended.width,
    height: options.height > 0 ? Math.round(options.height) : recommended.height,
  };
}

/** « 800 × 250 px » pour l'affichage. */
export function formatDimensions(size: Size): string {
  return `${size.width} × ${size.height} px`;
}

/** « 800x250 » pour le presse-papiers : ASCII, se colle sans surprise dans n'importe quel champ. */
export function dimensionsClipboardText(size: Size): string {
  return `${size.width}x${size.height}`;
}
