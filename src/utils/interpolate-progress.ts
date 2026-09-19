import type { PlaybackState, Track } from "@/types/track";

/**
 * Les providers (Spotify, Lecture système) ne poussent un nouvel état
 * que toutes les ~2s (polling). Afficher `track.progress` tel quel fait
 * "sauter" la barre de progression et le temps écoulé par paliers de 2s
 * au lieu d'avancer en continu comme on l'attend d'un lecteur.
 *
 * Cette fonction projette la progression réelle au moment `nowMs` en
 * ajoutant le temps écoulé depuis `state.updatedAt` (uniquement si la
 * lecture est en cours), sans jamais dépasser la durée du morceau.
 * Utilisée par le Dashboard et par overlay/OverlayApp.tsx.
 */
export function interpolateTrack(state: PlaybackState, nowMs: number): Track | null {
  const track = state.track;
  if (!track) return null;
  if (!track.isPlaying) return track;

  const elapsed = Math.max(0, nowMs - state.updatedAt);
  const projected = track.progress + elapsed;
  const clamped = track.duration > 0 ? Math.min(projected, track.duration) : projected;

  if (clamped === track.progress) return track;
  return { ...track, progress: clamped };
}
