/**
 * Couleur d'accent des BOUTONS (violet Batlay par défaut) : réglable par
 * l'utilisateur depuis Settings > Apparence, indépendamment du thème
 * clair/sombre (voir src/theme/apply-theme.ts pour ce dernier).
 *
 * Alimente les variables CSS --signal-400 / --signal-500 / --signal-600,
 * que tailwind.config.js expose comme bg-signal-600, hover:bg-signal-500,
 * border-signal-500, accent-signal-500, etc. Les valeurs par défaut (celles
 * d'origine) restent posées dans src/styles/globals.css : ce module ne fait
 * qu'ajouter une SURCOUCHE optionnelle par-dessus, jamais un remplacement
 * de la source de vérité.
 */

/** Couleur d'origine de Batlay (ancien signal-600 fixe), utilisée par défaut. */
export const DEFAULT_ACCENT_HEX = "#7C4DFF";

/** Sous-ensemble de HTMLElement utilisé ici (permet de tester sans DOM). */
export interface AccentRoot {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** "#7C4DFF" -> [124, 77, 255] ; `null` si la chaîne n'est pas un hex #rrggbb valide. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  return [Math.round((rgb[0] + m) * 255), Math.round((rgb[1] + m) * 255), Math.round((rgb[2] + m) * 255)];
}

/** Éclaircit une couleur (nuance plus claire pour le survol / les accents subtils). */
function lighten(hex: string, deltaLightness: number): [number, number, number] {
  const rgb = hexToRgb(hex) ?? hexToRgb(DEFAULT_ACCENT_HEX)!;
  const [h, s, l] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  return hslToRgb(h, s, clamp(l + deltaLightness, 0, 100));
}

const triplet = (rgb: [number, number, number]) => `${rgb[0]} ${rgb[1]} ${rgb[2]}`;

/**
 * Pose les 3 nuances dérivées de la couleur choisie comme variables CSS
 * (600 = couleur choisie telle quelle, 500/400 = versions éclaircies pour le
 * survol et les accents). Avec `hex` invalide ou `null`, retire la surcouche
 * pour retomber sur les valeurs par défaut de globals.css.
 */
export function applyAccentColor(root: AccentRoot, hex: string | null): void {
  const base = hex ? hexToRgb(hex) : null;
  if (!base) {
    root.style.removeProperty("--signal-400");
    root.style.removeProperty("--signal-500");
    root.style.removeProperty("--signal-600");
    return;
  }
  root.style.setProperty("--signal-600", triplet(base));
  root.style.setProperty("--signal-500", triplet(lighten(hex as string, 8)));
  root.style.setProperty("--signal-400", triplet(lighten(hex as string, 16)));
}
