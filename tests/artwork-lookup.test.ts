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
  reserveSlot,
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

/** Appels réseau vers une source donnée (les sources partent en parallèle). */
const callsTo = (calls: string[], host: string) => calls.filter((u) => u.includes(host));

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
    // iTunes est interrogé en premier ; les autres sources partent en même temps.
    expect(calls[0]).toContain("itunes");
    expect(calls[0]).toContain("Daft%20Punk%20Instant%20Crush");
    expect(callsTo(calls, "itunes")).toHaveLength(1);
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
    expect(callsTo(calls, "itunes").length).toBeGreaterThan(0);
    expect(callsTo(calls, "deezer").length).toBeGreaterThan(0);
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
    expect(callsTo(calls, "itunes")).toHaveLength(2);
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

    // Une seule recherche, donc un seul appel par source (pas trois).
    expect(callsTo(calls, "itunes")).toHaveLength(1);
    expect(callsTo(calls, "audius")).toHaveLength(1);
    expect(results.every((r) => r.url === results[0].url && r.url)).toBe(true);
  });

  it("ne fait aucun appel réseau sans titre exploitable", async () => {
    const calls = mockNetwork(() => EMPTY);
    const result = await lookupArtwork("Artiste", "   ");
    expect(result).toEqual({ url: null, source: "none", cached: false });
    expect(calls).toHaveLength(0);
  });
});


// --- Nouvelles sources -----------------------------------------------------

const audiusHit = (title: string, artist: string) =>
  json({
    data: [
      {
        title,
        user: { name: artist },
        artwork: { "150x150": "https://audius.test/150.jpg", "480x480": "https://audius.test/480.jpg" },
      },
    ],
  });

const listenbrainzHit = (title: string, artist: string, releaseMbid = "rel-1") =>
  json({ recording_name: title, artist_credit_name: artist, release_mbid: releaseMbid });

describe("sources supplémentaires", () => {
  beforeEach(() => __clearArtworkCache());
  afterEach(() => vi.unstubAllGlobals());

  it("trouve une pochette sur Audius (musique indé absente des catalogues commerciaux)", async () => {
    const calls = mockNetwork((url) =>
      url.includes("audius") ? audiusHit("Night Drive", "Indie Producer") : EMPTY
    );

    const result = await lookupArtwork("Indie Producer", "Night Drive");

    expect(result).toEqual({ url: "https://audius.test/480.jpg", source: "audius", cached: false });
    expect(callsTo(calls, "audius")[0]).toContain("app_name=Batlay");
  });

  it("rejette un faux positif Audius (mauvais artiste)", async () => {
    mockNetwork((url) => (url.includes("audius") ? audiusHit("Hello", "Random Uploader") : EMPTY));
    const result = await lookupArtwork("Adele", "Hello");
    expect(result.url).toBeNull();
  });

  it("trouve une pochette via ListenBrainz + Cover Art Archive", async () => {
    const calls = mockNetwork((url) => {
      if (url.includes("listenbrainz")) return listenbrainzHit("Obscure Track", "Petit Label");
      if (url.startsWith("https://coverartarchive.org/release/")) return { ok: true }; // HEAD
      return EMPTY;
    });

    const result = await lookupArtwork("Petit Label", "Obscure Track");

    expect(result.source).toBe("listenbrainz");
    expect(result.url).toBe("https://coverartarchive.org/release/rel-1/front-500");
    expect(callsTo(calls, "listenbrainz")[0]).toContain("artist_name=Petit%20Label");
  });

  it("ListenBrainz : pas de pochette déposée sur la sortie => pas de résultat", async () => {
    mockNetwork((url) => {
      if (url.includes("listenbrainz")) return listenbrainzHit("Obscure Track", "Petit Label");
      if (url.startsWith("https://coverartarchive.org/")) return { ok: false, status: 404 };
      return EMPTY;
    });
    expect((await lookupArtwork("Petit Label", "Obscure Track")).url).toBeNull();
  });

  it("ListenBrainz n'est pas interrogé sans artiste (l'API l'exige)", async () => {
    const calls = mockNetwork(() => EMPTY);
    await lookupArtwork("", "Morceau Sans Artiste");
    expect(callsTo(calls, "listenbrainz")).toHaveLength(0);
  });

  it("Cover Art Archive : essaie les autres groupes de sorties quand le premier n'a pas de pochette", async () => {
    mockNetwork((url) => {
      if (url.includes("musicbrainz")) {
        return json({
          recordings: [
            {
              title: "Obscure Track",
              "artist-credit": [{ name: "Petit Label" }],
              releases: [
                { "release-group": { id: "compil-sans-pochette" } },
                { "release-group": { id: "album-avec-pochette" } },
              ],
            },
          ],
        });
      }
      if (url.includes("compil-sans-pochette")) return { ok: false, status: 404 };
      if (url.includes("album-avec-pochette")) return { ok: true };
      return EMPTY;
    });

    const result = await lookupArtwork("Petit Label", "Obscure Track");

    expect(result.source).toBe("coverartarchive");
    expect(result.url).toBe("https://coverartarchive.org/release-group/album-avec-pochette/front-500");
  });

  it("Deezer : retombe sur la recherche libre quand la recherche stricte ne donne rien", async () => {
    const calls = mockNetwork((url) => {
      if (!url.includes("deezer")) return EMPTY;
      // La requête stricte contient artist:"..." (encodé %3A) ; la libre non.
      return url.includes("artist%3A") ? json({ data: [] }) : deezerHit("Formidable", "Stromae");
    });

    const result = await lookupArtwork("Stromae", "Formidable");

    expect(result.source).toBe("deezer");
    const deezerCalls = callsTo(calls, "deezer");
    expect(deezerCalls).toHaveLength(2);
    expect(deezerCalls[0]).toContain("artist%3A");
    expect(deezerCalls[1]).toContain("q=Stromae%20Formidable");
  });
});

// --- Parallélisme ----------------------------------------------------------

describe("recherche en parallèle", () => {
  beforeEach(() => __clearArtworkCache());
  afterEach(() => vi.unstubAllGlobals());

  /** Réponse qui n'arrive qu'après `ms`, ou jamais si la requête est annulée. */
  const after = (ms: number, response: unknown, signal?: AbortSignal) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(response), ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      });
    });

  it("lance toutes les sources sans attendre la plus lente, et renvoie dès qu'une répond", async () => {
    const calls: string[] = [];
    let itunesSignal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (url: string, init?: { signal?: AbortSignal }) => {
      calls.push(url);
      if (url.includes("itunes")) {
        itunesSignal = init?.signal;
        return after(3000, EMPTY, init?.signal); // iTunes traîne
      }
      if (url.includes("deezer")) return deezerHit("Formidable", "Stromae");
      return EMPTY;
    });

    const started = Date.now();
    const result = await lookupArtwork("Stromae", "Formidable");
    const elapsed = Date.now() - started;

    expect(result.source).toBe("deezer");
    // Deezer + délai de préférence, très loin des 3 s d'iTunes.
    expect(elapsed).toBeLessThan(1200);
    // Toutes les sources ont été sollicitées, sans attendre les précédentes.
    for (const host of ["itunes", "deezer", "listenbrainz", "musicbrainz", "audius"]) {
      expect(callsTo(calls, host).length, host).toBeGreaterThan(0);
    }
    // La requête iTunes encore en vol est annulée, pas seulement ignorée.
    expect(itunesSignal?.aborted).toBe(true);
  });

  it("garde l'ordre de préférence quand deux sources répondent presque ensemble", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (url.includes("itunes")) return after(80, itunesHit("Formidable", "Stromae"));
      if (url.includes("deezer")) return deezerHit("Formidable", "Stromae"); // plus rapide
      return EMPTY;
    });

    const result = await lookupArtwork("Stromae", "Formidable");

    expect(result.source).toBe("itunes");
  });

  it("ne bloque pas sur une source en panne : les autres répondent", async () => {
    mockNetwork((url) => {
      if (url.includes("itunes") || url.includes("deezer")) throw new Error("ENOTFOUND");
      if (url.includes("audius")) return audiusHit("Night Drive", "Indie Producer");
      return EMPTY;
    });
    const result = await lookupArtwork("Indie Producer", "Night Drive");
    expect(result.source).toBe("audius");
  });
});

// --- Durée de mise en cache des échecs -------------------------------------

describe("durée de mise en cache d'un échec", () => {
  const realNow = Date.now.bind(Date);
  beforeEach(() => __clearArtworkCache());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const minutesLater = (min: number) =>
    vi.spyOn(Date, "now").mockReturnValue(realNow() + min * 60_000);

  it("toutes les sources répondent « inconnu » (404 compris) : échec définitif, mis en cache longtemps", async () => {
    mockNetwork((url) =>
      url.includes("listenbrainz") || url.includes("audius") ? { ok: false, status: 404 } : EMPTY
    );
    await lookupArtwork("Moi", "Enregistrement Perso");

    minutesLater(120);
    expect((await lookupArtwork("Moi", "Enregistrement Perso")).cached).toBe(true);
  });

  it("une source n'a pas répondu : échec partiel, réessayé après ~30 min", async () => {
    mockNetwork((url) => {
      if (url.includes("audius")) throw new Error("panne Audius");
      return EMPTY;
    });
    await lookupArtwork("Moi", "Enregistrement Perso");

    minutesLater(10);
    expect((await lookupArtwork("Moi", "Enregistrement Perso")).cached).toBe(true);
    vi.restoreAllMocks();
    minutesLater(40);
    expect((await lookupArtwork("Moi", "Enregistrement Perso")).cached).toBe(false);
  });

  it("aucune source n'a répondu (réseau coupé) : échec transitoire, réessayé après 90 s", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("réseau indisponible")));
    await lookupArtwork("Moi", "Enregistrement Perso");

    minutesLater(3);
    expect((await lookupArtwork("Moi", "Enregistrement Perso")).cached).toBe(false);
  });
});

describe("limitation de débit (créneaux)", () => {
  it("deux appelants simultanés n'obtiennent jamais le même créneau", () => {
    const gate = { next: 0 };
    expect(reserveSlot(gate, 1100, 10_000)).toBe(0);
    expect(reserveSlot(gate, 1100, 10_000)).toBe(1100);
    expect(reserveSlot(gate, 1100, 10_000)).toBe(2200);
    // Après une pause, le débit repart de zéro.
    expect(reserveSlot(gate, 1100, 20_000)).toBe(0);
  });
});
