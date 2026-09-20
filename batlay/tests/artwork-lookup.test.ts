import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";

// artwork-lookup.ts tourne dans le process principal Electron et n'a besoin
// que de app.getPath("userData") pour son cache disque.
vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

const {
  lookupArtwork,
  normalizeMetadata,
  buildQueryCandidates,
  isPlausibleMatch,
  isPlaceholderArtist,
  cleanArtist,
  cleanTitle,
  upscaleItunesArtwork,
  similarity,
  __clearArtworkCache,
} = await import("../electron/services/artwork-lookup");

// --- Fabriques de réponses -------------------------------------------------

const json = (body: unknown) => ({ ok: true, text: async () => JSON.stringify(body) });

const itunesHit = (trackName: string, artistName: string) =>
  json({
    results: [
      { artworkUrl100: "https://is1.mzstatic.com/z/100x100bb.jpg", trackName, artistName },
    ],
  });

const deezerHit = (title: string, artist: string) =>
  json({
    data: [{ title, artist: { name: artist }, album: { cover_xl: "https://dzcdn.net/xl.jpg" } }],
  });

const musicbrainzHit = (title: string, artist: string, groupId = "mbid-1") =>
  json({
    recordings: [
      { title, "artist-credit": [{ name: artist }], releases: [{ "release-group": { id: groupId } }] },
    ],
  });

const EMPTY = json({ results: [], data: [], recordings: [] });

/** Installe un faux réseau et retourne la liste des URLs appelées. */
function mockNetwork(handler: (url: string) => unknown): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return handler(url);
  });
  return calls;
}

// --- Tests -----------------------------------------------------------------

describe("normalisation des métadonnées Windows", () => {
  it("extrait l'artiste principal d'un featuring", () => {
    const meta = normalizeMetadata("Drake feat. Rihanna", "Too Good");
    expect(meta.artist).toBe("Drake");
    expect(meta.artistFull).toBe("Drake feat. Rihanna");
  });

  it("nettoie un titre de fichier bruité par YouTube", () => {
    const meta = normalizeMetadata("Daft Punk - Topic", "03 - Instant Crush (Official Video).mp3");
    expect(meta.artist).toBe("Daft Punk");
    expect(meta.title).toBe("Instant Crush");
  });

  it("récupère l'artiste depuis le titre quand Windows n'en donne pas", () => {
    const meta = normalizeMetadata("Unknown Artist", "Stromae - Formidable");
    expect(meta.artist).toBe("Stromae");
    expect(meta.title).toBe("Formidable");
    expect(meta.artistWasPlaceholder).toBe(false);
  });

  it("traite le nom du navigateur ou du lecteur comme un artiste absent", () => {
    expect(isPlaceholderArtist("VLC media player")).toBe(true);
    expect(isPlaceholderArtist("YouTube")).toBe(true);
    expect(isPlaceholderArtist("Unknown Artist")).toBe(true);
    expect(isPlaceholderArtist("1234")).toBe(true);
    expect(isPlaceholderArtist("Adele")).toBe(false);
  });

  it("normalise underscores, espaces et caractères invisibles", () => {
    const meta = normalizeMetadata("Daft_Punk", "Get_Lucky_feat_Pharrell_Williams");
    expect(meta.artist).toBe("Daft Punk");
    expect(meta.titleCore).toBe("Get Lucky");
    expect(normalizeMetadata("  The\u200BWeeknd ", " Blinding\u00A0Lights ").title).toBe(
      "Blinding Lights"
    );
  });

  it("ne casse pas un nom de groupe contenant '&'", () => {
    expect(normalizeMetadata("Simon & Garfunkel", "The Boxer").artist).toBe("Simon & Garfunkel");
  });

  it("retire VEVO et les mentions de chaîne", () => {
    expect(cleanArtist("EdSheeranVEVO")).toBe("EdSheeran");
    expect(cleanArtist("Daft Punk - Topic")).toBe("Daft Punk");
  });

  it("conserve les mentions qui désignent une version différente", () => {
    expect(cleanTitle("Creep (Acoustic)")).toBe("Creep (Acoustic)");
    expect(cleanTitle("Alive (Live at Wembley)")).toBe("Alive (Live at Wembley)");
    expect(cleanTitle("Closer (Remix)")).toBe("Closer (Remix)");
  });

  it("agrandit l'URL de pochette iTunes", () => {
    expect(upscaleItunesArtwork("https://is1.mzstatic.com/a/100x100bb.jpg")).toBe(
      "https://is1.mzstatic.com/a/600x600bb.jpg"
    );
  });
});

describe("candidats de recherche", () => {
  it("produit un ordre déterministe, du plus précis au plus permissif", () => {
    const candidates = buildQueryCandidates(normalizeMetadata("Drake feat. Rihanna", "Too Good"));
    expect(candidates[0]).toEqual({ artist: "Drake", title: "Too Good" });
    expect(candidates.map((c) => `${c.artist}|${c.title}`)).toEqual([
      "Drake|Too Good",
      "Drake feat. Rihanna|Too Good",
    ]);
  });

  it("ajoute un candidat titre seul quand aucun artiste n'est exploitable", () => {
    const candidates = buildQueryCandidates(normalizeMetadata("", "Morceau Sans Artiste"));
    expect(candidates.at(-1)).toEqual({ artist: "", title: "Morceau Sans Artiste" });
  });
});

describe("vérification du résultat (anti faux positif)", () => {
  it("rejette un morceau sans rapport", () => {
    expect(
      isPlausibleMatch(
        { artist: "Daft Punk", title: "Instant Crush" },
        { url: "u", artist: "Bruno Mars", title: "Grenade" }
      )
    ).toBe(false);
  });

  it("rejette le bon titre chez le mauvais artiste", () => {
    expect(
      isPlausibleMatch({ artist: "Adele", title: "Hello" }, { url: "u", artist: "Lionel Richie", title: "Hello" })
    ).toBe(false);
  });

  it("accepte un crédit plus large que la recherche", () => {
    expect(
      isPlausibleMatch(
        { artist: "Drake", title: "Too Good" },
        { url: "u", artist: "Drake feat. Rihanna", title: "Too Good" }
      )
    ).toBe(true);
  });

  it("mesure la similarité de façon tolérante", () => {
    expect(similarity("Formidable", "Formidable")).toBe(1);
    expect(similarity("Instant Crush", "Grenade")).toBeLessThan(0.3);
  });
});

describe("lookupArtwork", () => {
  beforeEach(() => __clearArtworkCache());
  afterEach(() => vi.unstubAllGlobals());

  it("trouve la pochette sur iTunes et renvoie la version 600x600", async () => {
    const calls = mockNetwork((url) =>
      url.includes("itunes") ? itunesHit("Instant Crush", "Daft Punk") : EMPTY
    );

    const result = await lookupArtwork("Daft Punk - Topic", "03 - Instant Crush (Official Video).mp3");

    expect(result).toEqual({
      url: "https://is1.mzstatic.com/z/600x600bb.jpg",
      source: "itunes",
      cached: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Daft%20Punk%20Instant%20Crush");
  });

  it("bascule sur Deezer quand iTunes ne trouve rien", async () => {
    const calls = mockNetwork((url) => {
      if (url.includes("itunes")) return json({ results: [] });
      if (url.includes("deezer")) return deezerHit("Formidable", "Stromae");
      return EMPTY;
    });

    const result = await lookupArtwork("Stromae", "Formidable");

    expect(result.source).toBe("deezer");
    expect(result.url).toBe("https://dzcdn.net/xl.jpg");
    expect(calls[0]).toContain("itunes");
    expect(calls.at(-1)).toContain("deezer");
  });

  it("bascule sur Cover Art Archive quand iTunes et Deezer échouent", async () => {
    mockNetwork((url) => {
      if (url.includes("itunes")) return json({ results: [] });
      if (url.includes("deezer")) return json({ data: [] });
      if (url.includes("musicbrainz")) return musicbrainzHit("Obscure Track", "Petit Label");
      return { ok: true, text: async () => "" }; // HEAD sur coverartarchive.org
    });

    const result = await lookupArtwork("Petit Label", "Obscure Track");

    expect(result.source).toBe("coverartarchive");
    expect(result.url).toBe("https://coverartarchive.org/release-group/mbid-1/front-500");
  });

  it("renvoie null quand toutes les sources répondent sans rien connaître", async () => {
    mockNetwork(() => EMPTY);
    const result = await lookupArtwork("Moi", "Enregistrement Perso");
    expect(result).toEqual({ url: null, source: "none", cached: false });
  });

  it("ne lève jamais d'erreur si Internet est indisponible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ENOTFOUND api.deezer.com"))
    );
    const result = await lookupArtwork("Adele", "Hello");
    expect(result).toEqual({ url: null, source: "none", cached: false });
  });

  it("ne lève jamais d'erreur sur timeout", async () => {
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
    });
    const result = await lookupArtwork("Any", "Thing");
    expect(result.url).toBeNull();
    expect(result.source).toBe("none");
  });

  it("met un succès en cache, insensible à la casse et au bruit du titre", async () => {
    const calls = mockNetwork((url) => (url.includes("itunes") ? itunesHit("Hello", "Adele") : EMPTY));

    await lookupArtwork("Adele", "Hello");
    const callsAfterFirst = calls.length;
    const second = await lookupArtwork("ADELE", "Hello (Official Video)");

    expect(second.cached).toBe(true);
    expect(second.url).toBe("https://is1.mzstatic.com/z/600x600bb.jpg");
    expect(calls).toHaveLength(callsAfterFirst);
  });

  it("met en cache un échec définitif pour ne pas marteler les APIs", async () => {
    const calls = mockNetwork(() => EMPTY);

    const first = await lookupArtwork("Moi", "Enregistrement Perso");
    const callsAfterFirst = calls.length;
    const second = await lookupArtwork("Moi", "Enregistrement Perso");

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.url).toBeNull();
    expect(calls).toHaveLength(callsAfterFirst);
  });

  it("met aussi en cache un échec transitoire (réseau coupé)", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async () => {
      calls.push("x");
      throw new Error("réseau indisponible");
    });

    await lookupArtwork("Adele", "Hello");
    const callsAfterFirst = calls.length;
    const second = await lookupArtwork("Adele", "Hello");

    expect(second.cached).toBe(true);
    expect(calls).toHaveLength(callsAfterFirst);
  });

  it("relance une recherche au changement de morceau", async () => {
    const calls = mockNetwork((url) => {
      if (!url.includes("itunes")) return EMPTY;
      return url.includes("Hello") ? itunesHit("Hello", "Adele") : itunesHit("Someone Like You", "Adele");
    });

    const first = await lookupArtwork("Adele", "Hello");
    const second = await lookupArtwork("Adele", "Someone Like You");

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("ne déclenche qu'une recherche pour plusieurs demandes simultanées", async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      await gate;
      return itunesHit("Hello", "Adele");
    });

    const pending = Promise.all([
      lookupArtwork("Adele", "Hello"),
      lookupArtwork("adele", "HELLO"),
      lookupArtwork("Adele", "Hello (Lyrics)"),
    ]);
    open();
    const results = await pending;

    expect(calls).toHaveLength(1);
    expect(results.every((r) => r.url === results[0].url && r.url)).toBe(true);
  });

  it("ne fait aucun appel réseau sans titre exploitable", async () => {
    const calls = mockNetwork(() => EMPTY);
    const result = await lookupArtwork("Artiste", "   ");
    expect(result).toEqual({ url: null, source: "none", cached: false });
    expect(calls).toHaveLength(0);
  });
});
