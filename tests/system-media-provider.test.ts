import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SystemMediaProvider, prettifySourceApp } from "@/services/system-media-provider";

function mockWindow(overrides: Partial<{ isSupported: boolean; current: unknown }> = {}) {
  (globalThis as unknown as { window: unknown }).window = {
    batlay: {
      systemMedia: {
        isSupported: vi.fn().mockResolvedValue(overrides.isSupported ?? true),
        getCurrent: vi.fn().mockResolvedValue(overrides.current ?? null),
        listSessions: vi.fn().mockResolvedValue([]),
      },
    },
  };
}

describe("SystemMediaProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("refuse de se connecter si la plateforme n'est pas supportée", async () => {
    mockWindow({ isSupported: false });
    const provider = new SystemMediaProvider();
    await expect(provider.connect()).rejects.toThrow(/Windows/);
  });

  it("n'a pas de morceau tant qu'il n'est pas connecté", async () => {
    mockWindow();
    const provider = new SystemMediaProvider();
    expect(await provider.getCurrentTrack()).toBeNull();
  });

  it("normalise le morceau renvoyé par window.batlay.systemMedia.getCurrent", async () => {
    mockWindow({
      current: {
        title: "Instant Crush",
        artist: "Daft Punk",
        album: "Random Access Memories",
        sourceAppId: "Spotify.exe",
        isPlaying: true,
        positionMs: 12_000,
        durationMs: 337_000,
        artwork: null,
        hasThumbnail: false,
        artworkError: null,
      },
    });
    const provider = new SystemMediaProvider();
    await provider.connect();
    const track = await provider.getCurrentTrack();
    expect(track).toMatchObject({
      title: "Instant Crush",
      artist: "Daft Punk",
      album: "Random Access Memories",
      progress: 12_000,
      duration: 337_000,
      isPlaying: true,
    });
  });

  it("retourne null quand rien ne joue côté système, sans lever d'erreur", async () => {
    mockWindow({ current: null });
    const provider = new SystemMediaProvider();
    await provider.connect();
    expect(await provider.getCurrentTrack()).toBeNull();
  });

  it("notifie les abonnés via onStateChange lors du polling", async () => {
    mockWindow({
      current: { title: "A", artist: "B", album: null, sourceAppId: null, isPlaying: true, positionMs: 0, durationMs: 100_000, artwork: null, hasThumbnail: false, artworkError: null },
    });
    const provider = new SystemMediaProvider();
    const listener = vi.fn();
    provider.onStateChange(listener);
    await provider.connect();
    // connect() déclenche un premier pollOnce() en fire-and-forget (void) :
    // on laisse ses microtasks se résoudre avant d'observer l'effet.
    await vi.advanceTimersByTimeAsync(0);
    expect(listener).toHaveBeenCalled();
  });

  it("relaie les erreurs de polling via onError plutôt que de les avaler", async () => {
    mockWindow();
    const provider = new SystemMediaProvider();
    await provider.connect();
    const errorListener = vi.fn();
    provider.onError(errorListener);

    const win = (globalThis as unknown as { window: { batlay: { systemMedia: { getCurrent: ReturnType<typeof vi.fn> } } } }).window;
    win.batlay.systemMedia.getCurrent.mockRejectedValueOnce(new Error("PowerShell indisponible"));

    // Sans morceau en cours, la cadence est la cadence lente (POLL_IDLE_MS).
    await vi.advanceTimersByTimeAsync(3000);
    expect(errorListener).toHaveBeenCalledWith("PowerShell indisponible");
  });

  it("transmet la session préférée à chaque appel de window.batlay.systemMedia.getCurrent", async () => {
    mockWindow({
      current: { title: "A", artist: "B", album: null, sourceAppId: "Spotify.exe", isPlaying: true, positionMs: 0, durationMs: 100_000, artwork: null, hasThumbnail: false, artworkError: null },
    });
    const provider = new SystemMediaProvider();
    provider.setPreferredSession("Spotify.exe");
    await provider.connect();

    const win = (globalThis as unknown as { window: { batlay: { systemMedia: { getCurrent: ReturnType<typeof vi.fn> } } } }).window;
    expect(win.batlay.systemMedia.getCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ preferredAppId: "Spotify.exe" })
    );
  });

  it("ne redemande la pochette que lorsque le morceau change (mise en cache)", async () => {
    mockWindow({
      current: { title: "A", artist: "B", album: null, sourceAppId: null, isPlaying: true, positionMs: 0, durationMs: 100_000, artwork: "data:image/png;base64,abc", hasThumbnail: true, artworkError: null },
    });
    const provider = new SystemMediaProvider();
    await provider.connect();
    // Laisse le premier poll interne déclenché par connect() se terminer
    // avant d'appeler getCurrentTrack() nous-mêmes, pour éviter une race
    // entre deux résolutions concurrentes du cache de pochette.
    await vi.advanceTimersByTimeAsync(0);
    await provider.getCurrentTrack();
    await provider.getCurrentTrack();

    const win = (globalThis as unknown as { window: { batlay: { systemMedia: { getCurrent: ReturnType<typeof vi.fn> } } } }).window;
    const artworkCalls = win.batlay.systemMedia.getCurrent.mock.calls.filter(
      ([opts]) => (opts as { includeArtwork?: boolean } | undefined)?.includeArtwork
    );
    // connect() -> 1er getCurrentTrack() : 1 appel sans pochette + 1 avec pochette (morceau inconnu).
    // 2e et 3e getCurrentTrack() (appelés explicitement ci-dessus) : pochette déjà en cache, donc aucun nouvel appel avec includeArtwork.
    expect(artworkCalls.length).toBe(1);
  });

  it("conserve tous les artistes sans jamais les découper", async () => {
    mockWindow({
      current: {
        title: "Titre",
        artist: "Artiste 1, Artiste 2, Artiste 3",
        album: null,
        sourceAppId: "Spotify.exe",
        isPlaying: true,
        positionMs: 0,
        durationMs: 100_000,
        artwork: null,
        hasThumbnail: false,
        artworkError: null,
      },
    });
    const provider = new SystemMediaProvider();
    await provider.connect();
    const track = await provider.getCurrentTrack();
    expect(track?.artist).toBe("Artiste 1, Artiste 2, Artiste 3");
  });

  it("affiche des libellés propres quand les métadonnées manquent", async () => {
    mockWindow({
      current: {
        title: "",
        artist: "",
        album: null,
        sourceAppId: null,
        isPlaying: true,
        positionMs: 0,
        durationMs: 0,
        artwork: null,
        hasThumbnail: false,
        artworkError: null,
      },
    });
    const provider = new SystemMediaProvider();
    await provider.connect();
    const track = await provider.getCurrentTrack();
    expect(track?.title).toBe("Titre inconnu");
    expect(track?.artist).toBe("Artiste inconnu");
  });

  it("distingue lecture, pause et absence de morceau", async () => {
    const base = {
      title: "T",
      artist: "A",
      album: null,
      sourceAppId: "Spotify.exe",
      positionMs: 0,
      durationMs: 100_000,
      artwork: null,
      hasThumbnail: false,
      artworkError: null,
    };

    mockWindow({ current: { ...base, isPlaying: true, playbackStatus: "playing" } });
    const provider = new SystemMediaProvider();
    await provider.connect();
    expect((await provider.getCurrentTrack())?.isPlaying).toBe(true);

    const win = (globalThis as unknown as {
      window: { batlay: { systemMedia: { getCurrent: ReturnType<typeof vi.fn> } } };
    }).window;

    win.batlay.systemMedia.getCurrent.mockResolvedValue({
      ...base,
      isPlaying: false,
      playbackStatus: "paused",
    });
    const paused = await provider.getCurrentTrack();
    expect(paused?.isPlaying).toBe(false);
    expect(paused?.playbackStatus).toBe("paused");

    win.batlay.systemMedia.getCurrent.mockResolvedValue(null);
    expect(await provider.getCurrentTrack()).toBeNull();
    const state = await provider.getPlaybackState();
    expect(state.track).toBeNull();
    expect(state.isPlaying).toBe(false);
  });

  it("expose le lecteur source pour le composant Source", async () => {
    expect(prettifySourceApp("Spotify.exe")).toBe("Spotify");
    expect(prettifySourceApp("vlc.exe")).toBe("VLC");
    expect(prettifySourceApp("msedge.exe")).toBe("Edge");
    expect(prettifySourceApp("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic")).toBe("ZuneMusic");
    expect(prettifySourceApp(null)).toBe("");
  });

  it("garde le lecteur choisi quand il disparaît, et le reprend à son retour", async () => {
    const vlcTrack = {
      title: "Morceau VLC",
      artist: "A",
      album: null,
      sourceAppId: "vlc.exe",
      isPlaying: true,
      positionMs: 0,
      durationMs: 100_000,
      artwork: null,
      hasThumbnail: false,
      artworkError: null,
    };
    mockWindow({ current: vlcTrack });
    const provider = new SystemMediaProvider();
    provider.setPreferredSession("vlc.exe");
    await provider.connect();

    const win = (globalThis as unknown as {
      window: { batlay: { systemMedia: { getCurrent: ReturnType<typeof vi.fn> } } };
    }).window;

    // Le lecteur disparaît : aucun morceau, mais le choix reste intact.
    win.batlay.systemMedia.getCurrent.mockResolvedValue(null);
    expect(await provider.getCurrentTrack()).toBeNull();
    expect(provider.getPreferredSession()).toBe("vlc.exe");
    expect(win.batlay.systemMedia.getCurrent).toHaveBeenLastCalledWith(
      expect.objectContaining({ preferredAppId: "vlc.exe" })
    );

    // Il revient : on le reprend, sans jamais avoir basculé ailleurs.
    win.batlay.systemMedia.getCurrent.mockResolvedValue(vlcTrack);
    expect((await provider.getCurrentTrack())?.title).toBe("Morceau VLC");
    expect(provider.getPreferredSession()).toBe("vlc.exe");
  });

  it("ne réutilise jamais la pochette du morceau précédent", async () => {
    mockWindow({
      current: {
        title: "Morceau A",
        artist: "A",
        album: null,
        sourceAppId: null,
        isPlaying: true,
        positionMs: 0,
        durationMs: 100_000,
        artwork: "data:image/png;base64,AAA",
        hasThumbnail: true,
        artworkError: null,
      },
    });
    const provider = new SystemMediaProvider();
    await provider.connect();
    await vi.advanceTimersByTimeAsync(0);
    expect((await provider.getCurrentTrack())?.artwork).toBe("data:image/png;base64,AAA");

    const win = (globalThis as unknown as {
      window: { batlay: { systemMedia: { getCurrent: ReturnType<typeof vi.fn> } } };
    }).window;
    win.batlay.systemMedia.getCurrent.mockResolvedValue({
      title: "Morceau B",
      artist: "A",
      album: null,
      sourceAppId: null,
      isPlaying: true,
      positionMs: 0,
      durationMs: 100_000,
      artwork: null,
      hasThumbnail: false,
      artworkError: null,
    });

    const next = await provider.getCurrentTrack();
    expect(next?.title).toBe("Morceau B");
    // Jamais l'ancienne pochette avec le nouveau titre.
    expect(next?.artwork).toBeUndefined();
  });
});
