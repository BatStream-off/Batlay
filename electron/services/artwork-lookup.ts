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
 * Sources interrogées EN PARALLÈLE
 * ---------------------------------
 * Toutes les sources partent en même temps ; le premier résultat jugé fiable
 * gagne et annule les requêtes encore en vol. Le temps de recherche est donc
 * celui de la source la plus rapide qui connaît le morceau, et non plus la
 * somme des sources traversées. Rang de préférence (il ne sert qu'à
 * départager deux réponses quasi simultanées) :
 *
 * 1. iTunes Search API (itunes.apple.com) — sans clé, très rapide, large
 *    couverture, URL de pochette redimensionnable (100x100 -> 600x600).
 *    ~20 appels/min par IP ; Apple demande explicitement de mettre en cache.
 * 2. Deezer API publique (api.deezer.com) — sans clé, ~50 req/5s, meilleure
 *    couverture du catalogue européen/francophone et des sorties indé.
 *    Recherche stricte, puis libre si la stricte ne donne rien.
 * 3. ListenBrainz (api.listenbrainz.org) + Cover Art Archive — sans clé,
 *    correspondance floue adossée à MusicBrainz, tolérante aux fautes et aux
 *    titres approximatifs, sans la limite de 1 req/s de MusicBrainz.
 * 4. MusicBrainz + Cover Art Archive — sans clé, exige un User-Agent
 *    identifiant et 1 requête/seconde. Seule source ouverte qui couvre le
 *    catalogue non commercial (classique, metal obscur, netlabels).
 * 5. Audius (api.audius.co) — sans clé, plateforme ouverte : musique
 *    indépendante et électronique absente des catalogues commerciaux.
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
const LISTENBRAINZ_ENDPOINT = "https://api.listenbrainz.org/1/metadata/lookup/";
const AUDIUS_ENDPOINT = "https://api.audius.co/v1/tracks/search";
/** Audius demande un `app_name` (identification, pas une clé). */
const AUDIUS_APP_NAME = "Batlay";

/** MusicBrainz exige un User-Agent identifiant l'application. */
const USER_AGENT = "Batlay/0.1 (overlay musical pour OBS)";

/**
 * Timeout court et par source : une pochette qui met plus de 3,5 s à
 * arriver est déjà en retard à l'antenne. Mieux vaut laisser une autre
 * source répondre que d'attendre celle qui traîne.
 */
const REQUEST_TIMEOUT_MS = 3500;
/**
 * Quand une source répond avant une source mieux classée (voir SOURCES), on
 * laisse ce délai à la mieux classée pour arriver. Court : c'est le prix
 * maximal payé pour des résultats stables d'un lancement à l'autre.
 */
const PREFERENCE_GRACE_MS = 250;
/**
 * Budget total d'une recherche, toutes sources confondues. Les sources étant
 * parallèles, ce plafond n'est atteint que si tout traîne.
 */
const LOOKUP_DEADLINE_MS = 8_000;

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
/**
 * Échec PARTIEL (certaines sources ont répondu « inconnu », d'autres n'ont pas
 * répondu) : 30 minutes. Plus on a de sources, plus il est probable que l'une
 * d'elles soit indisponible : on ne veut ni retenter à chaque tour, ni
 * condamner le morceau pour 7 jours sur la foi d'une enquête incomplète.
 */
const PARTIAL_MISS_TTL_MS = 30 * 60 * 1000;

const MAX_ENTRIES = 1000;

/** Garde-fous de débit, pour rester bon citoyen même en cas de zapping intensif. */
const ITUNES_MAX_CALLS_PER_MIN = 15;
const DEEZER_MIN_INTERVAL_MS = 200;
const MUSICBRAINZ_MIN_INTERVAL_MS = 1100; // MusicBrainz impose 1 req/s
/** Groupes de sorties testés en parallèle sur Cover Art Archive, par enregistrement. */
const MAX_RELEASE_GROUPS_PER_RECORDING = 4;

/** Seuils de vérification du résultat (voir isPlausibleMatch). */
const TITLE_SIMILARITY_THRESHOLD = 0.6;
const ARTIST_SIMILARITY_THRESHOLD = 0.45;

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export type ArtworkSource =
  | "itunes"
  | "deezer"
  | "listenbrainz"
  | "coverartarchive"
  | "audius"
  | "none";

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

/** Prochain créneau autorisé (ms epoch) d'une source limitée en débit. */
interface RateGate {
  next: number;
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
const deezerGate: RateGate = { next: 0 };
const musicBrainzGate: RateGate = { next: 0 };

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

/**
 * Signal d'une requête : timeout propre + annulation par le parent. Quand une
 * source a gagné la course, les requêtes des autres sont annulées pour de
 * bon (pas seulement ignorées) : moins de charge chez eux, et surtout aucun
 * créneau MusicBrainz gaspillé.
 */
function requestSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!parent) return timeout;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (parent.aborted || timeout.aborted) abort();
  parent.addEventListener("abort", abort, { once: true });
  timeout.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<FetchOutcome> {
  try {
    const res = await fetch(url, {
      signal: requestSignal(signal),
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
    // 404 = la source a répondu « je ne connais pas ça » (ListenBrainz, Audius…).
    // Ce n'est pas une panne : sinon chaque morceau inconnu serait traité
    // comme un échec transitoire et re-cherché sans fin.
    if (res.status === 404) return { ok: true, data: null };
    if (!res.ok) return { ok: false };
    // iTunes renvoie parfois text/javascript : on parse le texte nous-mêmes.
    const text = await res.text();
    return { ok: true, data: JSON.parse(text) };
  } catch {
    // Réseau coupé, timeout, annulation, DNS, JSON invalide : échec TRANSITOIRE.
    // La pochette est un bonus visuel, jamais un bloquant.
    return { ok: false };
  }
}

/** Attente interruptible : se termine tout de suite si le signal est annulé. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * Réserve le prochain créneau d'une source limitée en débit et renvoie le
 * délai à attendre (0 si libre). La réservation est synchrone : avec des
 * recherches parallèles, deux appelants ne peuvent pas obtenir le même
 * créneau (l'ancien « mesurer puis dormir » les laissait partir ensemble).
 */
export function reserveSlot(gate: RateGate, minIntervalMs: number, now = Date.now()): number {
  const at = Math.max(now, gate.next);
  gate.next = at + minIntervalMs;
  return at - now;
}

/** Attend son créneau. Renvoie false si la recherche a été annulée entre-temps. */
async function waitForSlot(
  gate: RateGate,
  minIntervalMs: number,
  signal: AbortSignal
): Promise<boolean> {
  const wait = reserveSlot(gate, minIntervalMs);
  if (wait > 0) await sleep(wait, signal);
  return !signal.aborted;
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

type CoverCheck = "ok" | "missing" | "error";

/**
 * Cover Art Archive renvoie 404 quand aucune pochette n'a été déposée : on
 * vérifie avant de renvoyer une URL qui casserait l'image dans OBS.
 */
async function checkCover(url: string, signal: AbortSignal): Promise<CoverCheck> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: requestSignal(signal),
      headers: { "User-Agent": USER_AGENT },
    });
    if (res.ok) return "ok";
    return res.status >= 500 || res.status === 429 ? "error" : "missing";
  } catch {
    return "error";
  }
}

/** Teste plusieurs URLs en parallèle et garde la première valide, dans l'ordre donné. */
async function firstReachableCover(
  urls: string[],
  signal: AbortSignal
): Promise<{ url: string | null; failed: boolean }> {
  const checks = await Promise.all(urls.map((u) => checkCover(u, signal)));
  const index = checks.indexOf("ok");
  if (index >= 0) return { url: urls[index], failed: false };
  return { url: null, failed: checks.includes("error") };
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

const NO_MATCH: SourceAttempt = { match: null, failed: false };
const FAILED: SourceAttempt = { match: null, failed: true };

async function searchItunes(candidate: QueryCandidate, signal: AbortSignal): Promise<SourceAttempt> {
  if (!itunesRateLimitOk()) return FAILED;
  itunesCallTimestamps.push(Date.now());

  const term = `${candidate.artist} ${candidate.title}`.trim();
  const url = `${ITUNES_ENDPOINT}?term=${encodeURIComponent(term)}&entity=song&media=music&limit=5`;
  const outcome = await fetchJson(url, signal);
  if (!outcome.ok) return FAILED;

  const results =
    (
      outcome.data as {
        results?: { artworkUrl100?: string; trackName?: string; artistName?: string }[];
      } | null
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
  return NO_MATCH;
}

async function searchDeezer(candidate: QueryCandidate, signal: AbortSignal): Promise<SourceAttempt> {
  // La syntaxe `artist:"..." track:"..."` est nettement plus précise qu'une
  // recherche libre, mais aussi très pointilleuse (ponctuation, « & »…) : si
  // elle ne donne rien de fiable, on retente en recherche libre. Sans
  // artiste, seule la recherche libre est possible.
  const bare = (v: string) => v.replace(/"/g, " ").trim();
  const queries = candidate.artist
    ? [
        `artist:"${bare(candidate.artist)}" track:"${bare(candidate.title)}"`,
        `${candidate.artist} ${candidate.title}`,
      ]
    : [candidate.title];

  for (const query of queries) {
    if (!(await waitForSlot(deezerGate, DEEZER_MIN_INTERVAL_MS, signal))) return FAILED;
    const outcome = await fetchJson(`${DEEZER_ENDPOINT}?q=${encodeURIComponent(query)}&limit=5`, signal);
    if (!outcome.ok) return FAILED;

    const results =
      (
        outcome.data as {
          data?: {
            title?: string;
            artist?: { name?: string };
            album?: { cover_xl?: string; cover_big?: string; cover_medium?: string };
          }[];
        } | null
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
  }
  return NO_MATCH;
}

/**
 * ListenBrainz : correspondance FLOUE (artiste, titre) -> enregistrement
 * MusicBrainz, sans la limite de 1 req/s de MusicBrainz. Bien plus tolérant
 * aux fautes et aux variantes de titre que la recherche Lucene de MusicBrainz.
 * Renvoie l'identifiant de la sortie, dont on va chercher la pochette sur
 * Cover Art Archive.
 */
async function searchListenBrainz(
  candidate: QueryCandidate,
  signal: AbortSignal
): Promise<SourceAttempt> {
  // L'API exige les deux champs : sans artiste, on laisse les autres sources faire.
  if (!candidate.artist) return NO_MATCH;

  const url =
    `${LISTENBRAINZ_ENDPOINT}?artist_name=${encodeURIComponent(candidate.artist)}` +
    `&recording_name=${encodeURIComponent(candidate.title)}`;
  const outcome = await fetchJson(url, signal);
  if (!outcome.ok) return FAILED;

  const data = outcome.data as {
    recording_name?: string;
    artist_credit_name?: string;
    release_mbid?: string;
  } | null;
  if (!data?.release_mbid) return NO_MATCH;

  const probe: SourceMatch = {
    url: "",
    artist: data.artist_credit_name ?? "",
    title: data.recording_name ?? "",
  };
  if (!isPlausibleMatch(candidate, probe)) return NO_MATCH;

  const cover = await firstReachableCover(
    [`${COVERART_ENDPOINT}/release/${data.release_mbid}/front-500`],
    signal
  );
  if (cover.url) return { match: { ...probe, url: cover.url }, failed: false };
  return { match: null, failed: cover.failed };
}

/**
 * MusicBrainz (métadonnées) + Cover Art Archive (image). 1 req/s imposée sur
 * MusicBrainz, mais c'est la seule source ouverte qui couvre le catalogue non
 * commercial. Un même enregistrement figure souvent sur plusieurs sorties
 * (single, album, compilation) dont une partie seulement a une pochette : on
 * teste donc chaque groupe de sorties, en parallèle, au lieu du seul premier.
 */
async function searchCoverArtArchive(
  candidate: QueryCandidate,
  signal: AbortSignal
): Promise<SourceAttempt> {
  if (!(await waitForSlot(musicBrainzGate, MUSICBRAINZ_MIN_INTERVAL_MS, signal))) return FAILED;

  const escape = (v: string) => v.replace(/["\\]/g, " ").trim();
  const clauses = [`recording:"${escape(candidate.title)}"`];
  if (candidate.artist) clauses.push(`artist:"${escape(candidate.artist)}"`);

  const url = `${MUSICBRAINZ_ENDPOINT}?query=${encodeURIComponent(
    clauses.join(" AND ")
  )}&limit=5&fmt=json`;
  const outcome = await fetchJson(url, signal);
  if (!outcome.ok) return FAILED;

  const recordings =
    (
      outcome.data as {
        recordings?: {
          title?: string;
          "artist-credit"?: { name?: string }[];
          releases?: { id?: string; "release-group"?: { id?: string } }[];
        }[];
      } | null
    )?.recordings ?? [];

  const checked = new Set<string>();
  let failed = false;

  for (const rec of recordings) {
    const artist = (rec["artist-credit"] ?? [])
      .map((c) => c.name ?? "")
      .join(" ")
      .trim();
    const probe: SourceMatch = { url: "", artist, title: rec.title ?? "" };
    if (!isPlausibleMatch(candidate, probe)) continue;

    const groupIds = [
      ...new Set(
        (rec.releases ?? []).map((r) => r["release-group"]?.id).filter((id): id is string => !!id)
      ),
    ]
      .filter((id) => !checked.has(id))
      .slice(0, MAX_RELEASE_GROUPS_PER_RECORDING);
    if (!groupIds.length) continue;
    groupIds.forEach((id) => checked.add(id));

    const cover = await firstReachableCover(
      groupIds.map((id) => `${COVERART_ENDPOINT}/release-group/${id}/front-500`),
      signal
    );
    if (cover.url) return { match: { ...probe, url: cover.url }, failed: false };
    failed = failed || cover.failed;
  }
  return { match: null, failed };
}

/**
 * Audius : plateforme ouverte, sans clé (simple `app_name`). Couvre la
 * musique indépendante et électronique absente des catalogues commerciaux.
 * Catalogue d'uploads utilisateurs -> la vérification titre + artiste
 * (isPlausibleMatch) est indispensable ici.
 */
async function searchAudius(candidate: QueryCandidate, signal: AbortSignal): Promise<SourceAttempt> {
  const term = `${candidate.artist} ${candidate.title}`.trim();
  const url =
    `${AUDIUS_ENDPOINT}?query=${encodeURIComponent(term)}&limit=5` +
    `&app_name=${encodeURIComponent(AUDIUS_APP_NAME)}`;
  const outcome = await fetchJson(url, signal);
  if (!outcome.ok) return FAILED;

  const results =
    (
      outcome.data as {
        data?: {
          title?: string;
          user?: { name?: string; handle?: string };
          artwork?: Record<string, string | null> | null;
        }[];
      } | null
    )?.data ?? [];

  for (const item of results) {
    const art = item.artwork;
    const cover = art?.["480x480"] ?? art?.["1000x1000"] ?? art?.["150x150"];
    if (!cover) continue;
    const match: SourceMatch = {
      url: cover,
      artist: item.user?.name ?? item.user?.handle ?? "",
      title: item.title ?? "",
    };
    if (isPlausibleMatch(candidate, match)) return { match, failed: false };
  }
  return NO_MATCH;
}

interface Source {
  id: Exclude<ArtworkSource, "none">;
  search: (candidate: QueryCandidate, signal: AbortSignal) => Promise<SourceAttempt>;
}

/**
 * Toutes ces sources sont interrogées EN MÊME TEMPS. L'ordre ne sert qu'à
 * départager deux réponses quasi simultanées (voir raceSources) : catalogues
 * commerciaux d'abord (pochettes officielles, haute définition), puis
 * catalogues ouverts.
 */
const SOURCES: Source[] = [
  { id: "itunes", search: searchItunes },
  { id: "deezer", search: searchDeezer },
  { id: "listenbrainz", search: searchListenBrainz },
  { id: "coverartarchive", search: searchCoverArtArchive },
  { id: "audius", search: searchAudius },
];

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------

/**
 * Nature d'un échec, qui règle la durée de mise en cache :
 * - definitive : toutes les sources ont répondu, aucune ne connaît le morceau ;
 * - partial    : certaines ont répondu « inconnu », d'autres n'ont pas répondu ;
 * - transient  : aucune source n'a répondu (réseau coupé).
 */
type MissKind = "definitive" | "partial" | "transient";

interface ResolveResult {
  url: string | null;
  source: ArtworkSource;
  /** Renseigné uniquement quand `url` est null. */
  miss?: MissKind;
}

interface SourceOutcome {
  url: string | null;
  source: ArtworkSource;
  failed: boolean;
}

/**
 * Interroge UNE source sur ses candidats, du plus précis au plus permissif,
 * et s'arrête au premier résultat jugé fiable. Les candidats restent en
 * séquence : ils sont presque toujours dédoublonnés en 1 ou 2, et les lancer
 * tous ensemble multiplierait les requêtes (et le quota iTunes) pour rien.
 */
async function trySource(
  source: Source,
  candidates: QueryCandidate[],
  deadline: number,
  signal: AbortSignal
): Promise<SourceOutcome> {
  try {
    for (const candidate of candidates) {
      if (signal.aborted || Date.now() >= deadline) return { url: null, source: "none", failed: true };
      const attempt = await source.search(candidate, signal);
      if (attempt.match) return { url: attempt.match.url, source: source.id, failed: false };
      // Source injoignable : inutile d'essayer ses autres candidats.
      if (attempt.failed) return { url: null, source: "none", failed: true };
    }
    return { url: null, source: "none", failed: false };
  } catch {
    return { url: null, source: "none", failed: true };
  }
}

/**
 * Lance toutes les sources en parallèle. Le premier résultat fiable gagne et
 * les requêtes encore en vol sont annulées.
 *
 * Une seule nuance : si la source qui répond en premier n'est pas la mieux
 * classée et qu'une source mieux classée n'a pas encore répondu, on lui laisse
 * PREFERENCE_GRACE_MS pour arriver. Ça garde des résultats stables d'un
 * lancement à l'autre (iTunes l'emporte sur Deezer à ~50 ms d'écart) sans
 * jamais coûter plus que ce délai.
 */
function raceSources(
  candidates: QueryCandidate[],
  deadline: number
): Promise<{ hit: SourceOutcome | null; failures: number }> {
  const controller = new AbortController();

  return new Promise((resolve) => {
    const outcomes: (SourceOutcome | undefined)[] = SOURCES.map(() => undefined);
    let done = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const finish = () => {
      if (done) return;
      done = true;
      if (graceTimer) clearTimeout(graceTimer);
      clearTimeout(deadlineTimer);
      controller.abort(); // annule ce qui est encore en vol
      const hit = outcomes.find((o) => o?.url) ?? null;
      // Une source qui n'a pas répondu à temps compte comme un échec.
      const failures = outcomes.filter((o) => o === undefined || o.failed).length;
      resolve({ hit, failures });
    };

    const evaluate = () => {
      const best = outcomes.findIndex((o) => o?.url);
      if (best === -1) {
        if (outcomes.every((o) => o !== undefined)) finish();
        return;
      }
      const betterPending = outcomes.slice(0, best).some((o) => o === undefined);
      if (!betterPending) finish();
      else if (!graceTimer) graceTimer = setTimeout(finish, PREFERENCE_GRACE_MS);
    };

    const deadlineTimer = setTimeout(finish, Math.max(0, deadline - Date.now()));

    SOURCES.forEach((source, index) => {
      void trySource(source, candidates, deadline, controller.signal).then((outcome) => {
        if (done) return;
        outcomes[index] = outcome;
        evaluate();
      });
    });
  });
}

async function resolve(rawArtist: string, rawTitle: string): Promise<ResolveResult> {
  const meta = normalizeMetadata(rawArtist, rawTitle);
  if (!meta.title) return { url: null, source: "none", miss: "definitive" };

  const candidates = buildQueryCandidates(meta);
  const { hit, failures } = await raceSources(candidates, Date.now() + LOOKUP_DEADLINE_MS);

  if (hit?.url) return { url: hit.url, source: hit.source };

  const miss: MissKind =
    failures === 0 ? "definitive" : failures >= SOURCES.length ? "transient" : "partial";
  return { url: null, source: "none", miss };
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
    : result.miss === "definitive"
      ? DEFINITIVE_MISS_TTL_MS
      : result.miss === "partial"
        ? PARTIAL_MISS_TTL_MS
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
  deezerGate.next = 0;
  musicBrainzGate.next = 0;
  loaded = true; // évite de relire le disque pendant les tests
}
