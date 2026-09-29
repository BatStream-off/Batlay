import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SystemMediaProvider } from "@/services/system-media-provider";
import type { PlaybackState } from "@/types/track";

type Getter = ReturnType<typeof vi.fn>;
const base = {
  title: "Lean On",
  artist: "Major Lazer, DJ Snake, MØ",
  album: "Peace Is the Mission",
  sourceAppId: "Spotify.exe",
  isPlaying: true,
  positionMs: 30_000,
  durationMs: 176_000,
  hasThumbnail: true,
  artworkError: null,
};

function mockWindow(getCurrent: Getter) {
  (globalThis as unknown as { window: unknown }).window = {
    batlay: {
      systemMedia: { isSupported: vi.fn().mockResolvedValue(true), getCurrent, listSessions: vi.fn().mockResolvedValue([]) },
      artwork: { lookup: vi.fn().mockResolvedValue({ url: null, source: "none", cached: false }) },
    },
  };
}

describe("SystemMediaProvider — latence et horodatage", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("`updatedAt` = instant de la mesure côté Windows (sampledAtMs), pas la fin du traitement", async () => {
    const sampledAtMs = Date.now() - 600;
    mockWindow(vi.fn().mockResolvedValue({ ...base, artwork: null, sampledAtMs }));
    const provider = new SystemMediaProvider();
    await provider.connect();
    expect((await provider.getPlaybackState()).updatedAt).toBe(sampledAtMs);
    await provider.disconnect();
  });

  it("l'état (titre, artistes, progression) est émis SANS attendre la pochette, puis ré-émis avec elle", async () => {
    let releaseArtwork: (v: unknown) => void = () => {};
    const getCurrent = vi.fn().mockImplementation((opts?: { includeArtwork?: boolean }) => {
      if (opts?.includeArtwork) return new Promise((resolve) => (releaseArtwork = resolve)); // lent, comme un vrai PowerShell
      return Promise.resolve({ ...base, artwork: null, sampledAtMs: Date.now() });
    });
    mockWindow(getCurrent);

    const provider = new SystemMediaProvider();
    const states: PlaybackState[] = [];
    provider.onStateChange((s) => states.push(s));
    await provider.connect();
    await vi.advanceTimersByTimeAsync(0);

    // 1) émis immédiatement, sans pochette : la progression n'attend pas le 2e process PowerShell
    expect(states).toHaveLength(1);
    expect(states[0].track?.artist).toBe("Major Lazer, DJ Snake, MØ");
    expect(states[0].track?.artwork).toBeUndefined();

    // 2) la pochette arrive : ré-émission immédiate, sans attendre le poll suivant
    releaseArtwork({ ...base, artwork: "data:image/png;base64,AAAA", sampledAtMs: Date.now() });
    await vi.advanceTimersByTimeAsync(0);
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states[states.length - 1].track?.artwork).toBe("data:image/png;base64,AAAA");
    // même instant de mesure : l'horloge de progression ne voit aucun changement de trajectoire
    expect(states[states.length - 1].updatedAt).toBe(states[0].updatedAt);
    await provider.disconnect();
  });

  it("titre et artiste sont nettoyés (mojibake d'une source, caractères de contrôle)", async () => {
    mockWindow(
      vi.fn().mockResolvedValue({ ...base, title: "CafÃ© del Mar\u0000", artist: "AngÃ¨le, Stromae", artwork: null, sampledAtMs: Date.now() })
    );
    const provider = new SystemMediaProvider();
    await provider.connect();
    const track = (await provider.getPlaybackState()).track;
    expect(track?.title).toBe("Café del Mar");
    expect(track?.artist).toBe("Angèle, Stromae");
    await provider.disconnect();
  });

  it("une pochette introuvable n'est pas re-demandée en boucle à chaque poll", async () => {
    const getCurrent = vi.fn().mockResolvedValue({ ...base, hasThumbnail: false, artwork: null, sampledAtMs: Date.now() });
    mockWindow(getCurrent);
    const provider = new SystemMediaProvider();
    await provider.connect();
    await vi.advanceTimersByTimeAsync(20_000);
    const withArtwork = getCurrent.mock.calls.filter(([o]) => (o as { includeArtwork?: boolean } | undefined)?.includeArtwork);
    expect(withArtwork.length).toBeLessThanOrEqual(3); // tentatives espacées et bornées, pas une par poll
    await provider.disconnect();
  });
});
