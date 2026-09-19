/**
 * Modèle de données central de Batlay.
 * Tous les providers (Spotify, Demo, futurs providers) doivent produire
 * des objets conformes à cette forme — c'est ce qui permet à l'Overlay
 * Engine de rester totalement indépendant de la source musicale.
 */
export interface Track {
  id: string;
  title: string;
  artist: string;
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
  /** Horodatage (Date.now()) de la dernière mise à jour reçue du provider. */
  updatedAt: number;
}

export type MusicProviderId = "spotify" | "demo" | "system-media";

export interface MusicProviderStatus {
  id: MusicProviderId;
  connected: boolean;
  /** Message d'erreur lisible si connected === false suite à un échec. */
  error?: string;
}
