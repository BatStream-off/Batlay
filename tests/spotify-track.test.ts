import { describe, it, expect } from "vitest";
import { spotifyItemToTrack, type SpotifyItemLike } from "@/services/spotify-track";
import { normalizeArtistNames, formatArtists } from "@/utils/artists";

const ctx = { progressMs: 12_345, isPlaying: true };

const item = (over: Partial<SpotifyItemLike> = {}): SpotifyItemLike => ({
  id: "abc123",
  name: "Lean On",
  duration_ms: 176_561,
  artists: [{ name: "Major Lazer" }, { name: "DJ Snake" }, { name: "MØ" }],
  album: { name: "Peace Is the Mission", images: [{ url: "https://i.scdn.co/big.jpg" }, { url: "https://i.scdn.co/small.jpg" }] },
  ...over,
});

describe("spotifyItemToTrack — TOUS les artistes sont conservés", () => {
  it("3 artistes -> « Artiste 1, Artiste 2, Artiste 3 », dans l'ordre des crédits", () => {
    const track = spotifyItemToTrack(
      item({ artists: [{ name: "Artiste 1" }, { name: "Artiste 2" }, { name: "Artiste 3" }] }),
      ctx
    );
    expect(track.artist).toBe("Artiste 1, Artiste 2, Artiste 3");
    expect(track.artists).toEqual(["Artiste 1", "Artiste 2", "Artiste 3"]);
  });

  it("collaboration réelle avec caractère non ASCII (MØ)", () => {
    const track = spotifyItemToTrack(item(), ctx);
    expect(track.artist).toBe("Major Lazer, DJ Snake, MØ");
    expect(track.artists).toHaveLength(3);
  });

  it("deux artistes seulement : le second n'est pas perdu", () => {
    const track = spotifyItemToTrack(item({ artists: [{ name: "The Weeknd" }, { name: "Daft Punk" }] }), ctx);
    expect(track.artist).toBe("The Weeknd, Daft Punk");
  });

  it("un artiste dont le NOM contient une virgule reste UN seul artiste dans la liste structurée", () => {
    const track = spotifyItemToTrack(
      item({ artists: [{ name: "Tyler, The Creator" }, { name: "Kali Uchis" }, { name: "Earth, Wind & Fire" }] }),
      ctx
    );
    expect(track.artists).toEqual(["Tyler, The Creator", "Kali Uchis", "Earth, Wind & Fire"]);
    // la chaîne d'affichage est ambiguë (c'est pour ça que la liste existe) mais complète
    expect(track.artist).toBe("Tyler, The Creator, Kali Uchis, Earth, Wind & Fire");
  });

  it("supprime les doublons et les noms vides sans toucher aux autres", () => {
    const track = spotifyItemToTrack(
      item({ artists: [{ name: "A" }, { name: " " }, { name: "a" }, null, { name: "B" }, { name: null }] }),
      ctx
    );
    expect(track.artists).toEqual(["A", "B"]);
  });

  it("accents conservés", () => {
    const track = spotifyItemToTrack(item({ name: "Balance ton quoi", artists: [{ name: "Angèle" }, { name: "Stromaé" }] }), ctx);
    expect(track.artist).toBe("Angèle, Stromaé");
  });

  it("ne lève JAMAIS d'exception sur une forme inattendue (fichier local, épisode, champs absents)", () => {
    expect(() => spotifyItemToTrack({} as SpotifyItemLike, ctx)).not.toThrow();
    expect(() => spotifyItemToTrack({ artists: null, album: null } as SpotifyItemLike, ctx)).not.toThrow();
    const episode = spotifyItemToTrack(
      { id: "ep1", type: "episode", name: "Épisode 12", show: { name: "Un podcast", publisher: "Radio Exemple" }, images: [{ url: "https://x/y.jpg" }] },
      ctx
    );
    expect(episode.artist).toBe("Radio Exemple");
    expect(episode.album).toBe("Un podcast");
    expect(episode.artwork).toBe("https://x/y.jpg");
  });

  it("fichier local (id null) : identifiant de repli distinct pour chaque morceau", () => {
    const a = spotifyItemToTrack(item({ id: null, uri: null, name: "Local A", is_local: true }), ctx);
    const b = spotifyItemToTrack(item({ id: null, uri: null, name: "Local B", is_local: true }), ctx);
    expect(a.id).not.toBe(b.id);
    expect(a.id).toBeTruthy();
  });

  it("renseigne source, pochette, durée, progression et statut", () => {
    const track = spotifyItemToTrack(item(), { progressMs: 5000, isPlaying: false });
    expect(track).toMatchObject({
      id: "abc123",
      title: "Lean On",
      album: "Peace Is the Mission",
      source: "Spotify",
      artwork: "https://i.scdn.co/big.jpg",
      duration: 176_561,
      progress: 5000,
      isPlaying: false,
      playbackStatus: "paused",
    });
  });
});

describe("normalizeArtistNames / formatArtists", () => {
  it("ne découpe jamais un nom", () => {
    expect(normalizeArtistNames(["Simon & Garfunkel", "Earth, Wind & Fire"])).toEqual(["Simon & Garfunkel", "Earth, Wind & Fire"]);
  });

  it("ignore les valeurs non textuelles et une entrée qui n'est pas un tableau", () => {
    expect(normalizeArtistNames([1, null, undefined, {}, "OK"])).toEqual(["OK"]);
    expect(normalizeArtistNames(undefined)).toEqual([]);
  });

  it("formatArtists utilise le séparateur choisi, ou la chaîne `artist` quand il n'y a pas de liste", () => {
    const t = { artist: "A, B, C", artists: ["A", "B", "C"] };
    expect(formatArtists(t)).toBe("A, B, C");
    expect(formatArtists(t, " • ")).toBe("A • B • C");
    // Lecture système : uniquement la chaîne, transmise telle quelle
    expect(formatArtists({ artist: "Artiste 1, Artiste 2" }, " • ")).toBe("Artiste 1, Artiste 2");
  });
});
