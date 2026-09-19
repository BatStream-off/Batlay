import { create } from "zustand";
import type { PlaybackState, MusicProviderId } from "@/types/track";
import type { MusicProvider } from "@/services/music-provider";
import { DemoProvider } from "@/services/demo-provider";
import { SpotifyProvider } from "@/services/spotify-provider";
import { SystemMediaProvider } from "@/services/system-media-provider";
import { useToastStore } from "@/stores/useToastStore";

interface MusicStoreState {
  activeProviderId: MusicProviderId | null;
  playbackState: PlaybackState;
  isConnecting: boolean;
  error: string | null;

  demoProvider: DemoProvider;
  spotifyProvider: SpotifyProvider;
  systemMediaProvider: SystemMediaProvider;

  connectDemo: () => Promise<void>;
  connectSpotify: () => Promise<void>;
  connectSystemMedia: () => Promise<void>;
  disconnect: () => Promise<void>;
  tryRestoreSpotifySession: () => Promise<void>;
}

let unsubscribeCurrent: (() => void) | null = null;
let unsubscribeSpotifyError: (() => void) | null = null;
let unsubscribeSystemMediaError: (() => void) | null = null;

/**
 * Diffuse chaque nouvel état vers le Batlay Overlay Server (process
 * principal) via IPC, qui le relaie ensuite en WebSocket à tous les
 * overlays connectés. C'est le seul point de passage entre
 * "Application State" et "WebSocket" du flux décrit dans le brief.
 */
function broadcast(state: PlaybackState): void {
  window.batlay?.overlay.broadcastState(state);
}

function attachProvider(
  provider: MusicProvider,
  set: (partial: Partial<MusicStoreState>) => void
): void {
  unsubscribeCurrent?.();
  unsubscribeCurrent = provider.onStateChange((state) => {
    set({ playbackState: state });
    broadcast(state);
  });
}

/**
 * Relaie les erreurs de polling Spotify (token expiré, compte non ajouté
 * à l'allowlist du dashboard Spotify, réseau...) vers l'UI. Sans ça, un
 * échec silencieux en arrière-plan laisse le Dashboard bloqué sur
 * "Nothing is playing" sans aucune explication.
 */
function attachSpotifyErrorRelay(
  spotifyProvider: SpotifyProvider,
  set: (partial: Partial<MusicStoreState>) => void
): void {
  unsubscribeSpotifyError?.();
  unsubscribeSpotifyError = spotifyProvider.onError((message) => {
    set({ error: message });
    useToastStore.getState().push(message, "error");
  });
}

/**
 * Même logique que attachSpotifyErrorRelay, pour le provider de lecture
 * système (échecs PowerShell/plateforme non supportée, etc.).
 */
function attachSystemMediaErrorRelay(
  systemMediaProvider: SystemMediaProvider,
  set: (partial: Partial<MusicStoreState>) => void
): void {
  unsubscribeSystemMediaError?.();
  unsubscribeSystemMediaError = systemMediaProvider.onError((message) => {
    set({ error: message });
    useToastStore.getState().push(message, "error");
  });
}

export const useMusicStore = create<MusicStoreState>((set, get) => ({
  activeProviderId: null,
  playbackState: { track: null, isPlaying: false, updatedAt: Date.now() },
  isConnecting: false,
  error: null,

  demoProvider: new DemoProvider(),
  spotifyProvider: new SpotifyProvider(),
  systemMediaProvider: new SystemMediaProvider(),

  connectDemo: async () => {
    set({ isConnecting: true, error: null });
    try {
      const { demoProvider } = get();
      await get().disconnect();
      attachProvider(demoProvider, set);
      await demoProvider.connect();
      set({ activeProviderId: "demo", isConnecting: false });
    } catch (err) {
      set({ isConnecting: false, error: (err as Error).message });
    }
  },

  connectSpotify: async () => {
    set({ isConnecting: true, error: null });
    try {
      const { spotifyProvider } = get();
      await get().disconnect();
      attachProvider(spotifyProvider, set);
      attachSpotifyErrorRelay(spotifyProvider, set);
      await spotifyProvider.connect();
      set({ activeProviderId: "spotify", isConnecting: false });
    } catch (err) {
      set({ isConnecting: false, error: (err as Error).message });
    }
  },

  connectSystemMedia: async () => {
    set({ isConnecting: true, error: null });
    try {
      const { systemMediaProvider } = get();
      await get().disconnect();
      attachProvider(systemMediaProvider, set);
      attachSystemMediaErrorRelay(systemMediaProvider, set);
      await systemMediaProvider.connect();
      set({ activeProviderId: "system-media", isConnecting: false });
    } catch (err) {
      set({ isConnecting: false, error: (err as Error).message });
    }
  },

  tryRestoreSpotifySession: async () => {
    const { spotifyProvider } = get();
    const restored = await spotifyProvider.tryRestoreSession();
    if (restored) {
      attachProvider(spotifyProvider, set);
      attachSpotifyErrorRelay(spotifyProvider, set);
      set({ activeProviderId: "spotify" });
    }
  },

  disconnect: async () => {
    const { activeProviderId, demoProvider, spotifyProvider, systemMediaProvider } = get();
    unsubscribeCurrent?.();
    unsubscribeCurrent = null;
    unsubscribeSpotifyError?.();
    unsubscribeSpotifyError = null;
    unsubscribeSystemMediaError?.();
    unsubscribeSystemMediaError = null;
    if (activeProviderId === "demo") await demoProvider.disconnect();
    if (activeProviderId === "spotify") await spotifyProvider.disconnect();
    if (activeProviderId === "system-media") await systemMediaProvider.disconnect();
    set({
      activeProviderId: null,
      playbackState: { track: null, isPlaying: false, updatedAt: Date.now() },
    });
  },
}));
