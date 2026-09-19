import type { PlaybackState } from "./track";
import type { Settings } from "@/stores/useSettingsStore";

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
      item: {
        id: string;
        name: string;
        duration_ms: number;
        artists: { name: string }[];
        album: { name: string; images: { url: string }[] };
      } | null;
    } | null>;
  };
  artwork: {
    /** (artiste, titre) -> URL de pochette. `url: null` si introuvable — jamais d'exception. */
    lookup(
      artist: string,
      title: string
    ): Promise<{
      url: string | null;
      source: "itunes" | "deezer" | "coverartarchive" | "none";
      cached: boolean;
    }>;
  };
  systemMedia: {
    isSupported(): Promise<boolean>;
    listSessions(): Promise<{ sourceAppId: string | null; title: string; artist: string }[]>;
    getCurrent(options?: { preferredAppId?: string; includeArtwork?: boolean }): Promise<{
      title: string;
      artist: string;
      album: string | null;
      sourceAppId: string | null;
      isPlaying: boolean;
      playbackStatus?: "playing" | "paused" | "stopped" | "unknown";
      positionMs: number;
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
