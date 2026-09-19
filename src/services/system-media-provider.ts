import type { MusicProvider } from "./music-provider";
import type { Track, PlaybackState } from "@/types/track";

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
    this.stopPolling();
    this.lastArtwork = null;
    this.remoteArtwork = null;
    this.remoteLookupInFlight = null;
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
  }

  getPreferredSession(): string | null {
    return this.preferredAppId;
  }

  async getCurrentTrack(): Promise<Track | null> {
    if (!this.connected) return null;

    const data = await window.batlay.systemMedia.getCurrent({ preferredAppId: this.preferredAppId ?? undefined });
    if (!data) {
      this.lastArtwork = null;
      this.remoteArtwork = null;
      return null;
    }

    // Pas d'identifiant stable fourni par Windows : on en dérive un à
    // partir du titre + artiste pour que l'Overlay Engine détecte
    // correctement les changements de morceau.
    const trackId = `${data.title}::${data.artist}`;

    let artwork: string | undefined = this.lastArtwork?.trackId === trackId ? this.lastArtwork.dataUri : undefined;
    if (!artwork) {
      // La pochette n'est demandée que lorsque le morceau a changé (ou au
      // premier poll) : c'est nettement plus lent à récupérer côté
      // PowerShell/WinRT qu'un simple statut de lecture, donc on évite de
      // la re-télécharger à chaque tick de polling (2s) pour rien.
      try {
        const withArtwork = await window.batlay.systemMedia.getCurrent({
          preferredAppId: this.preferredAppId ?? undefined,
          includeArtwork: true,
        });
        if (withArtwork?.artwork) {
          artwork = withArtwork.artwork;
          this.lastArtwork = { trackId, dataUri: artwork };
          console.log(
            `[Batlay] Pochette récupérée pour "${trackId}" (${Math.round(withArtwork.artwork.length / 1024)} Ko).`
          );
        } else if (withArtwork) {
          // Diagnostic : n'empêche jamais l'affichage du titre/artiste,
          // mais permet de comprendre pourquoi l'image manque (voir
          // DevTools > Console dans la fenêtre Batlay).
          if (!withArtwork.hasThumbnail) {
            console.warn(
              `[Batlay] "${withArtwork.title}" (${withArtwork.sourceAppId ?? "app inconnue"}) n'expose aucune pochette au système (SMTC) — rien à afficher pour ce lecteur.`
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

    // Le lecteur n'a rien donné : on complète avec une recherche en ligne
    // (artiste + titre). Volontairement NON bloquant — la progression et le
    // titre ne doivent jamais attendre le réseau. La pochette apparaît au
    // poll suivant (~2s), une seule fois par morceau grâce au cache.
    if (!artwork) {
      if (this.remoteArtwork?.trackId === trackId) {
        artwork = this.remoteArtwork.url ?? undefined;
      } else {
        void this.lookupRemoteArtwork(trackId, data.artist, data.title);
      }
    }

    if (data.durationMs === 0) {
      console.warn(
        `[Batlay] "${data.title}" (${data.sourceAppId ?? "app inconnue"}) ne fournit pas de durée totale via les contrôles multimédias Windows — la barre de progression restera vide pour ce lecteur (limitation de l'app source, pas de Batlay).`
      );
    }

    return {
      id: trackId,
      // Métadonnées absentes : libellés explicites plutôt que du vide.
      title: data.title || "Titre inconnu",
      // L'artiste est transmis TEL QUEL : "Artiste 1, Artiste 2, Artiste 3"
      // reste intact. Aucun découpage ici — la normalisation n'existe que
      // pour la recherche de pochette, jamais pour l'affichage.
      artist: data.artist || "Artiste inconnu",
      album: data.album ?? undefined,
      source: prettifySourceApp(data.sourceAppId),
      artwork,
      duration: data.durationMs,
      progress: data.positionMs,
      isPlaying: data.isPlaying,
      playbackStatus: data.playbackStatus ?? (data.isPlaying ? "playing" : "paused"),
    };
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
    const track = await this.getCurrentTrack();
    return { track, isPlaying: track?.isPlaying ?? false, updatedAt: Date.now() };
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
      const state = await this.getPlaybackState();
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
