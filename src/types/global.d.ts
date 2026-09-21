import type { PlaybackState } from "./track";
import type { SpotifyItemLike } from "@/services/spotify-track";
import type { Settings } from "@/stores/useSettingsStore";
import type { ResolvedTheme, ThemePreference } from "../../electron/shared/theme";

export interface BatlayBridge {
  config: {
    get(): Promise<{ settings: Settings; [key: string]: unknown }>;
    setSettings(settings: Partial<Settings>): Promise<Settings>;
    getOverlays(): Promise<unknown[]>;
    saveOverlays(overlays: unknown[]): Promise<boolean>;
    getActiveOverlayId(): Promise<string | null>;
    setActiveOverlayId(id: string | null): Promise<boolean>;
  };
  overlay: {
    getUrl(overlayId: string): Promise<string>;
    isRunning(): Promise<boolean>;
    broadcastState(state: PlaybackState): void;
    onServerError(callback: (payload: { message: string }) => void): () => void;
  };
  spotify: {
    isConfigured(): Promise<boolean>;
    setClientId(clientId: string): Promise<boolean>;
    connect(): Promise<boolean>;
    disconnect(): Promise<boolean>;
    isSessionRestorable(): Promise<boolean>;
    restoreSession(): Promise<boolean>;
    getCurrentlyPlaying(): Promise<{
      isPlaying: boolean;
      progressMs: number;
      /**
       * Instant (Date.now(), process principal) où Spotify a mesuré
       * `progressMs` : milieu de l'aller-retour réseau. Optionnel pour
       * rester compatible avec d'anciens mocks de test.
       */
      sampledAt?: number;
      item: SpotifyItemLike | null;
    } | null>;
  };
  theme: {
    /** Thème déjà résolu par le process principal (lecture synchrone, avant le premier rendu). */
    getInitial(): { preference: ThemePreference; resolved: ResolvedTheme };
    /** Notifié quand le réglage change ou que Windows bascule (réglage « system »). */
    onChange(callback: (payload: { preference: ThemePreference; resolved: ResolvedTheme }) => void): () => void;
  };
  artwork: {
    /** (artiste, titre) -> URL de pochette. `url: null` si introuvable — jamais d'exception. */
    lookup(
      artist: string,
      title: string
    ): Promise<{
      url: string | null;
      source: "itunes" | "deezer" | "listenbrainz" | "coverartarchive" | "audius" | "none";
      cached: boolean;
    }>;
  };
  systemMedia: {
    isSupported(): Promise<boolean>;
    listSessions(): Promise<{ sourceAppId: string | null; title: string; artist: string }[]>;
    getCurrent(options?: { preferredAppId?: string; includeArtwork?: boolean }): Promise<{
      title: string;
      artist: string;
      /** Diagnostic seulement (journal debug) : jamais utilisé pour l'affichage. Optionnel pour les anciens mocks. */
      albumArtist?: string | null;
      /** Titre de la fenêtre Spotify Desktop (voir src/utils/spotify-metadata.ts). Optionnel pour les anciens mocks. */
      windowTitle?: string | null;
      album: string | null;
      sourceAppId: string | null;
      isPlaying: boolean;
      playbackStatus?: "playing" | "paused" | "stopped" | "unknown";
      /** Position déjà extrapolée à l'instant `sampledAtMs` (voir electron/services/system-media.ts). */
      positionMs: number;
      /** Instant (Date.now()) où Windows a été interrogé. Optionnel pour les anciens mocks. */
      sampledAtMs?: number;
      durationMs: number;
      artwork: string | null;
      hasThumbnail: boolean;
      artworkError: string | null;
    } | null>;
  };
}

declare global {
  interface Window {
    batlay: BatlayBridge;
  }
}
