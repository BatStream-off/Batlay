import type { MusicProvider } from "./music-provider";
import type { Track, PlaybackState } from "@/types/track";

/**
 * Le Mode Demo utilise exactement le même contrat (MusicProvider) que
 * Spotify. Il permet de tester tout le pipeline — état, WebSocket,
 * overlay, animations — sans dépendre d'un compte Spotify ni d'un
 * accès réseau. C'est un vrai provider, pas une simulation d'UI.
 */
type DemoTrack = Omit<Track, "progress" | "isPlaying" | "artist" | "artists"> & { artists: string[] };

/**
 * Les morceaux 2 et 5 sont des collaborations (2 et 3 artistes), et le 5 et
 * le 6 contiennent des caractères non ASCII (Ø, è) : le Mode Demo permet de
 * vérifier de bout en bout, sans compte Spotify, que TOUS les artistes et
 * les accents traversent le pipeline Provider -> Store -> WebSocket -> Overlay.
 */
const DEMO_TRACKS: DemoTrack[] = [
  { id: "demo-1", title: "Blinding Lights", artists: ["The Weeknd"], album: "After Hours", duration: 200_000 },
  { id: "demo-2", title: "Starboy", artists: ["The Weeknd", "Daft Punk"], album: "Starboy", duration: 230_000 },
  { id: "demo-3", title: "One More Time", artists: ["Daft Punk"], album: "Discovery", duration: 320_000 },
  { id: "demo-4", title: "Instant Crush", artists: ["Daft Punk", "Julian Casablancas"], album: "Random Access Memories", duration: 337_000 },
  { id: "demo-5", title: "Lean On", artists: ["Major Lazer", "DJ Snake", "MØ"], album: "Peace Is the Mission", duration: 176_000 },
  { id: "demo-6", title: "Balance ton quoi", artists: ["Angèle"], album: "Brol", duration: 188_000 },
];

const TICK_MS = 1000;

export class DemoProvider implements MusicProvider {
  readonly id = "demo";

  private connected = false;
  private trackIndex = 0;
  /** Position au moment de `anchor` ; la position courante en est déduite (voir currentProgress). */
  private progress = 0;
  private anchor = 0;
  private playing = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(state: PlaybackState) => void>();

  async connect(): Promise<void> {
    this.connected = true;
    this.anchor = Date.now();
    this.startTicking();
    this.emit();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.stopTicking();
  }

  isConnected(): boolean {
    return this.connected;
  }

  async getCurrentTrack(): Promise<Track | null> {
    if (!this.connected) return null;
    return this.buildTrack();
  }

  async getPlaybackState(): Promise<PlaybackState> {
    return {
      track: await this.getCurrentTrack(),
      isPlaying: this.playing,
      updatedAt: Date.now(),
    };
  }

  onStateChange(listener: (state: PlaybackState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // --- Contrôles spécifiques au mode Demo (Previous / Play-Pause / Next) ---

  playPause(): void {
    // Fige (ou reprend) la position exacte à cet instant.
    this.progress = this.currentProgress();
    this.anchor = Date.now();
    this.playing = !this.playing;
    this.emit();
  }

  next(): void {
    this.trackIndex = (this.trackIndex + 1) % DEMO_TRACKS.length;
    this.progress = 0;
    this.anchor = Date.now();
    this.emit();
  }

  previous(): void {
    this.trackIndex = (this.trackIndex - 1 + DEMO_TRACKS.length) % DEMO_TRACKS.length;
    this.progress = 0;
    this.anchor = Date.now();
    this.emit();
  }

  // --- Interne ---

  /**
   * La position est calculée à partir de l'horloge (ancre + temps écoulé) et
   * non plus accumulée tick après tick : un tick en retard ne décale plus la
   * lecture, et la valeur émise est toujours exacte à l'instant `updatedAt`.
   */
  private currentProgress(): number {
    const duration = DEMO_TRACKS[this.trackIndex].duration;
    const elapsed = this.playing ? Math.max(0, Date.now() - this.anchor) : 0;
    return Math.min(duration, this.progress + elapsed);
  }

  private buildTrack(): Track {
    const base = DEMO_TRACKS[this.trackIndex];
    return {
      ...base,
      artists: [...base.artists],
      artist: base.artists.join(", "),
      source: "Demo",
      progress: this.currentProgress(),
      isPlaying: this.playing,
      playbackStatus: this.playing ? "playing" : "paused",
    };
  }

  private startTicking(): void {
    this.stopTicking();
    this.timer = setInterval(() => {
      if (!this.playing) return;
      if (this.currentProgress() >= DEMO_TRACKS[this.trackIndex].duration) {
        this.next();
        return;
      }
      this.emit();
    }, TICK_MS);
  }

  private stopTicking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    const state: PlaybackState = {
      track: this.buildTrack(),
      isPlaying: this.playing,
      updatedAt: Date.now(),
    };
    this.listeners.forEach((l) => l(state));
  }
}
