/**
 * Hygiène des métadonnées (titre, artiste, album) reçues de l'extérieur.
 *
 * ⚠️ Ceci n'est PAS la correction de la cause racine des "�" (voir
 * electron/services/system-media.ts : la sortie PowerShell était lue avec
 * le mauvais encodage). C'est un filet de sécurité pour les cas où la
 * SOURCE elle-même fournit un texte mal décodé — typiquement un lecteur
 * local qui lit des tags MP3 (ID3) UTF-8 comme s'ils étaient en
 * Windows-1252 et expose donc "CafÃ©" au lieu de "Café" à Windows.
 *
 * Un "�" (U+FFFD) déjà présent ne peut PAS être réparé : l'information
 * est perdue. On ne le masque donc pas — il doit rester visible pour
 * signaler un problème en amont plutôt que d'être caché.
 */

/** Points de code Unicode de Windows-1252 dans la plage 0x80–0x9F -> octet d'origine. */
const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** Signature typique d'un UTF-8 relu en Latin-1/Windows-1252 : "Ã©", "Ã¨", "Â°", "â€™"... */
const MOJIBAKE_HINT = /[ÃÂâ]/;

/**
 * Tente d'inverser "UTF-8 lu comme Windows-1252". N'accepte le résultat que
 * s'il est un UTF-8 STRICTEMENT valide, plus court que l'entrée et sans
 * U+FFFD : un texte légitime ("Ã" isolé dans un nom portugais, par
 * exemple) échoue à ce test et reste intact.
 */
function tryReverseMojibake(text: string): string | null {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code <= 0xff) bytes[i] = code;
    else if (CP1252_TO_BYTE[code] !== undefined) bytes[i] = CP1252_TO_BYTE[code];
    else return null; // caractère impossible à produire par ce type d'erreur
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.length < text.length && !decoded.includes("\ufffd")) return decoded;
  } catch {
    /* pas de l'UTF-8 valide : ce n'était pas un mojibake */
  }
  return null;
}

export function repairMojibake(text: string): string {
  let current = text;
  // Deux passes maximum : certains lecteurs "double-encodent" (UTF-8 -> 1252 -> UTF-8 -> 1252).
  for (let pass = 0; pass < 2 && MOJIBAKE_HINT.test(current); pass++) {
    const fixed = tryReverseMojibake(current);
    if (fixed === null) break;
    current = fixed;
  }
  return current;
}

/**
 * Caractères de contrôle sans valeur d'affichage : NUL (fréquent en fin de tag),
 * C0 hors tabulation/retours à la ligne (qui deviennent des espaces plus bas),
 * DEL et C1 (\u0080-\u009f, résidus d'un mauvais décodage non réparable).
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;

/**
 * Invisibles supprimés PARTOUT : espace de largeur nulle (U+200B), joint de
 * mot (U+2060) et BOM / espace insécable de largeur nulle (U+FEFF). Aucun n'a
 * de sens à l'intérieur d'un nom et ils cassent les comparaisons/recherches.
 */
const ALWAYS_INVISIBLE = /[\u200B\u2060\uFEFF]/g;

/**
 * ZWNJ (U+200C) et ZWJ (U+200D) sont, eux, PORTEURS DE SENS à l'intérieur d'un
 * texte : séquences d'emoji composés (👨‍👩‍👧), orthographe persane, conjonctions
 * indiennes. On ne les retire donc qu'en bordure (là où ils ne peuvent être que
 * du bruit), jamais au milieu — sinon on réécrirait des noms légitimes.
 */
const EDGE_NOISE = /^[\s\u200C\u200D]+|[\s\u200C\u200D]+$/g;

/**
 * Point d'entrée unique pour tout texte de métadonnées (fonction pure) :
 *  - répare un éventuel mojibake (voir ci-dessus) ;
 *  - retire caractères de contrôle, NUL, BOM et invisibles de largeur nulle ;
 *  - normalise en NFC pour qu'un "é" décomposé (e + accent combinant)
 *    s'affiche et se compare comme un "é" simple ;
 *  - ramène toute suite d'espaces (tabulations, retours à la ligne, insécables)
 *    à un seul espace, et retire les espaces de début/fin.
 *
 * Ne découpe et ne réécrit JAMAIS un nom : elle ne connaît ni séparateur
 * d'artistes ni casse. "Tyler, The Creator", "Simon & Garfunkel", "AC/DC",
 * "Earth, Wind & Fire", "Mötley Crüe" et "!!!" ressortent tels quels ; la
 * liste multi-artistes est l'affaire de la source (voir spotify-track.ts),
 * la normalisation de recherche celle de electron/services/artwork-lookup.ts.
 */
export function cleanMetadataText(value: string | null | undefined): string {
  if (!value) return "";
  const repaired = repairMojibake(String(value));
  return repaired
    .replace(CONTROL_CHARS, "")
    .replace(ALWAYS_INVISIBLE, "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .replace(EDGE_NOISE, "");
}
