import type { Track, PlaybackState } from "@/types/track";

/**
 * Interface commune à toute source musicale (Spotify, Apple Music,
 * YouTube Music, Mode Demo...). L'Overlay Engine et l'état de
 * l'application ne parlent jamais directement à Spotify : ils
 * passent toujours par cette abstraction.
 */
export interface MusicProvider {
  readonly id: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCurrentTrack(): Promise<Track | null>;
  getPlaybackState(): Promise<PlaybackState>;
  /**
   * S'abonner aux changements de morceau/progression. Retourne une
   * fonction de désinscription. Chaque provider est libre d'utiliser
   * du polling, un webhook, ou un SDK temps réel en interne — tant que
   * ce contrat est respecté.
   */
  onStateChange(listener: (state: PlaybackState) => void): () => void;
  isConnected(): boolean;
}
