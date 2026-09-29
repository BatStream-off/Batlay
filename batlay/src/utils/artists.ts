import type { Track } from "@/types/track";

export const DEFAULT_ARTIST_SEPARATOR = ", ";

/**
 * Nettoie une liste de noms d'artistes issue d'une source externe :
 * ignore les valeurs non textuelles ou vides, retire les espaces
 * superflus et supprime les doublons EXACTS (insensible à la casse) en
 * conservant l'ordre d'origine — l'ordre est celui des crédits, le
 * premier est l'artiste principal.
 *
 * Ne découpe jamais un nom : "Earth, Wind & Fire" reste un seul artiste.
 */
export function normalizeArtistNames(names: unknown): string[] {
  if (!Array.isArray(names)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    if (typeof raw !== "string") continue;
    const name = raw.replace(/\s+/g, " ").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

export function joinArtists(names: string[], separator: string = DEFAULT_ARTIST_SEPARATOR): string {
  return names.join(separator);
}

/**
 * Texte à afficher pour l'artiste d'un morceau. Utilise la liste
 * structurée quand elle existe (ce qui permet de choisir le séparateur
 * dans l'éditeur d'overlay) et retombe sur la chaîne `artist` sinon.
 * Ne retient JAMAIS seulement le premier artiste.
 */
export function formatArtists(
  track: Pick<Track, "artist" | "artists">,
  separator: string = DEFAULT_ARTIST_SEPARATOR
): string {
  if (track.artists && track.artists.length > 0) return joinArtists(track.artists, separator);
  return track.artist;
}
