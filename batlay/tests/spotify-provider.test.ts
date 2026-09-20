import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SpotifyProvider } from "@/services/spotify-provider";

type Win = { batlay: { spotify: Record<string, ReturnType<typeof vi.fn>> } };

function mockWindow(getCurrentlyPlaying: ReturnType<typeof vi.fn>) {
  (globalThis as unknown as { window: Win }).window = {
    batlay: {
      spotify: {
        isConfigured: vi.fn().mockResolvedValue(true),
        connect: vi.fn().mockResolvedValue(true),
        disconnect: vi.fn().mockResolvedValue(true),
        getCurrentlyPlaying,
      },
    },
  };
}

const playing = (progressMs: number, sampledAt: number, over: Record<string, unknown> = {}) => ({
  isPlaying: true,
  progressMs,
  sampledAt,
  item: {
    id: "trk1",
    name: "Lean On",
    duration_ms: 176_000,
    artists: [{ name: "Major Lazer" }, { name: "DJ Snake" }, { name: "MØ" }],
    album: { name: "Peace Is the Mission", images: [{ url: "https://img/a.jpg" }] },
    ...over,
  },
});

describe("SpotifyProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("expose tous les artistes dans l'état émis", async () => {
    mockWindow(vi.fn().mockResolvedValue(playing(1000, Date.now())));
    const provider = new SpotifyProvider();
    const listener = vi.fn();
    provider.onStateChange(listener);
    await provider.connect();
    await vi.advanceTimersByTimeAsync(0);

    const state = listener.mock.calls[0][0];
    expect(state.track.artist).toBe("Major Lazer, DJ Snake, MØ");
    expect(state.track.artists).toEqual(["Major Lazer", "DJ Snake", "MØ"]);
    await provider.disconnect();
  });

  it("`updatedAt` est l'instant de la MESURE (sampledAt), pas celui du traitement", async () => {
    const measuredAt = Date.now() - 350;
    mockWindow(vi.fn().mockResolvedValue(playing(1000, measuredAt)));
    const provider = new SpotifyProvider();
    await provider.connect();
    const state = await provider.getPlaybackState();
    expect(state.updatedAt).toBe(measuredAt);
    await provider.disconnect();
  });

  it("rien en lecture -> track null, sans erreur", async () => {
    mockWindow(vi.fn().mockResolvedValue(null));
    const provider = new SpotifyProvider();
    await provider.connect();
    expect((await provider.getPlaybackState()).track).toBeNull();
    await provider.disconnect();
  });

  it("une erreur de polling est relayée, puis le polling RECULE (pas de martèlement de l'API)", async () => {
    const get = vi.fn().mockRejectedValue(new Error("429 rate limit"));
    mockWindow(get);
    const provider = new SpotifyProvider();
    const onError = vi.fn();
    provider.onError(onError);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect(onError).toHaveBeenCalledWith("429 rate limit");

    const callsAfterFirst = get.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1900); // avant le 1er recul (2 s)
    expect(get.mock.calls.length).toBe(callsAfterFirst);
    await vi.advanceTimersByTimeAsync(200);
    expect(get.mock.calls.length).toBe(callsAfterFirst + 1);
    await provider.disconnect();
  });

  it("après disconnect(), une réponse encore en vol n'émet plus rien", async () => {
    let release: (v: unknown) => void = () => {};
    const get = vi.fn().mockImplementation(() => new Promise((r) => (release = r)));
    mockWindow(get);
    const provider = new SpotifyProvider();
    const listener = vi.fn();
    provider.onStateChange(listener);
    await provider.connect();
    await provider.disconnect();
    release(playing(0, Date.now()));
    await vi.advanceTimersByTimeAsync(10);
    expect(listener).not.toHaveBeenCalled();
  });
});
