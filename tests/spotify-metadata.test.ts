import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  resolveSpotifyMetadata,
  isSpotifySource,
  SPOTIFY_AD_TITLE,
  SPOTIFY_AD_ARTIST,
  SPOTIFY_AD_TRACK_ID,
} from "@/utils/spotify-metadata";
import { classifyMetadataDebugCases } from "@/utils/metadata-debug";
import { SystemMediaProvider } from "@/services/system-media-provider";
import { buildScript } from "../electron/services/system-media";

const resolve = (title: string, artist: string, windowTitle: string | null, sourceAppId = "Spotify.exe") =>
  resolveSpotifyMetadata({ sourceAppId, title, artist, windowTitle });

describe("Spotify : publicités", () => {
  it("reconnaît une pub grâce au titre de la fenêtre, même si SMTC affiche encore le morceau précédent", () => {
    // SMTC est resté sur le morceau d'avant, la fenêtre dit « Advertisement ».
    expect(resolve("Instant Crush", "Daft Punk", "Advertisement")).toEqual({
      title: SPOTIFY_AD_TITLE,
      artist: SPOTIFY_AD_ARTIST,
      isAd: true,
    });
  });

  it.each(["Publicité", "publicite", "Werbung", "Publicidad"])("interface localisée : « %s »", (word) => {
    expect(resolve("X", "Y", word).isAd).toBe(true);
  });

  it("reconnaît une pub annoncée par SMTC lui-même (artiste « Spotify »)", () => {
    expect(resolve("Advertisement", "Spotify", null).isAd).toBe(true);
    expect(resolve("Advertisement", "", null).isAd).toBe(true);
  });

  it("ne confond pas un vrai morceau intitulé « Advertisement » avec une pub", () => {
    expect(resolve("Advertisement", "Some Band", "Some Band - Advertisement").isAd).toBe(false);
  });

  it("ne touche à rien pour un autre lecteur", () => {
    expect(resolve("Advertisement", "Spotify", "Advertisement", "vlc.exe")).toEqual({
      title: "Advertisement",
      artist: "Spotify",
      isAd: false,
    });
  });
});

describe("Spotify : artistes complets via le titre de la fenêtre", () => {
  it("complète l'artiste quand SMTC n'en donne que le premier", () => {
    const r = resolve("Lean On (feat. MØ & DJ Snake)", "Major Lazer", "Major Lazer, DJ Snake, MØ - Lean On (feat. MØ & DJ Snake)");
    expect(r.artist).toBe("Major Lazer, DJ Snake, MØ");
    expect(r.title).toBe("Lean On (feat. MØ & DJ Snake)");
  });

  it("ne change rien quand SMTC est déjà complet", () => {
    expect(resolve("Lean On", "Major Lazer, DJ Snake", "Major Lazer, DJ Snake - Lean On").artist).toBe(
      "Major Lazer, DJ Snake"
    );
  });

  it("s'ancre sur le titre SMTC : un « - » dans le titre ne casse rien", () => {
    const r = resolve("Time - 2011 Remaster", "Pink Floyd", "Pink Floyd - Time - 2011 Remaster");
    expect(r).toEqual({ title: "Time - 2011 Remaster", artist: "Pink Floyd", isAd: false });
  });

  it("ne remplace pas l'artiste quand la fenêtre est en retard ou en avance (changement de piste)", () => {
    // Fenêtre déjà sur le nouveau morceau, SMTC encore sur l'ancien : désaccord => on ne touche à rien.
    expect(resolve("Old Song", "Old Artist", "New Artist, Guest - New Song").artist).toBe("Old Artist");
  });

  it("n'accepte pas un artiste qui ne COMMENCE pas par celui de SMTC", () => {
    expect(resolve("Song", "Guest", "Main Artist, Guest - Song").artist).toBe("Guest");
  });

  it("n'invente pas de co-artiste : « Simon » n'est pas complété en « Simon Says »", () => {
    expect(resolve("Song", "Simon", "Simon Says - Song").artist).toBe("Simon");
  });

  it("accepte « feat. », « & », « x » comme séparateurs", () => {
    expect(resolve("S", "A", "A feat. B - S").artist).toBe("A feat. B");
    expect(resolve("S", "A", "A & B - S").artist).toBe("A & B");
    expect(resolve("S", "A", "A x B - S").artist).toBe("A x B");
  });

  it("renseigne l'artiste quand SMTC n'en fournit aucun", () => {
    expect(resolve("Song", "", "Some Band - Song").artist).toBe("Some Band");
  });

  it("ignore les titres de fenêtre d'inactivité (« Spotify Premium », « Spotify Free »)", () => {
    expect(resolve("Song", "Band", "Spotify Premium")).toEqual({ title: "Song", artist: "Band", isAd: false });
    expect(resolve("Song", "Band", "Spotify Free").artist).toBe("Band");
  });

  it("sans titre de fenêtre (Spotify réduit dans la zone de notification) : comportement SMTC inchangé", () => {
    expect(resolve("Song", "Band", null).artist).toBe("Band");
    expect(resolve("Song", "Band", "").artist).toBe("Band");
  });
});

describe("journal de diagnostic", () => {
  const base = { album: "" };
  it("signale un titre de fenêtre qui ne correspond pas à SMTC", () => {
    expect(classifyMetadataDebugCases({ ...base, title: "Lean On", artist: "Major Lazer", windowTitle: "Major Lazer, DJ Snake - Lean On" })).toContain(
      "fenetre-spotify"
    );
  });
  it("ne signale rien quand la fenêtre est cohérente ou absente", () => {
    expect(classifyMetadataDebugCases({ ...base, title: "Song", artist: "Band", windowTitle: "Band - Song" })).not.toContain("fenetre-spotify");
    expect(classifyMetadataDebugCases({ ...base, title: "Song", artist: "Band" })).not.toContain("fenetre-spotify");
  });
});

// --- Provider de bout en bout -------------------------------------------------

function mockWindow(current: unknown) {
  const lookup = vi.fn().mockResolvedValue({ url: "https://cover.test/x.jpg", source: "itunes", cached: false });
  (globalThis as unknown as { window: unknown }).window = {
    batlay: {
      systemMedia: {
        isSupported: vi.fn().mockResolvedValue(true),
        getCurrent: vi.fn().mockResolvedValue(current),
        listSessions: vi.fn().mockResolvedValue([]),
      },
      artwork: { lookup },
    },
  };
  return { lookup };
}

const smtc = (over: Record<string, unknown>) => ({
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
  ...over,
});

describe("SystemMediaProvider + Spotify", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("pendant une pub : ni morceau précédent, ni barre de progression, ni recherche de pochette", async () => {
    const { lookup } = mockWindow(smtc({ windowTitle: "Advertisement" }));
    const provider = new SystemMediaProvider();
    await provider.connect();
    await vi.advanceTimersByTimeAsync(50);

    const track = await provider.getCurrentTrack();
    expect(track).toMatchObject({
      id: SPOTIFY_AD_TRACK_ID,
      title: SPOTIFY_AD_TITLE,
      artist: SPOTIFY_AD_ARTIST,
      duration: 0,
      progress: 0,
      source: "Spotify",
    });
    expect(track?.album).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("affiche tous les artistes mais cherche la pochette avec l'artiste SMTC (celui du catalogue)", async () => {
    const { lookup } = mockWindow(
      smtc({ title: "Lean On", artist: "Major Lazer", windowTitle: "Major Lazer, DJ Snake, MØ - Lean On" })
    );
    const provider = new SystemMediaProvider();
    await provider.connect();
    await vi.advanceTimersByTimeAsync(50);

    const track = await provider.getCurrentTrack();
    expect(track?.artist).toBe("Major Lazer, DJ Snake, MØ");
    expect(lookup).toHaveBeenCalledWith("Major Lazer", "Lean On");
  });

  it("l'identifiant du morceau ne change pas quand la fenêtre apparaît ou disparaît en cours de morceau", async () => {
    const withWindow = smtc({ title: "Lean On", artist: "Major Lazer", windowTitle: "Major Lazer, DJ Snake - Lean On" });
    const { } = mockWindow(withWindow);
    const provider = new SystemMediaProvider();
    await provider.connect();
    const first = await provider.getCurrentTrack();

    (window as unknown as { batlay: { systemMedia: { getCurrent: ReturnType<typeof vi.fn> } } }).batlay.systemMedia.getCurrent.mockResolvedValue(
      smtc({ title: "Lean On", artist: "Major Lazer", windowTitle: null })
    );
    const second = await provider.getCurrentTrack();

    expect(second?.id).toBe(first?.id);
    expect(first?.artist).toBe("Major Lazer, DJ Snake");
    expect(second?.artist).toBe("Major Lazer");
  });

  it("un autre lecteur n'est pas affecté, même avec un titre de fenêtre", async () => {
    mockWindow(smtc({ sourceAppId: "vlc.exe", title: "Advertisement", artist: "Spotify", windowTitle: "Advertisement" }));
    const provider = new SystemMediaProvider();
    await provider.connect();
    const track = await provider.getCurrentTrack();
    expect(track).toMatchObject({ title: "Advertisement", artist: "Spotify" });
  });
});

describe("script PowerShell (contrôle du texte généré : PowerShell n'est pas exécutable hors Windows)", () => {
  const script = buildScript({});

  it("lit le titre de la fenêtre Spotify, et seulement pour Spotify", () => {
    expect(script).toContain("-match 'spotify'");
    expect(script).toContain("Get-Process -Name 'Spotify'");
    expect(script).toContain("MainWindowTitle");
  });

  it("le renvoie dans la session JSON, sans interpolation JavaScript accidentelle", () => {
    expect(script).toContain("windowTitle   = $windowTitle");
    expect(script).not.toContain("undefined");
    expect(script).not.toMatch(/\$\{/);
  });

  it("n'exécute rien de plus pour la liste des sessions (listOnly sort avant)", () => {
    expect(script.indexOf("listOnly")).toBeLessThan(script.indexOf("Get-Process"));
  });
});
