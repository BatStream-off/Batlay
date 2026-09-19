import type { MusicProvider } from "./music-provider";
import type { Track, PlaybackState } from "@/types/track";

const POLL_INTERVAL_MS = 2000;

/**
 * Le renderer ne détient jamais de token Spotify : toute l'authentification
 * et les appels à l'API Spotify passent par window.batlay.spotify (IPC vers
 * le process principal — voir electron/services/spotify-auth.ts).
 *
 * Nécessite qu'un Client ID Spotify ait été configuré par l'utilisateur
 * (Settings > Connections). Sans cela, connect() échoue avec un message
 * explicite plutôt que de simuler une connexion.
 */
export class SpotifyProvider implements MusicProvider {
  readonly id = "spotify";

  private connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(state: PlaybackState) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private lastTrackId: string | null = null;

  async connect(): Promise<void> {
    const configured = await window.batlay.spotify.isConfigured();
    if (!configured) {
      throw new Error(
        "Aucun Client ID Spotify configuré. Ajoutez-le dans Settings > Connections avant de vous connecter."
      );
    }
    await window.batlay.spotify.connect();
    this.connected = true;
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    await window.batlay.spotify.disconnect();
    this.connected = false;
    this.stopPolling();
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Tente de restaurer une session existante sans ouvrir de navigateur. */
  async tryRestoreSession(): Promise<boolean> {
    const restorable = await window.batlay.spotify.isSessionRestorable();
    if (!restorable) return false;
    const ok = await window.batlay.spotify.restoreSession();
    if (ok) {
      this.connected = true;
      this.startPolling();
    }
    return ok;
  }

  async getCurrentTrack(): Promise<Track | null> {
    if (!this.connected) return null;
    const data = await window.batlay.spotify.getCurrentlyPlaying();
    if (!data?.item) return null;
    return {
      id: data.item.id,
      title: data.item.name,
      artist: data.item.artists.map((a) => a.name).join(", "),
      album: data.item.album.name,
      artwork: data.item.album.images[0]?.url,
      duration: data.item.duration_ms,
      progress: data.progressMs,
      isPlaying: data.isPlaying,
    };
  }

  async getPlaybackState(): Promise<PlaybackState> {
    const track = await this.getCurrentTrack();
    return { track, isPlaying: track?.isPlaying ?? false, updatedAt: Date.now() };
  }

  onStateChange(listener: (state: PlaybackState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Permet au store d'être notifié quand le polling échoue (token expiré,
   * compte non autorisé sur le dashboard Spotify, réseau, etc.) au lieu de
   * laisser l'erreur disparaître silencieusement dans la console. */
  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  private startPolling(): void {
    this.stopPolling();
    // Premier appel immédiat : sans ça, setInterval attend déjà
    // POLL_INTERVAL_MS avant la toute première mise à jour, ce qui donne
    // l'impression que rien n'est détecté juste après la connexion.
    void this.pollOnce();
    this.pollTimer = setInterval(() => void this.pollOnce(), POLL_INTERVAL_MS);
  }

  private async pollOnce(): Promise<void> {
    try {
      const state = await this.getPlaybackState();
      const currentTrackId = state.track?.id ?? null;
      if (currentTrackId !== this.lastTrackId) {
        console.log(`[Batlay] Changement de morceau : ${this.lastTrackId ?? "—"} → ${currentTrackId ?? "—"}`);
        this.lastTrackId = currentTrackId;
      }
      this.emit(state);
    } catch (err) {
      // Token expiré, compte non ajouté à l'allowlist du dashboard Spotify,
      // API indisponible, etc. — remonté au store pour affichage à
      // l'utilisateur plutôt que silencieusement avalé.
      const message = (err as Error).message || "Erreur de communication avec Spotify.";
      console.error("[Batlay] Erreur de polling Spotify:", err);
      this.errorListeners.forEach((l) => l(message));
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private emit(state: PlaybackState): void {
    this.listeners.forEach((l) => l(state));
  }
}
