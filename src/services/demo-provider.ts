import type { MusicProvider } from "./music-provider";
import type { Track, PlaybackState } from "@/types/track";

/**
 * Le Mode Demo utilise exactement le même contrat (MusicProvider) que
 * Spotify. Il permet de tester tout le pipeline — état, WebSocket,
 * overlay, animations — sans dépendre d'un compte Spotify ni d'un
 * accès réseau. C'est un vrai provider, pas une simulation d'UI.
 */
const DEMO_TRACKS: Omit<Track, "progress" | "isPlaying">[] = [
  { id: "demo-1", title: "Blinding Lights", artist: "The Weeknd", album: "After Hours", duration: 200_000 },
  { id: "demo-2", title: "Starboy", artist: "The Weeknd", album: "Starboy", duration: 230_000 },
  { id: "demo-3", title: "One More Time", artist: "Daft Punk", album: "Discovery", duration: 320_000 },
  { id: "demo-4", title: "Instant Crush", artist: "Daft Punk", album: "Random Access Memories", duration: 337_000 },
];

const TICK_MS = 1000;

export class DemoProvider implements MusicProvider {
  readonly id = "demo";

  private connected = false;
  private trackIndex = 0;
  private progress = 0;
  private playing = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(state: PlaybackState) => void>();

  async connect(): Promise<void> {
    this.connected = true;
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
    this.playing = !this.playing;
    this.emit();
  }

  next(): void {
    this.trackIndex = (this.trackIndex + 1) % DEMO_TRACKS.length;
    this.progress = 0;
    this.emit();
  }

  previous(): void {
    this.trackIndex = (this.trackIndex - 1 + DEMO_TRACKS.length) % DEMO_TRACKS.length;
    this.progress = 0;
    this.emit();
  }

  // --- Interne ---

  private buildTrack(): Track {
    const base = DEMO_TRACKS[this.trackIndex];
    return { ...base, progress: this.progress, isPlaying: this.playing };
  }

  private startTicking(): void {
    this.stopTicking();
    this.timer = setInterval(() => {
      if (!this.playing) return;
      const current = DEMO_TRACKS[this.trackIndex];
      this.progress += TICK_MS;
      if (this.progress >= current.duration) {
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
