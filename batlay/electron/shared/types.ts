export interface Track {
  id: string;
  title: string;
  artist: string;
  artists?: string[];
  album?: string;
  source?: string;
  artwork?: string;
  duration: number;
  progress: number;
  isPlaying: boolean;
  playbackStatus?: "playing" | "paused" | "stopped" | "unknown";
}

export interface PlaybackState {
  track: Track | null;
  isPlaying: boolean;
  updatedAt: number;
}

export type MusicProviderId = "spotify" | "demo" | "system-media";
