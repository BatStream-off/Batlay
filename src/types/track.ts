/**
 * Modèle de données central de Batlay.
 * Tous les providers (Spotify, Demo, futurs providers) doivent produire
 * des objets conformes à cette forme — c'est ce qui permet à l'Overlay
 * Engine de rester totalement indépendant de la source musicale.
 */
export interface Track {
  id: string;
  title: string;
  /**
   * Chaîne d'affichage de TOUS les artistes ("Artiste 1, Artiste 2, Artiste 3").
   * C'est ce que voient le Dashboard et les overlays par défaut.
   */
  artist: string;
  /**
   * Liste structurée des artistes, quand la source la fournit (Spotify,
   * Mode Demo). Nécessaire car la chaîne `artist` est ambiguë : dans
   * "Tyler, The Creator, Kali Uchis" on ne peut pas savoir combien il y a
   * d'artistes en re-découpant sur la virgule. Absente pour la Lecture
   * système Windows, où l'OS ne transmet qu'une chaîne déjà formatée.
   */
  artists?: string[];
  album?: string;
  /** Nom lisible du lecteur d'où vient le morceau ("Spotify", "VLC", "Firefox"...). */
  source?: string;
  /** URL (ou data URI) de la pochette. Optionnelle si indisponible. */
  artwork?: string;
  /** Durée totale du morceau, en millisecondes. */
  duration: number;
  /** Position de lecture actuelle, en millisecondes. */
  progress: number;
  isPlaying: boolean;
  /**
   * Statut détaillé. `isPlaying` reste la source de vérité pour
   * l'interpolation ; ce champ permet de distinguer pause et arrêt à
   * l'affichage sans casser le code existant.
   */
  playbackStatus?: "playing" | "paused" | "stopped" | "unknown";
}

export interface PlaybackState {
  track: Track | null;
  isPlaying: boolean;
  /**
   * Horodatage (Date.now()) de l'instant où `track.progress` a été MESURÉ
   * à la source — pas celui où la réponse a fini d'être traitée. La
   * différence compte : c'est elle qui permet à l'affichage de compenser
   * la latence du polling (voir src/utils/progress-clock.ts).
   */
  updatedAt: number;
}

export type MusicProviderId = "spotify" | "demo" | "system-media";

export interface MusicProviderStatus {
  id: MusicProviderId;
  connected: boolean;
  /** Message d'erreur lisible si connected === false suite à un échec. */
  error?: string;
}
