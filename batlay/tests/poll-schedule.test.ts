import { describe, it, expect } from "vitest";
import { computeNextPollDelay, POLL_TUNING } from "@/utils/poll-schedule";
import type { PlaybackState } from "@/types/track";

const playing = (progress: number, duration: number, updatedAt: number): PlaybackState => ({
  track: { id: "t", title: "T", artist: "A", duration, progress, isPlaying: true },
  isPlaying: true,
  updatedAt,
});

describe("computeNextPollDelay", () => {
  const base = { nowEpochMs: 10_000, fastUntilEpochMs: 0, consecutiveErrors: 0 };

  it("cadence tranquille en milieu de morceau", () => {
    expect(computeNextPollDelay({ ...base, state: playing(60_000, 200_000, 10_000) })).toBe(POLL_TUNING.steadyMs);
  });
  it("rien en lecture / pause : cadence lente", () => {
    expect(computeNextPollDelay({ ...base, state: null })).toBe(POLL_TUNING.idleMs);
  });
  it("juste après un changement : cadence rapide", () => {
    expect(computeNextPollDelay({ ...base, fastUntilEpochMs: 15_000, state: playing(60_000, 200_000, 10_000) })).toBe(POLL_TUNING.fastMs);
  });
  it("à l'approche de la fin : le relevé est programmé pile après la fin PRÉVUE", () => {
    // fin dans 1000 ms -> relevé dans 1000 + 250 ms plafonné à la cadence rapide
    const d = computeNextPollDelay({ ...base, state: playing(199_000, 200_000, 10_000) });
    expect(d).toBeLessThanOrEqual(POLL_TUNING.fastMs);
    // fin dans 100 ms -> relevé dans ~350 ms, pas 2 s
    const soon = computeNextPollDelay({ ...base, state: playing(199_900, 200_000, 10_000) });
    expect(soon).toBe(350);
  });
  it("tient compte du temps écoulé depuis la mesure", () => {
    // mesure vieille de 1,9 s : la fin est en réalité imminente
    const d = computeNextPollDelay({ ...base, nowEpochMs: 11_900, state: playing(198_000, 200_000, 10_000) });
    expect(d).toBeLessThanOrEqual(POLL_TUNING.fastMs);
  });
  it("erreurs : recul exponentiel plafonné", () => {
    const delays = [1, 2, 3, 4, 10].map((n) => computeNextPollDelay({ ...base, state: null, consecutiveErrors: n }));
    expect(delays).toEqual([2000, 4000, 8000, 15000, 15000]);
  });
});
