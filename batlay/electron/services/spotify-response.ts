/**
 * Normalisation de la réponse GET /me/player/currently-playing.
 * Fichier volontairement SANS import Electron : il est testé directement
 * par Vitest (tests/spotify-response.test.ts).
 */

/**
 * Objet `item` tel que l'API le renvoie. On le transmet tel quel au
 * renderer (IPC) : TOUS les artistes de `artists` restent donc intacts
 * jusqu'au provider, qui en fait la chaîne d'affichage.
 * Champs optionnels : morceau, fichier local et épisode n'ont pas la
 * même forme.
 */
export interface SpotifyItem {
  id?: string | null;
  uri?: string | null;
  type?: string;
  is_local?: boolean;
  name?: string | null;
  duration_ms?: number | null;
  artists?: ({ name?: string | null } | null)[] | null;
  album?: { name?: string | null; images?: ({ url?: string | null } | null)[] | null } | null;
  show?: { name?: string | null; publisher?: string | null } | null;
  images?: ({ url?: string | null } | null)[] | null;
}

export interface SpotifyCurrentlyPlaying {
  isPlaying: boolean;
  progressMs: number;
  /**
   * Instant (Date.now()) où `progressMs` était exact : le MILIEU de
   * l'aller-retour HTTP. Spotify calcule la progression au moment où il
   * traite la requête — à peu près à mi-chemin entre l'envoi et la réponse.
   * Horodater à l'arrivée de la réponse (comme avant) faisait accuser à
   * l'affichage un retard égal à la latence réseau, corrigé par un saut
   * au poll suivant : c'était l'une des sources de saccades.
   */
  sampledAt: number;
  item: SpotifyItem | null;
}

/** Forme brute renvoyée par l'API Spotify (snake_case). */
export interface SpotifyCurrentlyPlayingRaw {
  is_playing?: boolean;
  progress_ms?: number | null;
  item?: SpotifyItem | null;
}

export function normalizeCurrentlyPlaying(
  raw: SpotifyCurrentlyPlayingRaw,
  requestedAt: number,
  receivedAt: number
): SpotifyCurrentlyPlaying {
  const safeReceived = Math.max(receivedAt, requestedAt);
  return {
    isPlaying: Boolean(raw.is_playing),
    progressMs: raw.progress_ms ?? 0,
    sampledAt: Math.round(requestedAt + (safeReceived - requestedAt) / 2),
    item: raw.item ?? null,
  };
}
