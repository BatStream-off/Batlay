import type { Track } from "@/types/track";
import { normalizeArtistNames, joinArtists } from "@/utils/artists";
import { cleanMetadataText } from "@/utils/text-encoding";

/**
 * Sous-ensemble de l'objet `item` renvoyé par GET /me/player/currently-playing
 * dont Batlay a besoin. Tous les champs sont optionnels À DESSEIN : Spotify
 * renvoie des formes différentes selon le contenu (morceau, fichier local,
 * épisode de podcast) et le parsing ne doit jamais lever d'exception sur
 * l'une d'elles — un TypeError ici tuait le polling en silence.
 */
export interface SpotifyItemLike {
  id?: string | null;
  uri?: string | null;
  type?: string;
  is_local?: boolean;
  name?: string | null;
  duration_ms?: number | null;
  artists?: ({ name?: string | null } | null)[] | null;
  album?: { name?: string | null; images?: ({ url?: string | null } | null)[] | null } | null;
  /** Épisodes de podcast : pas d'`artists`, l'auteur est l'éditeur de l'émission. */
  show?: { name?: string | null; publisher?: string | null } | null;
  images?: ({ url?: string | null } | null)[] | null;
}

export interface SpotifyPlaybackContext {
  progressMs: number;
  isPlaying: boolean;
}

/**
 * Transforme la réponse Spotify en `Track` en conservant TOUS les artistes,
 * dans l'ordre des crédits : "Artiste 1, Artiste 2, Artiste 3".
 *
 * Il n'y a volontairement aucun `artists[0]` ici (ni ailleurs dans le
 * projet — voir tests/spotify-track.test.ts).
 */
export function spotifyItemToTrack(item: SpotifyItemLike, ctx: SpotifyPlaybackContext): Track {
  const names = (item.artists ?? []).map((a) => a?.name ?? "");
  let artists = normalizeArtistNames(names.map((n) => cleanMetadataText(n)));
  if (artists.length === 0 && item.show?.publisher) {
    artists = normalizeArtistNames([cleanMetadataText(item.show.publisher)]);
  }

  const title = cleanMetadataText(item.name);
  const artist = joinArtists(artists);

  // Les fichiers locaux n'ont pas d'`id` (null) : sans identifiant de
  // repli, deux morceaux locaux successifs auraient le même id `null` et le
  // changement de morceau ne serait jamais détecté.
  const id = item.id || item.uri || `local:${title}::${artist}`;

  const images = item.album?.images ?? item.images ?? [];
  const artwork = images.find((img) => img?.url)?.url ?? undefined;

  return {
    id,
    title,
    artist,
    artists,
    album: cleanMetadataText(item.album?.name ?? item.show?.name) || undefined,
    source: "Spotify",
    artwork,
    duration: item.duration_ms ?? 0,
    progress: ctx.progressMs,
    isPlaying: ctx.isPlaying,
    playbackStatus: ctx.isPlaying ? "playing" : "paused",
  };
}
