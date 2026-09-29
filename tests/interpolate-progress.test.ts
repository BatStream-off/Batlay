import { describe, it, expect } from "vitest";
import { interpolateTrack } from "@/utils/interpolate-progress";
import type { PlaybackState } from "@/types/track";

const baseTrack = {
  id: "1",
  title: "T",
  artist: "A",
  duration: 100_000,
  progress: 10_000,
  isPlaying: true,
};

describe("interpolateTrack", () => {
  it("retourne null si aucun morceau", () => {
    const state: PlaybackState = { track: null, isPlaying: false, updatedAt: Date.now() };
    expect(interpolateTrack(state, Date.now())).toBeNull();
  });

  it("ne fait pas avancer la progression si en pause", () => {
    const updatedAt = Date.now() - 5000;
    const state: PlaybackState = { track: { ...baseTrack, isPlaying: false }, isPlaying: false, updatedAt };
    const track = interpolateTrack(state, Date.now());
    expect(track?.progress).toBe(10_000);
  });

  it("fait avancer la progression du temps écoulé depuis updatedAt si en lecture", () => {
    const updatedAt = Date.now() - 5000;
    const state: PlaybackState = { track: baseTrack, isPlaying: true, updatedAt };
    const track = interpolateTrack(state, updatedAt + 5000);
    expect(track?.progress).toBe(15_000);
  });

  it("ne dépasse jamais la durée du morceau", () => {
    const updatedAt = Date.now() - 5000;
    const state: PlaybackState = { track: baseTrack, isPlaying: true, updatedAt };
    const track = interpolateTrack(state, updatedAt + 10_000_000);
    expect(track?.progress).toBe(100_000);
  });

  it("n'applique pas de plafond si la durée est inconnue (0)", () => {
    const updatedAt = Date.now() - 5000;
    const state: PlaybackState = {
      track: { ...baseTrack, duration: 0 },
      isPlaying: true,
      updatedAt,
    };
    const track = interpolateTrack(state, updatedAt + 20_000);
    expect(track?.progress).toBe(30_000);
  });
});
