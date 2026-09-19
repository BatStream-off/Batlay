/**
 * Recherche de pochette à partir de (artiste + titre), sans aucune clé d'API.
 *
 * Pourquoi ce service existe
 * --------------------------
 * Les contrôles multimédias Windows (SMTC) n'exposent pas toujours de
 * vignette : VLC et la plupart des lecteurs locaux n'en fournissent aucune,
 * les navigateurs seulement par intermittence. On complète donc la détection
 * existante par une recherche en ligne — utilisée UNIQUEMENT quand le lecteur
 * n'a rien donné (voir src/services/system-media-provider.ts).
 *
 * Le vrai problème n'est pas la recherche, ce sont les métadonnées
 * -----------------------------------------------------------------
 * Ce que Windows remonte est souvent inexploitable tel quel :
 *   artiste "Unknown Artist", "YouTube", "VLC media player", ou vide ;
 *   artiste "Daft Punk - Topic", "EdSheeranVEVO" ;
 *   artiste "Drake feat. Rihanna" là où le catalogue dit juste "Drake" ;
 *   titre  "03 - Instant Crush (Official Video) - YouTube.mp3" ;
 *   titre  "Daft Punk - Instant Crush" avec un champ artiste vide.
 * D'où l'étage de normalisation ci-dessous, qui produit plusieurs
 * *candidats* de recherche, du plus précis au plus permissif.
 *
 * Sources interrogées, dans cet ordre déterministe
 * ------------------------------------------------
 * 1. iTunes Search API (itunes.apple.com) — sans clé, très rapide, large
 *    couverture, URL de pochette redimensionnable (100x100 -> 600x600).
 *    ~20 appels/min par IP ; Apple demande explicitement de mettre en cache.
 * 2. Deezer API publique (api.deezer.com) — sans clé, ~50 req/5s, meilleure
 *    couverture du catalogue européen/francophone et des sorties indé.
 * 3. MusicBrainz + Cover Art Archive — sans clé, exige un User-Agent
 *    identifiant et 1 requête/seconde. Lent, donc en dernier recours, mais
 *    c'est la seule source ouverte qui couvre le catalogue non commercial
 *    (classique, metal obscur, netlabels, autoproductions).
 *
 * Garanties
 * ---------
 * - Aucune exception ne remonte : `lookupArtwork` renvoie toujours
 *   `{ url, source, cached }`, avec `url: null` quand rien n'est trouvé.
 * - Une coupure Internet n'est jamais fatale et n'est PAS mise en cache
 *   comme un échec définitif (on retente quand la connexion revient).
 * - Chaque résultat est vérifié contre ce qui a été cherché avant d'être
 *   accepté : une pochette fausse est pire que pas de pochette du tout.
 */

import { app } from "electron";
import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const ITUNES_ENDPOINT = "https://itunes.apple.com/search";
const DEEZER_ENDPOINT = "https://api.deezer.com/search";
const MUSICBRAINZ_ENDPOINT = "https://musicbrainz.org/ws/2/recording";
const COVERART_ENDPOINT = "https://coverartarchive.org";

/** MusicBrainz exige un User-Agent identifiant l'application. */
const USER_AGENT = "Batlay/0.1 (overlay musical pour OBS)";

/**
 * Timeout court et par source : une pochette qui met plus de 3,5 s à
 * arriver est déjà en retard à l'antenne. Mieux vaut laisser une autre
 * source répondre que d'attendre celle qui traîne.
 */
const REQUEST_TIMEOUT_MS = 3500;
/**
 * Avance laissée à iTunes avant de lancer Deezer en renfort. Assez court
 * pour ne pas se voir à l'antenne, assez long pour qu'une réponse iTunes
 * normale (~150-400 ms) évite complètement la requête Deezer.
 */
const HEDGE_DELAY_MS = 600;
/** Budget total d'une recherche, toutes sources confondues. Au-delà, on abandonne proprement. */
const LOOKUP_DEADLINE_MS = 12_000;

/** Un morceau retrouvé est mis en cache 30 jours : une pochette ne change pas. */
const HIT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Échec DÉFINITIF (toutes les sources ont répondu, aucune ne connaît le
 * morceau) : 7 jours. Typiquement une musique perso, un mix, un live non
 * catalogué. Inutile de redemander toutes les 2 secondes.
 */
const DEFINITIVE_MISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Échec TRANSITOIRE (réseau coupé, timeout, quota) : 90 secondes. Assez pour
 * ne pas marteler les APIs pendant une coupure, assez court pour que la
 * pochette apparaisse peu après le retour de la connexion.
 */
const TRANSIENT_MISS_TTL_MS = 90 * 1000;

const MAX_ENTRIES = 1000;

/** Garde-fous de débit, pour rester bon citoyen même en cas de zapping intensif. */
const ITUNES_MAX_CALLS_PER_MIN = 15;
const DEEZER_MIN_INTERVAL_MS = 200;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1100; // MusicBrainz impose 1 req/s

/** Seuils de vérification du résultat (voir isPlausibleMatch). */
const TITLE_SIMILARITY_THRESHOLD = 0.6;
const ARTIST_SIMILARITY_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export type ArtworkSource = "itunes" | "deezer" | "coverartarchive" | "none";

export interface ArtworkLookupResult {
  url: string | null;
  source: ArtworkSource;
  /** true si la réponse vient du cache (aucun appel réseau n'a été fait). */
  cached: boolean;
}

/** Métadonnées nettoyées, exportées pour les tests et le diagnostic. */
export interface NormalizedMetadata {
  /** Artiste sans featuring ("Drake feat. Rihanna" -> "Drake"). */
  artist: string;
  /** Artiste complet, featurings conservés. */
  artistFull: string;
  /** Artiste réduit au tout premier nom (coupe aussi sur "&", ","...). Dernier recours. */
  artistPrimary: string;
  /** Titre nettoyé, featurings conservés. */
  title: string;
  /** Titre sans featuring. */
  titleCore: string;
  /** true si Windows n'a remonté aucun artiste exploitable. */
  artistWasPlaceholder: boolean;
}

/** Un couple (artiste, titre) à soumettre aux sources. */
export interface QueryCandidate {
  artist: string;
  title: string;
}

interface CacheEntry {
  url: string | null;
  source: ArtworkSource;
  expiresAt: number;
}

/** Résultat brut d'une source, avant vérification. */
interface SourceMatch {
  url: string;
  artist: string;
  title: string;
}

/** Issue d'un appel réseau : distingue "a répondu, rien trouvé" de "n'a pas répondu". */
type FetchOutcome = { ok: true; data: unknown } | { ok: false };

// ---------------------------------------------------------------------------
// État module
// ---------------------------------------------------------------------------

const cache = new Map<string, CacheEntry>();
/** Déduplication : N demandes simultanées pour le même morceau = 1 seule recherche. */
const inFlight = new Map<string, Promise<ArtworkLookupResult>>();

const itunesCallTimestamps: number[] = [];
let lastDeezerCall = 0;
let lastMusicBrainzCall = 0;

let persistPath: string | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let loaded = false;

// ---------------------------------------------------------------------------
// Nettoyage du texte
// ---------------------------------------------------------------------------

/**
 * Remet d'aplomb une chaîne venue de Windows : caractères invisibles,
 * apostrophes et tirets typographiques, underscores de noms de fichiers,
 * espaces multiples.
 */
export function tidy(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFC")
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, "") // caractères de largeur nulle
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-") // tirets typographiques -> "-"
    .replace(/_+/g, " ") // "Daft_Punk_Instant_Crush" -> espaces
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Valeurs que les lecteurs mettent dans le champ "artiste" faute de mieux.
 * Les traiter comme un artiste réel garantit zéro résultat.
 */
const PLACEHOLDER_ARTISTS = new Set([
  "",
  "-",
  "--",
  "?",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "unknown",
  "unknown artist",
  "artiste inconnu",
  "inconnu",
  "various",
  "various artists",
  "va",
  "artistes divers",
  "compilation",
  "youtube",
  "youtube music",
  "soundcloud",
  "spotify",
  "deezer",
  "vlc",
  "vlc media player",
  "windows media player",
  "groove music",
  "media player",
  "chrome",
  "google chrome",
  "firefox",
  "mozilla firefox",
  "microsoft edge",
  "edge",
  "opera",
  "brave",
  "topic",
  "audio",
  "music",
  "musique",
  "track",
  "title",
  "song",
  "sound",
  "stream",
  "podcast",
  "radio",
  "playlist",
]);

export function isPlaceholderArtist(artist: string): boolean {
  const v = tidy(artist).toLowerCase().replace(/\.(exe|app)$/, "");
  if (!v) return true;
  if (PLACEHOLDER_ARTISTS.has(v)) return true;
  // "Artiste" purement numérique ou fait de ponctuation : inexploitable.
  if (/^[\d\W]+$/.test(v)) return true;
  return false;
}

/**
 * Mentions ajoutées par les plateformes vidéo, qui n'existent pas au
 * catalogue et font échouer toute recherche si on les laisse.
 */
const NOISE_PATTERN =
  /\b(official|officiel|officielle|video|vidéo|audio|lyrics?|paroles|visualizer|visualiser|mv|hd|hq|sd|4k|8k|1080p|720p|remaster(ed)?|remasterisé|explicit|clean|clip|music\s*video|full\s*album|color\s*coded|legendado|topic)\b/i;

/**
 * Supprime (...) et [...] UNIQUEMENT s'ils contiennent du bruit.
 * "(Acoustic)", "(Live at Wembley)", "(Remix)" sont conservés : ce sont de
 * vraies versions distinctes, et les retirer ramènerait la mauvaise pochette.
 */
function stripNoiseBrackets(value: string): string {
  return value
    .replace(/[([{]([^)\]}]*)[)\]}]/g, (match, inner: string) =>
      NOISE_PATTERN.test(inner) ? " " : match
    )
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Séparateurs de featuring : sûrs à couper, aucun nom de groupe ne les utilise. */
const FEAT_SPLIT = /\s*(?:[([{]\s*)?\b(?:feat|feats|featuring|ft)\b\.?\s+/i;
/** Séparateurs multi-artistes : risqués ("Simon & Garfunkel", "Earth, Wind & Fire"). */
const MULTI_ARTIST_SPLIT = /\s*(?:,|&|\+|;|\/|\bvs\.?\b|\bx\b|\bwith\b|\bavec\b)\s+/i;

export function cleanArtist(artist: string): string {
  return tidy(artist)
    .replace(/\s*-\s*Topic\s*$/i, "") // chaînes auto-générées YouTube
    .replace(/VEVO\b/gi, "") // "EdSheeranVEVO" -> "EdSheeran"
    .replace(/\s*-\s*(Official|Officiel)(\s+(Channel|Chaîne|Music))?\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-,&]+|[\s\-,&]+$/g, "")
    .trim();
}

export function cleanTitle(title: string): string {
  return stripNoiseBrackets(
    tidy(title)
      .replace(/\.(mp3|flac|m4a|aac|wav|ogg|opus|wma|aiff?|alac)$/i, "") // noms de fichiers
      .replace(/^\s*\d{1,3}\s*[-.)]\s+/, "") // "03 - Titre", "07. Titre"
      .replace(/^\s*(?:track|piste)\s*\d{1,3}\s*[-.)]?\s*/i, "")
      .replace(/\s*-\s*(YouTube(\s+Music)?|SoundCloud|Spotify|Deezer|Bandcamp)\s*$/i, "")
      .replace(/\s*[|·•]\s*[^|·•]*$/, "") // "Titre | Nom de la chaîne"
  )
    .replace(/\s*-\s*(official|officiel)[^-]*$/i, "") // "Titre - Official Video"
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-,]+|[\s\-,]+$/g, "")
    .trim();
}

/** Retire "(feat. X)", "feat. X", "ft X" d'un titre. */
function stripFeat(value: string): string {
  return value
    .replace(/\s*[([{]\s*(?:feat|feats|featuring|ft|avec|with)\b\.?[^)\]}]*[)\]}]/gi, "")
    .replace(/\s*-?\s*\b(?:feat|feats|featuring|ft)\b\.?\s+.*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Beaucoup de lecteurs (navigateurs, VLC sur un fichier mal taggé) mettent
 * "Artiste - Titre" dans le champ titre et rien d'exploitable dans l'artiste.
 * On récupère l'artiste depuis le titre dans ce cas précis uniquement.
 */
function splitArtistFromTitle(title: string): { artist: string; title: string } | null {
  const match = title.match(/^(.{2,60}?)\s+-\s+(.{2,})$/);
  if (!match) return null;
  const [, left, right] = match;
  if (!left.trim() || !right.trim()) return null;
  return { artist: left.trim(), title: right.trim() };
}

/**
 * Point d'entrée de la normalisation : transforme ce que Windows remonte en
 * métadonnées exploitables. Exporté pour être testé directement.
 */
export function normalizeMetadata(rawArtist: string, rawTitle: string): NormalizedMetadata {
  let artistFull = cleanArtist(rawArtist);
  let title = cleanTitle(rawTitle);
  let artistWasPlaceholder = isPlaceholderArtist(artistFull);

  // Artiste inexploitable + titre de la forme "Artiste - Titre" : on récupère
  // l'artiste depuis le titre.
  if (artistWasPlaceholder) {
    const split = splitArtistFromTitle(title);
    if (split && !isPlaceholderArtist(split.artist)) {
      artistFull = cleanArtist(split.artist);
      title = cleanTitle(split.title);
      artistWasPlaceholder = false;
    } else {
      artistFull = "";
    }
  }

  const artist = artistFull ? tidy(artistFull.split(FEAT_SPLIT)[0]) : "";
  const artistPrimary = artist ? tidy(artist.split(MULTI_ARTIST_SPLIT)[0]) : "";

  return {
    artist: artist || artistFull,
    artistFull,
    artistPrimary: artistPrimary || artist || artistFull,
    title,
    titleCore: stripFeat(title) || title,
    artistWasPlaceholder,
  };
}

/**
 * Candidats de recherche, du plus précis au plus permissif.
 * L'ordre est déterministe : à métadonnées identiques, même séquence d'appels.
 */
export function buildQueryCandidates(meta: NormalizedMetadata): QueryCandidate[] {
  const candidates: QueryCandidate[] = [];
  const seen = new Set<string>();

  const add = (artist: string, title: string) => {
    if (!title) return;
    const key = `${artist.toLowerCase()}|${title.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push({ artist, title });
  };

  // 1. artiste sans featuring + titre sans featuring : le plus fiable.
  add(meta.artist, meta.titleCore);
  // 2. le featuring fait parfois partie du titre officiel.
  add(meta.artist, meta.title);
  // 3. certains morceaux sont crédités au duo complet.
  add(meta.artistFull, meta.titleCore);
  // 4. dernier recours sur l'artiste : "Artiste1 & Artiste2" -> "Artiste1".
  //    Risqué (couperait aussi "Simon & Garfunkel"), donc jamais en premier.
  add(meta.artistPrimary, meta.titleCore);
  // 5. aucun artiste exploitable : titre seul. La vérification du résultat
  //    (isPlausibleMatch) est ce qui empêche le faux positif ici.
  if (!meta.artist) add("", meta.titleCore);

  return candidates;
}

// ---------------------------------------------------------------------------
// Vérification du résultat (anti faux positif)
// ---------------------------------------------------------------------------

/** Forme comparable : minuscules, sans accents, sans ponctuation. */
function comparable(value: string): string {
  return tidy(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Coefficient de Dice sur les bigrammes — tolérant aux fautes et variantes. */
export function similarity(a: string, b: string): number {
  const x = comparable(a);
  const y = comparable(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let i = 0; i < x.length - 1; i++) {
    const g = x.slice(i, i + 2);
    bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
  }
  let hits = 0;
  for (let i = 0; i < y.length - 1; i++) {
    const g = y.slice(i, i + 2);
    const count = bigrams.get(g) ?? 0;
    if (count > 0) {
      bigrams.set(g, count - 1);
      hits++;
    }
  }
  return (2 * hits) / (x.length - 1 + (y.length - 1));
}

function looseIncludes(a: string, b: string): boolean {
  const x = comparable(a);
  const y = comparable(b);
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
}

/**
 * Une pochette fausse est plus gênante à l'antenne que pas de pochette.
 * On n'accepte donc un résultat que s'il ressemble vraiment à ce qui a été
 * demandé — c'est ce qui permet d'autoriser les candidats permissifs plus haut.
 */
export function isPlausibleMatch(candidate: QueryCandidate, match: SourceMatch): boolean {
  const titleOk =
    similarity(candidate.title, match.title) >= TITLE_SIMILARITY_THRESHOLD ||
    looseIncludes(candidate.title, match.title);
  if (!titleOk) return false;

  // Pas d'artiste des deux côtés : le titre seul décide (seuil déjà appliqué).
  if (!candidate.artist || !match.artist) return true;

  return (
    similarity(candidate.artist, match.artist) >= ARTIST_SIMILARITY_THRESHOLD ||
    looseIncludes(candidate.artist, match.artist)
  );
}

// ---------------------------------------------------------------------------
// Réseau
// ---------------------------------------------------------------------------

async function fetchJson(url: string): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    if (!res.ok) return { ok: false };
    // iTunes renvoie parfois text/javascript : on parse le texte nous-mêmes.
    const text = await res.text();
    return { ok: true, data: JSON.parse(text) };
  } catch {
    // Réseau coupé, timeout, DNS, JSON invalide : échec TRANSITOIRE.
    // La pochette est un bonus visuel, jamais un bloquant.
    return { ok: false };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function itunesRateLimitOk(): boolean {
  const now = Date.now();
  while (itunesCallTimestamps.length && now - itunesCallTimestamps[0] > 60_000) {
    itunesCallTimestamps.shift();
  }
  return itunesCallTimestamps.length < ITUNES_MAX_CALLS_PER_MIN;
}

/** iTunes renvoie une vignette 100x100 ; l'URL est redimensionnable par substitution. */
export function upscaleItunesArtwork(url: string, size = 600): string {
  return url.replace(/\/\d+x\d+bb\.(jpg|png)$/i, `/${size}x${size}bb.$1`);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

interface SourceAttempt {
  /** Résultat retenu, ou null si la source a répondu sans rien de convaincant. */
  match: SourceMatch | null;
  /** true si la source n'a pas répondu (réseau/timeout/quota) : échec transitoire. */
  failed: boolean;
}

async function searchItunes(candidate: QueryCandidate): Promise<SourceAttempt> {
  if (!itunesRateLimitOk()) return { match: null, failed: true };
  itunesCallTimestamps.push(Date.now());

  const term = `${candidate.artist} ${candidate.title}`.trim();
  const url = `${ITUNES_ENDPOINT}?term=${encodeURIComponent(term)}&entity=song&media=music&limit=5`;
  const outcome = await fetchJson(url);
  if (!outcome.ok) return { match: null, failed: true };

  const results =
    (
      outcome.data as {
        results?: { artworkUrl100?: string; trackName?: string; artistName?: string }[];
      }
    )?.results ?? [];

  for (const item of results) {
    if (!item.artworkUrl100) continue;
    const match: SourceMatch = {
      url: upscaleItunesArtwork(item.artworkUrl100),
      artist: item.artistName ?? "",
      title: item.trackName ?? "",
    };
    if (isPlausibleMatch(candidate, match)) return { match, failed: false };
  }
  return { match: null, failed: false };
}

async function searchDeezer(candidate: QueryCandidate): Promise<SourceAttempt> {
  const since = Date.now() - lastDeezerCall;
  if (since < DEEZER_MIN_INTERVAL_MS) await sleep(DEEZER_MIN_INTERVAL_MS - since);
  lastDeezerCall = Date.now();

  // La syntaxe `artist:"..." track:"..."` est nettement plus précise qu'une
  // recherche libre. Sans artiste, on retombe sur la recherche libre.
  const query = candidate.artist
    ? `artist:"${candidate.artist}" track:"${candidate.title}"`
    : candidate.title;
  const url = `${DEEZER_ENDPOINT}?q=${encodeURIComponent(query)}&limit=5`;
  const outcome = await fetchJson(url);
  if (!outcome.ok) return { match: null, failed: true };

  const results =
    (
      outcome.data as {
        data?: {
          title?: string;
          artist?: { name?: string };
          album?: { cover_xl?: string; cover_big?: string; cover_medium?: string };
        }[];
      }
    )?.data ?? [];

  for (const item of results) {
    const cover = item.album?.cover_xl ?? item.album?.cover_big ?? item.album?.cover_medium;
    if (!cover) continue;
    const match: SourceMatch = {
      url: cover,
      artist: item.artist?.name ?? "",
      title: item.title ?? "",
    };
    if (isPlausibleMatch(candidate, match)) return { match, failed: false };
  }
  return { match: null, failed: false };
}

/**
 * MusicBrainz (métadonnées) + Cover Art Archive (image). Deux requêtes et
 * 1 req/s imposée, d'où le dernier rang — mais c'est la seule source ouverte
 * qui couvre le catalogue non commercial.
 */
async function searchCoverArtArchive(candidate: QueryCandidate): Promise<SourceAttempt> {
  const since = Date.now() - lastMusicBrainzCall;
  if (since < MUSICBRAINZ_MIN_INTERVAL_MS) await sleep(MUSICBRAINZ_MIN_INTERVAL_MS - since);
  lastMusicBrainzCall = Date.now();

  const escape = (v: string) => v.replace(/["\\]/g, " ").trim();
  const clauses = [`recording:"${escape(candidate.title)}"`];
  if (candidate.artist) clauses.push(`artist:"${escape(candidate.artist)}"`);

  const url = `${MUSICBRAINZ_ENDPOINT}?query=${encodeURIComponent(
    clauses.join(" AND ")
  )}&limit=5&fmt=json`;
  const outcome = await fetchJson(url);
  if (!outcome.ok) return { match: null, failed: true };

  const recordings =
    (
      outcome.data as {
        recordings?: {
          title?: string;
          "artist-credit"?: { name?: string }[];
          releases?: { id?: string; "release-group"?: { id?: string } }[];
        }[];
      }
    )?.recordings ?? [];

  for (const rec of recordings) {
    const artist = (rec["artist-credit"] ?? [])
      .map((c) => c.name ?? "")
      .join(" ")
      .trim();
    const probe: SourceMatch = { url: "", artist, title: rec.title ?? "" };
    if (!isPlausibleMatch(candidate, probe)) continue;

    const groupId = rec.releases?.find((r) => r["release-group"]?.id)?.["release-group"]?.id;
    if (!groupId) continue;

    // Cover Art Archive renvoie 404 quand aucune pochette n'a été déposée :
    // on vérifie avant de renvoyer une URL qui casserait l'image dans OBS.
    const coverUrl = `${COVERART_ENDPOINT}/release-group/${groupId}/front-500`;
    try {
      const head = await fetch(coverUrl, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: { "User-Agent": USER_AGENT },
      });
      if (head.ok) return { match: { ...probe, url: coverUrl }, failed: false };
    } catch {
      return { match: null, failed: true };
    }
  }
  return { match: null, failed: false };
}

/** Ordre d'interrogation. Déterministe, documenté en tête de fichier. */
const SOURCES: {
  id: Exclude<ArtworkSource, "none">;
  search: (c: QueryCandidate) => Promise<SourceAttempt>;
}[] = [
  { id: "itunes", search: searchItunes },
  { id: "deezer", search: searchDeezer },
  { id: "coverartarchive", search: searchCoverArtArchive },
];

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

interface ResolveResult {
  url: string | null;
  source: ArtworkSource;
  /**
   * true quand toutes les sources ont bien répondu sans connaître le morceau.
   * false quand au moins une n'a pas pu être interrogée (réseau, timeout) :
   * dans ce cas l'échec ne doit pas être mis en cache longtemps.
   */
  definitive: boolean;
}

/**
 * Interroge une source sur ses candidats, du plus précis au plus permissif,
 * et s'arrête au premier résultat jugé fiable.
 */
async function trySource(
  source: (typeof SOURCES)[number],
  candidates: QueryCandidate[],
  deadline: number
): Promise<{ url: string | null; source: ArtworkSource; failed: boolean }> {
  for (const candidate of candidates) {
    if (Date.now() >= deadline) return { url: null, source: "none", failed: true };
    const attempt = await source.search(candidate);
    if (attempt.match) return { url: attempt.match.url, source: source.id, failed: false };
    // Source injoignable : inutile d'essayer ses autres candidats.
    if (attempt.failed) return { url: null, source: "none", failed: true };
  }
  return { url: null, source: "none", failed: false };
}

async function resolve(rawArtist: string, rawTitle: string): Promise<ResolveResult> {
  const meta = normalizeMetadata(rawArtist, rawTitle);
  if (!meta.title) return { url: null, source: "none", definitive: true };

  const candidates = buildQueryCandidates(meta);
  const deadline = Date.now() + LOOKUP_DEADLINE_MS;

  // --- Étage 1 : iTunes, puis Deezer en renfort ("hedged request") -------
  // Le parallélisme brut réduit bien la latence, mais lance systématiquement
  // une requête Deezer même quand iTunes répond en 200 ms — or iTunes suffit
  // dans la majorité des cas. On donne donc une avance à iTunes : Deezer
  // n'est lancé que si iTunes n'a pas encore répondu au bout de HEDGE_DELAY_MS.
  // Résultat : latence quasi parallèle quand iTunes traîne, et aucune requête
  // superflue quand il est rapide.
  const itunes = SOURCES.find((s) => s.id === "itunes")!;
  const deezer = SOURCES.find((s) => s.id === "deezer")!;

  const itunesRun = trySource(itunes, candidates, deadline);
  const winner = await Promise.race([
    itunesRun,
    sleep(HEDGE_DELAY_MS).then(() => null as null),
  ]);

  if (winner?.url) return { url: winner.url, source: winner.source, definitive: true };

  // Soit iTunes a répondu sans rien trouver, soit il traîne : dans les deux
  // cas Deezer part maintenant, et on garde le résultat d'iTunes s'il arrive.
  const [itunesResult, deezerResult] = await Promise.all([
    itunesRun,
    trySource(deezer, candidates, deadline),
  ]);

  // Ordre de préférence déterministe : iTunes l'emporte à égalité, quel que
  // soit l'ordre d'arrivée des réponses.
  for (const result of [itunesResult, deezerResult]) {
    if (result.url) return { url: result.url, source: result.source, definitive: true };
  }
  let anyFailure = itunesResult.failed || deezerResult.failed;

  // --- Étage 2 : Cover Art Archive, séquentiel ---------------------------
  // Volontairement pas dans la course : MusicBrainz impose 1 req/s et
  // demande deux allers-retours. On ne le paie que si les deux premières
  // n'ont rien donné.
  if (Date.now() < deadline) {
    const caa = SOURCES.find((s) => s.id === "coverartarchive");
    if (caa) {
      const result = await trySource(caa, candidates, deadline);
      if (result.url) return { url: result.url, source: result.source, definitive: true };
      anyFailure = anyFailure || result.failed;
    }
  } else {
    anyFailure = true;
  }

  return { url: null, source: "none", definitive: !anyFailure };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** Clé insensible à la casse, aux accents et à la ponctuation. */
function cacheKey(artist: string, title: string): string {
  return `${comparable(artist)}::${comparable(title)}`;
}

function getPersistPath(): string {
  const resolved = persistPath ?? path.join(app.getPath("userData"), "artwork-cache.json");
  persistPath = resolved;
  return resolved;
}

async function loadCache(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await readFile(getPersistPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (entry && typeof entry.expiresAt === "number" && entry.expiresAt > now) {
        cache.set(key, entry);
      }
    }
  } catch {
    // Premier lancement, fichier absent ou corrompu : on repart d'un cache vide.
    // Jamais bloquant — le cache est une optimisation, pas une dépendance.
  }
}

function schedulePersist(): void {
  if (persistTimer) return;
  // Écriture groupée : on n'écrit pas sur disque à chaque morceau.
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void writeFile(getPersistPath(), JSON.stringify(Object.fromEntries(cache)), "utf-8").catch(
      () => {
        /* échec d'écriture non bloquant */
      }
    );
  }, 10_000);
  // Ce timer ne doit jamais retarder la fermeture de Batlay.
  (persistTimer as unknown as { unref?: () => void }).unref?.();
}

function remember(key: string, result: ResolveResult): void {
  if (cache.size >= MAX_ENTRIES) {
    // Éviction FIFO : le cache est un confort, pas une base de données.
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  const ttl = result.url
    ? HIT_TTL_MS
    : result.definitive
      ? DEFINITIVE_MISS_TTL_MS
      : TRANSIENT_MISS_TTL_MS;

  cache.set(key, { url: result.url, source: result.source, expiresAt: Date.now() + ttl });
  schedulePersist();
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * (artiste, titre) -> URL de pochette.
 *
 * Renvoie TOUJOURS `{ url, source, cached }` et ne lève jamais d'exception :
 * l'absence de pochette ne doit jamais empêcher l'affichage du reste de
 * l'overlay. Appelé par le process principal via l'IPC "artwork:lookup".
 */
export async function lookupArtwork(artist: string, title: string): Promise<ArtworkLookupResult> {
  try {
    const meta = normalizeMetadata(artist ?? "", title ?? "");
    if (!meta.title) return { url: null, source: "none", cached: false };

    await loadCache();
    // La clé se base sur les métadonnées NORMALISÉES : "Daft Punk - Topic" et
    // "daft punk" retombent sur la même entrée de cache.
    const key = cacheKey(meta.artist, meta.titleCore);

    const hit = cache.get(key);
    if (hit && hit.expiresAt > Date.now()) {
      return { url: hit.url, source: hit.source, cached: true };
    }

    const pending = inFlight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const result = await resolve(artist ?? "", title ?? "");
        remember(key, result);
        return { url: result.url, source: result.source, cached: false };
      } catch {
        // Filet de sécurité : jamais d'exception vers l'IPC.
        return { url: null, source: "none" as ArtworkSource, cached: false };
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, promise);
    return promise;
  } catch {
    return { url: null, source: "none", cached: false };
  }
}

/** Utilisé par les tests. */
export function __clearArtworkCache(): void {
  cache.clear();
  inFlight.clear();
  itunesCallTimestamps.length = 0;
  lastDeezerCall = 0;
  lastMusicBrainzCall = 0;
  loaded = true; // évite de relire le disque pendant les tests
}
