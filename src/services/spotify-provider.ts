import type { MusicProvider } from "./music-provider";
import type { Track, PlaybackState } from "@/types/track";
import { spotifyItemToTrack } from "./spotify-track";
import { computeNextPollDelay, POLL_TUNING } from "@/utils/poll-schedule";

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
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(state: PlaybackState) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private lastTrackId: string | null = null;
  private lastIsPlaying: boolean | null = null;
  /** Dernier état émis : sert à décider de la cadence du prochain relevé. */
  private lastState: PlaybackState | null = null;
  private fastUntil = 0;
  private consecutiveErrors = 0;
  /** Invalide les relevés en vol après un disconnect() : ils ne doivent plus rien émettre. */
  private generation = 0;

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
    this.generation++;
    this.stopPolling();
    this.lastState = null;
    this.lastTrackId = null;
    this.lastIsPlaying = null;
    this.consecutiveErrors = 0;
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
    return (await this.getPlaybackState()).track;
  }

  async getPlaybackState(): Promise<PlaybackState> {
    if (!this.connected) return { track: null, isPlaying: false, updatedAt: Date.now() };
    const data = await window.batlay.spotify.getCurrentlyPlaying();
    if (!data?.item) return { track: null, isPlaying: false, updatedAt: data?.sampledAt ?? Date.now() };

    // TOUS les artistes sont conservés : voir spotifyItemToTrack.
    const track = spotifyItemToTrack(data.item, { progressMs: data.progressMs, isPlaying: data.isPlaying });
    return {
      track,
      isPlaying: track.isPlaying,
      // Instant de la MESURE (milieu de l'aller-retour HTTP, calculé dans le
      // process principal), pas celui où la réponse a fini d'être traitée :
      // c'est ce qui permet à l'horloge de progression de compenser la
      // latence au lieu de la subir.
      updatedAt: data.sampledAt ?? Date.now(),
    };
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
    // Premier relevé immédiat : sinon rien n'est détecté juste après la connexion.
    void this.pollOnce().finally(() => this.scheduleNextPoll());
  }

  /**
   * setTimeout ré-armé plutôt que setInterval : la cadence change d'un
   * relevé à l'autre, et on n'empile jamais deux requêtes si l'API met plus
   * longtemps que prévu à répondre.
   */
  private scheduleNextPoll(): void {
    if (!this.connected) return;
    const delay = computeNextPollDelay({
      nowEpochMs: Date.now(),
      state: this.lastState,
      fastUntilEpochMs: this.fastUntil,
      consecutiveErrors: this.consecutiveErrors,
    });
    this.pollTimer = setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNextPoll());
    }, delay);
  }

  private async pollOnce(): Promise<void> {
    const generation = this.generation;
    try {
      const state = await this.getPlaybackState();
      if (generation !== this.generation) return; // déconnecté pendant la requête

      this.consecutiveErrors = 0;
      const currentTrackId = state.track?.id ?? null;
      const currentIsPlaying = state.track?.isPlaying ?? false;

      if (currentTrackId !== this.lastTrackId) {
        console.log(`[Batlay] Changement de morceau : ${this.lastTrackId ?? "—"} → ${currentTrackId ?? "—"}`);
        this.lastTrackId = currentTrackId;
        this.fastUntil = Date.now() + POLL_TUNING.burstMs;
      } else if (this.lastIsPlaying !== null && currentIsPlaying !== this.lastIsPlaying) {
        this.fastUntil = Date.now() + POLL_TUNING.burstMs; // play/pause : un autre geste suit souvent
      }
      this.lastIsPlaying = currentIsPlaying;
      this.lastState = state;
      this.emit(state);
    } catch (err) {
      if (generation !== this.generation) return;
      // Token expiré, compte non ajouté à l'allowlist du dashboard Spotify,
      // limite de débit (429), API indisponible... — remonté au store pour
      // affichage plutôt que silencieusement avalé. Le recul exponentiel de
      // computeNextPollDelay évite de marteler l'API pendant l'incident.
      this.consecutiveErrors++;
      const message = (err as Error).message || "Erreur de communication avec Spotify.";
      console.error("[Batlay] Erreur de polling Spotify:", err);
      this.errorListeners.forEach((l) => l(message));
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private emit(state: PlaybackState): void {
    this.listeners.forEach((l) => l(state));
  }
}
