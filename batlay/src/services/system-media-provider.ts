import type { MusicProvider } from "./music-provider";
import type { Track, PlaybackState } from "@/types/track";
import { cleanMetadataText } from "@/utils/text-encoding";
import { createMetadataDebugLogger, isMetadataDebugEnabled } from "@/utils/metadata-debug";

/**
 * Cadence de détection.
 *
 * Chaque relevé lance un process PowerShell : baisser l'intervalle de façon
 * uniforme coûterait cher en CPU pour rien la plupart du temps. On module
 * donc la cadence — rapide seulement dans les fenêtres où un changement est
 * probable, lente le reste du temps :
 *   - IDLE  : rien ne joue, ou lecteur choisi absent -> relevé espacé.
 *   - STEADY: lecture tranquille en milieu de morceau.
 *   - FAST  : juste après un changement détecté, et en fin de morceau
 *             (c'est là que tombe le changement de piste suivant).
 */
const POLL_IDLE_MS = 3000;
const POLL_STEADY_MS = 2000;
const POLL_FAST_MS = 400;
/** Durée pendant laquelle on reste en cadence rapide après un changement. */
const FAST_WINDOW_MS = 6000;
/** Marge avant la fin d'un morceau à partir de laquelle on passe en cadence rapide. */
const TRACK_END_MARGIN_MS = 8000;

/**
 * AppUserModelId Windows -> nom lisible, pour le composant Source de
 * l'overlay. La liste ne prétend pas être exhaustive : tout identifiant
 * inconnu est nettoyé (voir prettifySourceApp) plutôt qu'ignoré.
 */
const SOURCE_LABELS: Record<string, string> = {
  "spotify.exe": "Spotify",
  "vlc.exe": "VLC",
  "chrome.exe": "Chrome",
  "msedge.exe": "Edge",
  "firefox.exe": "Firefox",
  "brave.exe": "Brave",
  "opera.exe": "Opera",
  "itunes.exe": "iTunes",
  "applemusic.exe": "Apple Music",
  "foobar2000.exe": "foobar2000",
  "aimp.exe": "AIMP",
  "musicbee.exe": "MusicBee",
  "wmplayer.exe": "Windows Media Player",
  "deezer.exe": "Deezer",
  "tidal.exe": "TIDAL",
};

/** Transforme un AppUserModelId en libellé présentable à l'antenne. */
export function prettifySourceApp(appId: string | null | undefined): string {
  if (!appId) return "";
  const known = SOURCE_LABELS[appId.toLowerCase()];
  if (known) return known;
  // Les apps du Store ont un identifiant du type
  // "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" : on garde le
  // segment le plus parlant.
  const tail = appId.split("!").pop() ?? appId;
  const base = (tail.split(".").pop() ?? tail).replace(/\.exe$/i, "").replace(/_.*$/, "");
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : "";
}

/** Journal de diagnostic des métadonnées : inactif tant que le drapeau localStorage n'est pas posé (voir metadata-debug.ts). */
const logMetadataDebug = createMetadataDebugLogger({
  isEnabled: isMetadataDebugEnabled,
  write: (message) => console.log(message),
});

/**
 * Lit le morceau en cours directement depuis les contrôles multimédias
 * système de Windows (voir electron/services/system-media.ts), sans
 * jamais passer par l'API Web de Spotify.
 *
 * Avantage : fonctionne pour n'importe quel compte (gratuit ou Premium)
 * et n'importe quelle app qui expose son "Now Playing" à Windows.
 * Contrepartie : Windows uniquement, et par défaut reflète l'app qui a
 * le focus multimédia côté OS — d'où `setPreferredSession` pour choisir
 * explicitement un lecteur quand plusieurs tournent en même temps.
 */
export class SystemMediaProvider implements MusicProvider {
  readonly id = "system-media";

  private connected = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<(state: PlaybackState) => void>();
  private errorListeners = new Set<(message: string) => void>();
  private lastTrackId: string | null = null;
  /** Dernier état émis : sert à décider de la cadence du prochain relevé. */
  private lastState: PlaybackState | null = null;
  /** Statut de lecture du relevé précédent (détecte play/pause). */
  private lastIsPlaying: boolean | null = null;
  /** Tant que Date.now() < fastUntil, on reste en cadence rapide. */
  private fastUntil = 0;
  private preferredAppId: string | null = null;
  /** Cache la dernière pochette récupérée pour éviter de la re-télécharger à chaque poll (2s) tant que le morceau n'a pas changé. */
  private lastArtwork: { trackId: string; dataUri: string } | null = null;
  /**
   * Résultat de la recherche en ligne (artiste + titre -> URL), utilisée
   * uniquement quand le lecteur n'expose AUCUNE vignette au système —
   * cas courant avec VLC, les lecteurs locaux et les navigateurs.
   * On mémorise aussi les échecs (`url: null`) pour ne pas relancer une
   * recherche à chaque poll sur un morceau introuvable.
   */
  private remoteArtwork: { trackId: string; url: string | null } | null = null;
  /** Morceau dont la recherche en ligne est en cours (évite les appels concurrents). */
  private remoteLookupInFlight: string | null = null;
  /** Morceau dont la pochette est en cours de récupération (système puis en ligne). */
  private artworkInFlight: string | null = null;
  /** Tentatives de lecture de la vignette système pour le morceau courant (voir requestArtwork). */
  private thumbnailAttempts: { trackId: string; count: number; lastAt: number } | null = null;
  /** Invalide les tâches en vol (pochette) après un disconnect(). */
  private generation = 0;

  async connect(): Promise<void> {
    const supported = await window.batlay.systemMedia.isSupported();
    if (!supported) {
      throw new Error(
        "La lecture système n'est disponible que sur Windows. Utilisez Spotify ou le Mode Demo sur les autres plateformes."
      );
    }
    // Vérifie tout de suite que Windows répond correctement plutôt que
    // de découvrir un souci de PowerShell/permissions seulement au
    // premier tick de polling, en silence.
    await window.batlay.systemMedia.getCurrent({ preferredAppId: this.preferredAppId ?? undefined });
    this.connected = true;
    this.startPolling();
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.generation++;
    this.stopPolling();
    this.lastArtwork = null;
    this.remoteArtwork = null;
    this.remoteLookupInFlight = null;
    this.artworkInFlight = null;
    this.thumbnailAttempts = null;
    this.lastState = null;
    this.lastIsPlaying = null;
    this.fastUntil = 0;
    // NOTE : this.preferredAppId n'est volontairement PAS remis à zéro.
    // Le choix du lecteur est manuel et doit survivre à une reconnexion.
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Liste les lecteurs actuellement actifs côté Windows, pour un sélecteur dans Connections. */
  async listAvailableSessions(): Promise<{ sourceAppId: string | null; title: string; artist: string }[]> {
    return window.batlay.systemMedia.listSessions();
  }

  /**
   * Choisit explicitement le lecteur à suivre (par AppUserModelId, ex.
   * "Spotify.exe"), utile quand plusieurs apps jouent en même temps.
   * `null` revient au comportement par défaut (session ayant le focus
   * multimédia côté Windows). Prend effet dès le prochain poll.
   */
  setPreferredSession(appId: string | null): void {
    this.preferredAppId = appId;
    // Le lecteur change : les pochettes mises en cache ne sont plus valides.
    this.lastArtwork = null;
    this.remoteArtwork = null;
    this.thumbnailAttempts = null;
  }

  getPreferredSession(): string | null {
    return this.preferredAppId;
  }

  async getCurrentTrack(): Promise<Track | null> {
    return (await this.readState()).track;
  }

  /**
   * Un relevé complet : interroge Windows UNE fois (un seul process
   * PowerShell) et construit l'état. La pochette n'est jamais attendue ici
   * — voir requestArtwork.
   */
  private async readState(): Promise<PlaybackState> {
    if (!this.connected) return { track: null, isPlaying: false, updatedAt: Date.now() };

    const data = await window.batlay.systemMedia.getCurrent({ preferredAppId: this.preferredAppId ?? undefined });
    if (!data) {
      this.lastArtwork = null;
      this.remoteArtwork = null;
      this.thumbnailAttempts = null;
      return { track: null, isPlaying: false, updatedAt: Date.now() };
    }

    // Texte nettoyé une seule fois, ici : NFC, caractères de contrôle, et
    // réparation d'un éventuel mojibake fourni par la source elle-même.
    // (Les "�" venaient de la sortie PowerShell, corrigée dans
    // electron/services/system-media.ts ; ceci couvre les sources dont les
    // tags sont mal lus en amont.)
    const rawTitle = cleanMetadataText(data.title);
    const rawArtist = cleanMetadataText(data.artist);
    const album = cleanMetadataText(data.album);
    logMetadataDebug(
      `${rawTitle}::${rawArtist}`,
      { title: data.title, artist: data.artist, album: data.album ?? "", albumArtist: data.albumArtist ?? "" },
      { title: rawTitle, artist: rawArtist, album }
    );

    // Pas d'identifiant stable fourni par Windows : on en dérive un à
    // partir du titre + artiste pour que l'Overlay Engine détecte
    // correctement les changements de morceau.
    const trackId = `${rawTitle}::${rawArtist}`;

    let artwork: string | undefined;
    if (this.lastArtwork?.trackId === trackId) artwork = this.lastArtwork.dataUri;
    else if (this.remoteArtwork?.trackId === trackId && this.remoteArtwork.url) artwork = this.remoteArtwork.url;

    // Pochette : récupérée EN ARRIÈRE-PLAN. Elle exige un second process
    // PowerShell (lent : décodage de l'image) ; l'attendre ici retardait
    // d'autant l'affichage du titre et de la progression à chaque changement
    // de morceau. Le résultat est ré-émis dès qu'il arrive (applyArtwork).
    if (!artwork) this.requestArtwork(trackId, rawArtist, rawTitle, data.sourceAppId ?? null);

    if (data.durationMs === 0) {
      console.warn(
        `[Batlay] "${rawTitle}" (${data.sourceAppId ?? "app inconnue"}) ne fournit pas de durée totale via les contrôles multimédias Windows — la barre de progression restera vide pour ce lecteur (limitation de l'app source, pas de Batlay).`
      );
    }

    const track: Track = {
      id: trackId,
      // Métadonnées absentes : libellés explicites plutôt que du vide.
      title: rawTitle || "Titre inconnu",
      // L'artiste est transmis TEL QUEL : "Artiste 1, Artiste 2, Artiste 3"
      // reste intact. Aucun découpage ici — la normalisation n'existe que
      // pour la recherche de pochette, jamais pour l'affichage.
      // (Limite de la source : Windows ne transmet que la chaîne que l'app
      // lui donne ; si l'app n'y met qu'un artiste, il n'y en a qu'un ici.)
      artist: rawArtist || "Artiste inconnu",
      album: album || undefined,
      source: prettifySourceApp(data.sourceAppId),
      artwork,
      duration: data.durationMs,
      progress: data.positionMs,
      isPlaying: data.isPlaying,
      playbackStatus: data.playbackStatus ?? (data.isPlaying ? "playing" : "paused"),
    };

    return {
      track,
      isPlaying: track.isPlaying,
      // Instant de la MESURE côté Windows (et non celui où on a fini de
      // traiter la réponse) : l'horloge de progression compense ainsi la
      // latence du process PowerShell au lieu de la subir.
      updatedAt: data.sampledAtMs ?? Date.now(),
    };
  }

  /**
   * Récupère la pochette sans jamais bloquer le relevé :
   *   1. vignette exposée par le lecteur via Windows (data URI) ;
   *   2. sinon recherche en ligne (voir lookupRemoteArtwork).
   * Le résultat est mis en cache pour le morceau, puis ré-émis aux abonnés.
   */
  private requestArtwork(trackId: string, artist: string, title: string, sourceAppId: string | null): void {
    if (this.artworkInFlight === trackId) return;

    // Vignette système : plusieurs tentatives espacées (certains navigateurs
    // publient la pochette quelques secondes après le titre), pas une par
    // poll — chaque tentative coûte un process PowerShell.
    const attempts = this.thumbnailAttempts?.trackId === trackId ? this.thumbnailAttempts : null;
    const mayTryThumbnail = !attempts || (attempts.count < 3 && Date.now() - attempts.lastAt > 3000);
    const mayTryRemote = this.remoteArtwork?.trackId !== trackId;
    if (!mayTryThumbnail && !mayTryRemote) return;

    this.artworkInFlight = trackId;
    const generation = this.generation;

    void (async () => {
      try {
        let found: string | undefined;

        if (mayTryThumbnail) {
          this.thumbnailAttempts = { trackId, count: (attempts?.count ?? 0) + 1, lastAt: Date.now() };
          try {
            const withArtwork = await window.batlay.systemMedia.getCurrent({
              preferredAppId: this.preferredAppId ?? undefined,
              includeArtwork: true,
            });
            if (generation !== this.generation) return;
            if (withArtwork?.artwork) {
              found = withArtwork.artwork;
              this.lastArtwork = { trackId, dataUri: found };
              console.log(
                `[Batlay] Pochette récupérée pour "${trackId}" (${Math.round(withArtwork.artwork.length / 1024)} Ko).`
              );
            } else if (withArtwork) {
              // Diagnostic : n'empêche jamais l'affichage du titre/artiste,
              // mais permet de comprendre pourquoi l'image manque (voir
              // DevTools > Console dans la fenêtre Batlay).
              if (!withArtwork.hasThumbnail) {
                console.warn(
                  `[Batlay] "${withArtwork.title}" (${withArtwork.sourceAppId ?? sourceAppId ?? "app inconnue"}) n'expose aucune pochette au système (SMTC) — rien à afficher pour ce lecteur.`
                );
              } else if (withArtwork.artworkError) {
                console.warn(`[Batlay] Échec de récupération de la pochette : ${withArtwork.artworkError}`);
              }
            }
          } catch {
            // La pochette est un bonus visuel : un échec ici ne doit jamais
            // empêcher l'affichage du titre/artiste/progression.
          }
        }

        // Le lecteur n'a rien donné : recherche en ligne (artiste + titre).
        if (!found && mayTryRemote) {
          await this.lookupRemoteArtwork(trackId, artist, title);
          if (generation !== this.generation) return;
          found = this.remoteArtwork?.trackId === trackId ? (this.remoteArtwork.url ?? undefined) : undefined;
        }

        if (found) this.applyArtwork(trackId, found);
      } finally {
        if (this.artworkInFlight === trackId) this.artworkInFlight = null;
      }
    })();
  }

  /** Ré-émet l'état courant avec la pochette dès qu'elle arrive, sans attendre le poll suivant. */
  private applyArtwork(trackId: string, artwork: string): void {
    const state = this.lastState;
    if (!state?.track || state.track.id !== trackId || state.track.artwork === artwork) return;
    const next: PlaybackState = { ...state, track: { ...state.track, artwork } };
    this.lastState = next;
    this.emit(next);
  }

  /** Complète un état frais avec une pochette déjà en cache (course entre relevé et pochette). */
  private withCachedArtwork(state: PlaybackState): PlaybackState {
    const track = state.track;
    if (!track || track.artwork) return state;
    const cached =
      this.lastArtwork?.trackId === track.id
        ? this.lastArtwork.dataUri
        : this.remoteArtwork?.trackId === track.id
          ? (this.remoteArtwork.url ?? undefined)
          : undefined;
    return cached ? { ...state, track: { ...track, artwork: cached } } : state;
  }

  /**
   * Recherche la pochette en ligne via le process principal
   * (electron/services/artwork-lookup.ts : iTunes puis Deezer, sans clé
   * d'API, avec cache). Le résultat — succès ou échec — est mémorisé pour
   * ce morceau afin de ne jamais relancer la recherche à chaque poll.
   */
  private async lookupRemoteArtwork(trackId: string, artist: string, title: string): Promise<void> {
    if (this.remoteLookupInFlight === trackId) return;
    this.remoteLookupInFlight = trackId;
    try {
      const result = await window.batlay?.artwork?.lookup(artist, title);
      this.remoteArtwork = { trackId, url: result?.url ?? null };
      if (result?.url) {
        console.log(`[Batlay] Pochette trouvée en ligne pour "${trackId}" (source : ${result.source}).`);
      } else {
        console.warn(
          `[Batlay] Aucune pochette trouvée en ligne pour "${trackId}" — l'emplacement restera vide.`
        );
      }
    } catch {
      // Réseau indisponible ou bridge absent : on mémorise l'échec pour ce
      // morceau. La pochette est un bonus, jamais un bloquant.
      this.remoteArtwork = { trackId, url: null };
    } finally {
      this.remoteLookupInFlight = null;
    }
  }

  async getPlaybackState(): Promise<PlaybackState> {
    return this.readState();
  }

  onStateChange(listener: (state: PlaybackState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onError(listener: (message: string) => void): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /**
   * Cadence courante, recalculée après chaque relevé. Voir les constantes
   * en tête de fichier : rapide seulement quand un changement est probable.
   */
  private nextDelayMs(): number {
    if (Date.now() < this.fastUntil) return POLL_FAST_MS;

    const track = this.lastState?.track;
    if (!track || !track.isPlaying) return POLL_IDLE_MS;

    const remaining = track.duration > 0 ? track.duration - track.progress : Infinity;
    if (remaining <= TRACK_END_MARGIN_MS) return POLL_FAST_MS;

    return POLL_STEADY_MS;
  }

  /**
   * setTimeout ré-armé plutôt que setInterval : l'intervalle change d'un
   * relevé à l'autre, et on ne veut jamais empiler deux relevés si
   * PowerShell met plus longtemps que prévu à répondre.
   */
  private scheduleNextPoll(): void {
    if (!this.connected) return;
    this.pollTimer = setTimeout(() => {
      void this.pollOnce().finally(() => this.scheduleNextPoll());
    }, this.nextDelayMs());
  }

  private startPolling(): void {
    this.stopPolling();
    void this.pollOnce().finally(() => this.scheduleNextPoll());
  }

  private async pollOnce(): Promise<void> {
    try {
      const state = this.withCachedArtwork(await this.readState());
      const currentTrackId = state.track?.id ?? null;
      const currentIsPlaying = state.track?.isPlaying ?? false;

      // Un changement vient de se produire : les suivants arrivent souvent
      // en rafale (zapping, fin d'album). On resserre la cadence quelques
      // secondes pour les attraper sans latence.
      if (currentTrackId !== this.lastTrackId) {
        console.log(
          `[Batlay] Changement de morceau (système) : ${this.lastTrackId ?? "—"} → ${currentTrackId ?? "—"}`
        );
        this.lastTrackId = currentTrackId;
        this.fastUntil = Date.now() + FAST_WINDOW_MS;
      } else if (this.lastIsPlaying !== null && currentIsPlaying !== this.lastIsPlaying) {
        // Play/pause : l'utilisateur est aux commandes, un autre geste suit
        // souvent immédiatement.
        this.fastUntil = Date.now() + FAST_WINDOW_MS;
      }
      this.lastIsPlaying = currentIsPlaying;
      this.lastState = state;
      this.emit(state);
    } catch (err) {
      const message = (err as Error).message || "Erreur de lecture des contrôles multimédias système.";
      console.error("[Batlay] Erreur de polling lecture système:", err);
      this.errorListeners.forEach((l) => l(message));
    }
  }

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  private emit(state: PlaybackState): void {
    this.listeners.forEach((l) => l(state));
  }
}
