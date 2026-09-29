/**
 * Corrections propres à Spotify Desktop dans la Lecture système (SMTC).
 *
 * Pourquoi SMTC seul ne suffit pas avec Spotify
 * ---------------------------------------------
 * Spotify met à jour le titre de SA FENÊTRE immédiatement (« Artiste - Titre »,
 * ou « Advertisement » pendant une pub), alors que ses métadonnées SMTC
 * peuvent rester sur le morceau précédent pendant une pub ou un changement de
 * piste (comportement constaté par d'autres projets, p. ex. libspotifyctl).
 * Conséquences sans recoupement : l'overlay affiche le morceau d'AVANT pendant
 * une pub, et la recherche de pochette part avec un titre « Advertisement ».
 *
 * Principe : SMTC reste la source de vérité. Le titre de fenêtre ne sert qu'à
 *   1. reconnaître une publicité ;
 *   2. compléter la liste d'artistes, et SEULEMENT quand il est cohérent avec
 *      SMTC (même titre, même artiste en tête). Au moindre désaccord — cas
 *      normal juste après un changement de piste, où l'un a une longueur
 *      d'avance sur l'autre — on ne touche à rien.
 * Fonction pure : aucune dépendance à Electron ni à Windows.
 */

import { cleanMetadataText } from "./text-encoding";

/** Libellé affiché à l'antenne pendant une publicité Spotify. */
export const SPOTIFY_AD_TITLE = "Publicité";
export const SPOTIFY_AD_ARTIST = "Spotify";
/** Identifiant de piste constant : plusieurs pubs d'affilée ne sont pas « un changement de morceau » chacune. */
export const SPOTIFY_AD_TRACK_ID = "spotify:advertisement";

/** Titre de fenêtre / de piste utilisé par Spotify pour une pub, selon la langue de l'interface. */
const AD_WORDS = new Set([
  "advertisement",
  "publicité",
  "publicite",
  "werbung",
  "publicidad",
  "pubblicità",
  "publicidade",
  "anúncio",
  "reclame",
  "reklam",
]);

export function isSpotifySource(sourceAppId: string | null | undefined): boolean {
  return /spotify/i.test(sourceAppId ?? "");
}

function isAdWord(text: string): boolean {
  return AD_WORDS.has(text.trim().toLowerCase());
}

export interface SpotifyMetadataInput {
  sourceAppId: string | null | undefined;
  /** Titre et artiste SMTC, déjà nettoyés (cleanMetadataText). */
  title: string;
  artist: string;
  /** Titre de la fenêtre Spotify tel que lu par Windows, ou vide/null s'il n'est pas disponible. */
  windowTitle: string | null | undefined;
}

export interface SpotifyMetadataResult {
  title: string;
  artist: string;
  isAd: boolean;
}

/** Séparateurs qui, juste après l'artiste SMTC, indiquent d'autres artistes dans le titre de fenêtre. */
const MORE_ARTISTS = /^\s*(?:[,;&+/]|\s(?:x|feat\.?|ft\.?|and|et|with|avec)\s)/i;

/**
 * Extrait l'artiste du titre de fenêtre « Artiste - Titre », en s'ancrant sur
 * le TITRE SMTC déjà connu plutôt qu'en coupant au premier « - » : les titres
 * Spotify en contiennent souvent (« Time - 2011 Remaster »).
 */
function artistFromWindowTitle(windowTitle: string, title: string): string | null {
  if (!title) return null;
  const suffix = ` - ${title}`;
  if (!windowTitle.endsWith(suffix)) return null;
  const artist = windowTitle.slice(0, windowTitle.length - suffix.length).trim();
  return artist || null;
}

export function resolveSpotifyMetadata(input: SpotifyMetadataInput): SpotifyMetadataResult {
  const unchanged: SpotifyMetadataResult = { title: input.title, artist: input.artist, isAd: false };
  if (!isSpotifySource(input.sourceAppId)) return unchanged;

  const windowTitle = cleanMetadataText(input.windowTitle);

  // 1. Publicité. Le titre de fenêtre fait foi ; côté SMTC on n'accepte le mot
  //    « Advertisement » que si l'artiste est absent ou « Spotify », pour ne
  //    jamais confondre un vrai morceau intitulé ainsi avec une pub.
  const smtcSaysAd =
    isAdWord(input.title) && (!input.artist || input.artist.toLowerCase() === SPOTIFY_AD_ARTIST.toLowerCase());
  if (isAdWord(windowTitle) || smtcSaysAd) {
    return { title: SPOTIFY_AD_TITLE, artist: SPOTIFY_AD_ARTIST, isAd: true };
  }

  // 2. Artistes complets.
  if (!windowTitle) return unchanged;
  const fromWindow = artistFromWindowTitle(windowTitle, input.title);
  if (!fromWindow || fromWindow === input.artist) return unchanged;

  // SMTC n'a aucun artiste exploitable : la fenêtre en a un pour ce titre exact.
  if (!input.artist) return { ...unchanged, artist: fromWindow };

  // SMTC n'en donne qu'une partie : on n'accepte la version longue que si elle
  // COMMENCE par l'artiste SMTC, suivi d'un séparateur d'artistes.
  const head = fromWindow.slice(0, input.artist.length);
  const rest = fromWindow.slice(input.artist.length);
  if (fromWindow.length > input.artist.length && head.toLowerCase() === input.artist.toLowerCase() && MORE_ARTISTS.test(rest)) {
    return { ...unchanged, artist: fromWindow };
  }
  return unchanged;
}
