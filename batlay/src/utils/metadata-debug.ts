/**
 * Journal de diagnostic des métadonnées (titre / artiste / album) reçues de
 * Windows. DÉSACTIVÉ par défaut : il ne sert qu'à comprendre, sur une vraie
 * machine, pourquoi un accent ou un artiste s'affiche mal.
 *
 * Activation : ouvrir la console de Batlay (F12 ou Ctrl+Maj+I) et taper
 *     localStorage.setItem("batlay:debug-metadata", "1")
 * puis relancer. Désactivation : localStorage.removeItem("batlay:debug-metadata").
 *
 * Pour ne pas inonder la console (un relevé toutes les 400 ms – 3 s), on ne
 * journalise QUE les morceaux qui illustrent l'un des trois cas utiles, et une
 * seule fois par morceau :
 *   - "accent"         : lettres accentuées latines (é, ö, ç, ø...), ou « � » (U+FFFD),
 *                        signe qu'un accent a déjà été perdu en amont ;
 *   - "multi-artistes" : le champ artiste contient plusieurs noms ;
 *   - "non-latin"      : écriture non latine (japonais, cyrillique, arabe...).
 */

export const METADATA_DEBUG_STORAGE_KEY = "batlay:debug-metadata";

export type MetadataDebugCase = "accent" | "multi-artistes" | "non-latin";

export interface MetadataFields {
  title: string;
  artist: string;
  album: string;
  /** Diagnostic seulement : `AlbumArtist` déclaré par le lecteur (voir system-media.ts). */
  albumArtist?: string;
}

/**
 * Rend visibles les caractères invisibles ou ambigus : l'ASCII imprimable reste
 * tel quel, tout le reste devient `[U+XXXX]`. « Angèle » -> « Ang[U+00E8]le »,
 * et un « è » décomposé (e + accent combinant) se distingue enfin d'un « è » simple.
 */
export function describeCodePoints(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number;
    out += cp >= 0x20 && cp <= 0x7e ? ch : `[U+${cp.toString(16).toUpperCase().padStart(4, "0")}]`;
  }
  return out;
}

function hasNonLatinLetter(text: string): boolean {
  for (const ch of text) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true;
  }
  return false;
}

/** Cas illustrés par ces métadonnées (peut en cumuler plusieurs, ou aucun). */
export function classifyMetadataDebugCases(fields: MetadataFields): MetadataDebugCase[] {
  const all = `${fields.title}\n${fields.artist}\n${fields.album}`;
  const cases: MetadataDebugCase[] = [];
  // U+FFFD = un accent DÉJÀ perdu en amont : c'est le symptôme même qu'on cherche à voir.
  if (/[\u00C0-\u024F\uFFFD]/.test(all)) cases.push("accent");
  if (/[,;&/]|\b(?:feat|ft|featuring)\b\.?/i.test(fields.artist)) cases.push("multi-artistes");
  if (hasNonLatinLetter(all)) cases.push("non-latin");
  return cases;
}

function formatField(label: string, raw: string, cleaned: string | undefined): string {
  const lines = [`  ${label} brut  : ${JSON.stringify(raw)}  ${describeCodePoints(raw)}`];
  if (cleaned !== undefined) {
    lines.push(`  ${label} propre: ${JSON.stringify(cleaned)}  ${describeCodePoints(cleaned)}`);
  }
  return lines.join("\n");
}

export interface MetadataDebugLoggerOptions {
  isEnabled: () => boolean;
  write: (message: string) => void;
}

/**
 * Fabrique le journaliseur. Renvoie une fonction (trackKey, brut, nettoyé) ;
 * elle ne fait rien tant que `isEnabled()` est faux.
 */
export function createMetadataDebugLogger({ isEnabled, write }: MetadataDebugLoggerOptions) {
  const seen = new Set<string>();
  return function logMetadata(trackKey: string, raw: MetadataFields, cleaned: MetadataFields): void {
    if (!isEnabled() || seen.has(trackKey)) return;
    const cases = classifyMetadataDebugCases(cleaned);
    // Le brut peut illustrer un cas que le nettoyage a fait disparaître (mojibake réparé).
    for (const c of classifyMetadataDebugCases(raw)) if (!cases.includes(c)) cases.push(c);
    if (cases.length === 0) return;

    if (seen.size > 200) seen.clear();
    seen.add(trackKey);

    const lost = [raw.title, raw.artist, raw.album].some((v) => v.includes("\uFFFD"));
    write(
      [
        `[Batlay][debug-metadata] cas : ${cases.join(", ")}${lost ? "  ⚠ U+FFFD présent : information déjà perdue en amont" : ""}`,
        formatField("titre  ", raw.title, cleaned.title),
        formatField("artiste", raw.artist, cleaned.artist),
        formatField("album  ", raw.album, cleaned.album),
        ...(raw.albumArtist !== undefined ? [formatField("albumArtist", raw.albumArtist, undefined)] : []),
      ].join("\n")
    );
  };
}

/** Lit le drapeau dans localStorage (absent, ou storage indisponible = désactivé). */
export function isMetadataDebugEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(METADATA_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
