import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Service main-process qui interroge les Global System Media Transport
 * Controls (SMTC) de Windows — l'API système utilisée par le Volet de
 * contrôle multimédia (Win + Media keys) pour savoir "qu'est-ce qui joue
 * en ce moment sur ce PC", tous logiciels confondus.
 *
 * Contrairement au provider Spotify (electron/services/spotify-auth.ts),
 * celui-ci ne fait AUCUN appel à l'API Web de Spotify et n'a besoin
 * d'aucune authentification OAuth ni de Client ID :
 *   - Il fonctionne avec un compte Spotify gratuit (ou Premium).
 *   - Il fonctionne aussi avec n'importe quelle autre source qui expose
 *     ses métadonnées au système (YouTube Music dans Edge/Chrome, VLC,
 *     Apple Music pour Windows...).
 *   - Il n'est PAS soumis à la limite "Development Mode" de Spotify,
 *     puisqu'aucune requête ne part vers api.spotify.com.
 *
 * Contrepartie : Windows uniquement (l'API WinRT
 * Windows.Media.Control n'existe que sur Windows 10 1809+ / Windows 11),
 * et par défaut ça reflète l'app qui a le "focus multimédia" côté Windows
 * plutôt qu'un choix explicite — d'où la sélection de session ci-dessous.
 */

export type PlaybackStatus = "playing" | "paused" | "stopped" | "unknown";

/**
 * ⚠️ ENCODAGE — cause racine des "�" à la place de é, è, à, ç...
 *
 * `powershell.exe` écrit sur stdout avec [Console]::OutputEncoding, qui vaut
 * par défaut la page de code OEM de Windows (850 en France, 437 aux USA...),
 * PAS de l'UTF-8. Node décode stdout en UTF-8 : l'octet 0x82 qui représente
 * "é" en CP850 n'est pas de l'UTF-8 valide et devient U+FFFD ("�").
 * Aucun remplacement de texte après coup ne peut récupérer l'information :
 * elle est perdue dès le décodage.
 *
 * Correctif : PowerShell encode lui-même son JSON en UTF-8 puis en Base64
 * (alphabet ASCII pur, insensible à toute page de code), et Node décode
 * les octets en UTF-8 lui-même (voir decodePowerShellOutput).
 */

export interface SystemNowPlaying {
  title: string;
  artist: string;
  /**
   * `AlbumArtist` tel que l'app le déclare à Windows. DIAGNOSTIC UNIQUEMENT :
   * jamais affiché ni utilisé pour construire l'artiste (voir le journal
   * debug de system-media-provider.ts). Permet de constater, sur une vraie
   * machine, si un lecteur distingue `Artist` et `AlbumArtist`.
   */
  albumArtist: string | null;
  album: string | null;
  /**
   * Titre de la FENÊTRE de Spotify Desktop (« Artiste - Titre », « Advertisement »
   * pendant une pub), lu uniquement quand la source est Spotify ; `null` sinon,
   * ou si la fenêtre est masquée (Spotify réduit dans la zone de notification).
   * Sert à recouper SMTC : voir src/utils/spotify-metadata.ts.
   */
  windowTitle: string | null;
  /** Identifiant de l'app source côté Windows (ex. "Spotify.exe"). */
  sourceAppId: string | null;
  isPlaying: boolean;
  /** Statut détaillé : permet de distinguer pause et arrêt, pas seulement "ne joue pas". */
  playbackStatus: PlaybackStatus;
  /**
   * Position dans le morceau (ms) à l'instant `sampledAtMs`, DÉJÀ extrapolée
   * depuis LastUpdatedTime (voir resolvePosition).
   */
  positionMs: number;
  /** Instant (Date.now()) où Windows a été interrogé : date de validité de positionMs. */
  sampledAtMs: number;
  durationMs: number;
  /** Data URI (base64) de la pochette, uniquement si demandée via `includeArtwork`. */
  artwork: string | null;
  /** Diagnostics : l'app expose-t-elle une pochette au système, et si la récupération a échoué, pourquoi (voir console renderer). */
  hasThumbnail: boolean;
  artworkError: string | null;
}

export interface SystemMediaSessionSummary {
  sourceAppId: string | null;
  title: string;
  artist: string;
}

export interface GetCurrentOptions {
  /**
   * AppUserModelId d'une session précise à préférer (voir
   * listSystemMediaSessions). Si absente ou introuvable parmi les
   * sessions actives, on retombe sur la session ayant le focus
   * multimédia côté Windows (comportement historique).
   */
  preferredAppId?: string;
  /** Inclut la pochette encodée en base64 (plus lent : à ne demander que lorsque c'est nécessaire). */
  includeArtwork?: boolean;
}

/**
 * Script PowerShell auto-contenu qui projette les types WinRT
 * (Windows.Media.Control / Windows.Storage.Streams) dans .NET. Le petit
 * helper "Await" est nécessaire car PowerShell ne sait pas nativement
 * attendre une IAsyncOperation<T> WinRT — c'est le pattern standard
 * documenté par la communauté PowerShell pour ce cas (réflexion sur
 * System.WindowsRuntimeSystemExtensions.AsTask).
 *
 * $__params est injecté juste avant ce script (voir buildScript ci-dessous)
 * plutôt que passé en argument de ligne de commande, pour éviter tout
 * souci d'échappement avec les caractères spéciaux de PowerShell.
 */
const PS_SCRIPT = `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null
  $asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
  })[0]

  function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
  }

  # Sortie : JSON -> octets UTF-8 -> Base64 (ASCII pur). Indépendant de la
  # page de code de la console : plus aucun "�" possible sur les accents.
  function Emit($obj) {
    $json = $obj | ConvertTo-Json -Compress -Depth 4
    [Console]::Out.Write([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json)))
  }

  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null

  $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $sessions = $manager.GetSessions()

  if ($__params.listOnly) {
    $list = @()
    foreach ($s in $sessions) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $list += [PSCustomObject]@{ sourceAppId = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist }
    }
    Emit ([PSCustomObject]@{ supported = $true; sessions = $list })
    exit 0
  }

  # SELECTION MANUELLE : quand l'utilisateur a explicitement choisi un
  # lecteur, on ne bascule JAMAIS sur un autre. Si ce lecteur n'est pas
  # dans les sessions actives (fermé, en veille, entre deux morceaux), on
  # renvoie session = $null avec preferredMissing = $true : le provider
  # conserve le choix et attend le retour du lecteur. GetCurrentSession()
  # n'est utilisé QUE si aucun lecteur n'a été choisi.
  $session = $null
  $preferredMissing = $false
  if ($__params.preferredAppId) {
    $session = $sessions | Where-Object { $_.SourceAppUserModelId -eq $__params.preferredAppId } | Select-Object -First 1
    if (-not $session) { $preferredMissing = $true }
  } else {
    $session = $manager.GetCurrentSession()
  }

  if (-not $session) {
    Emit ([PSCustomObject]@{ supported = $true; session = $null; preferredMissing = $preferredMissing })
    exit 0
  }

  # État de lecture et timeline lus AVANT l'appel asynchrone des métadonnées
  # (qui prend quelques ms) : la position et son horodatage sont ainsi
  # mesurés au même instant.
  $playback = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()
  $sampledAtMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

  # Timeline.Position est la position au moment de LastUpdatedTime (dernière
  # mise à jour PAR L'APP), pas la position "en direct" : la plupart des
  # lecteurs ne la rafraîchissent qu'au play/pause/seek. Lire Position telle
  # quelle donnait une valeur périmée, corrigée d'un coup (souvent en
  # arrière) quand l'app finissait par la mettre à jour.
  $lastUpdatedMs = $null
  try {
    $lu = $timeline.LastUpdatedTime
    if ($lu -and $lu.Year -ge 2000) { $lastUpdatedMs = $lu.ToUnixTimeMilliseconds() }
  } catch { $lastUpdatedMs = $null }

  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])

  # Fenêtre de Spotify : son titre (« Artiste - Titre », « Advertisement » pendant
  # une pub) est mis à jour tout de suite, alors que SMTC peut rester sur le
  # morceau précédent. Lu UNIQUEMENT pour Spotify (coût : un Get-Process) ; vide
  # si la fenêtre est masquée (réduite dans la zone de notification).
  $windowTitle = $null
  if ($session.SourceAppUserModelId -match 'spotify') {
    try {
      $sp = Get-Process -Name 'Spotify' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1
      if ($sp) { $windowTitle = $sp.MainWindowTitle }
    } catch { $windowTitle = $null }
  }

  $artworkDataUri = $null
  $artworkError = $null
  $hasThumbnail = [bool]$props.Thumbnail
  if ($__params.includeArtwork -and $props.Thumbnail) {
    try {
      [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
      [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime] | Out-Null
      $stream = Await ($props.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
      $size = [int]$stream.Size
      # Garde-fou : une pochette ne devrait jamais dépasser quelques Mo ;
      # on préfère ne pas l'afficher plutôt que de bloquer sur un flux aberrant.
      if ($size -gt 0 -and $size -lt 5000000) {
        $reader = New-Object Windows.Storage.Streams.DataReader($stream)
        Await ($reader.LoadAsync([uint32]$size)) ([uint32]) | Out-Null
        $bytes = New-Object byte[] $size
        $reader.ReadBytes($bytes)
        $b64 = [Convert]::ToBase64String($bytes)
        $ct = $stream.ContentType
        if ([string]::IsNullOrWhiteSpace($ct)) { $ct = "image/png" }
        $artworkDataUri = "data:$ct;base64,$b64"
      }
    } catch {
      # Remontée volontaire du message d'erreur (plutôt qu'un simple null
      # silencieux) : c'est ce qui a permis de diagnostiquer et corriger
      # un premier bug (type WinRT IRandomAccessStreamWithContentType non
      # enregistré). Le renderer le journalise en console sans bloquer
      # l'affichage du titre/artiste pour autant.
      $artworkDataUri = $null
      $artworkError = $_.Exception.Message
    }
  }

  # PlaybackStatus WinRT : 0 Closed, 1 Opened, 2 Changing, 3 Stopped, 4 Playing, 5 Paused.
  # On distingue explicitement lecture / pause / arrêt plutôt qu'un simple booléen.
  $status = switch ([int]$playback.PlaybackStatus) {
    4 { 'playing' }
    5 { 'paused' }
    3 { 'stopped' }
    default { 'unknown' }
  }

  $result = [PSCustomObject]@{
    supported = $true
    preferredMissing = $false
    session   = [PSCustomObject]@{
      title         = $props.Title
      artist        = $props.Artist
      albumArtist   = $props.AlbumArtist
      album         = $props.AlbumTitle
      windowTitle   = $windowTitle
      sourceAppId   = $session.SourceAppUserModelId
      isPlaying     = ([int]$playback.PlaybackStatus -eq 4)
      playbackStatus = $status
      positionMs    = [math]::Round($timeline.Position.TotalMilliseconds)
      lastUpdatedMs = $lastUpdatedMs
      sampledAtMs   = $sampledAtMs
      durationMs    = [math]::Round($timeline.EndTime.TotalMilliseconds)
      artwork       = $artworkDataUri
      hasThumbnail  = $hasThumbnail
      artworkError  = $artworkError
    }
  }
  Emit $result
} catch {
  Emit ([PSCustomObject]@{ supported = $false; error = $_.Exception.Message })
}
`;

export interface RawSessionInfo {
  title: string;
  artist: string;
  albumArtist?: string | null;
  album: string | null;
  windowTitle?: string | null;
  sourceAppId: string | null;
  isPlaying: boolean;
  playbackStatus?: PlaybackStatus;
  positionMs: number;
  lastUpdatedMs?: number | null;
  sampledAtMs?: number | null;
  durationMs: number;
  artwork: string | null;
  hasThumbnail: boolean;
  artworkError: string | null;
}

export interface RawPsResult {
  supported: boolean;
  error?: string;
  /** true quand le lecteur choisi manuellement n'est pas (ou plus) actif. */
  preferredMissing?: boolean;
  session?: RawSessionInfo | null;
  sessions?: { sourceAppId: string | null; title: string; artist: string }[];
}

export function isPlatformSupported(): boolean {
  return process.platform === "win32";
}

/**
 * Construit le script complet en injectant les paramètres via une
 * variable PowerShell ($__params) plutôt que par interpolation directe
 * de chaînes dans le script : `preferredAppId` vient de Windows lui-même
 * (SourceAppUserModelId listé par listSystemMediaSessions) mais on reste
 * défensif quant à son contenu.
 */
export function buildScript(params: { preferredAppId?: string; includeArtwork?: boolean; listOnly?: boolean }): string {
  const json = JSON.stringify({
    preferredAppId: params.preferredAppId ?? "",
    includeArtwork: Boolean(params.includeArtwork),
    listOnly: Boolean(params.listOnly),
  }).replace(/'/g, "''"); // échappement du guillemet simple dans une chaîne PowerShell '...'
  return `$__params = '${json}' | ConvertFrom-Json\n${PS_SCRIPT}`;
}

/**
 * Décode la sortie brute de PowerShell en texte JSON.
 *  - Cas nominal : Base64 (voir Emit dans PS_SCRIPT) -> octets -> UTF-8.
 *    Tolère un BOM UTF-8 en tête (console en UTF-8 sur certains Windows) et
 *    tout blanc/retour à la ligne (CRLF final, retour à la ligne de la console) :
 *    ils n'appartiennent jamais à l'alphabet Base64 et doivent être ignorés.
 *  - Repli : JSON en clair (ancienne forme de sortie) décodé en UTF-8 strict,
 *    puis en Windows-1252 si les octets ne sont pas de l'UTF-8 valide, avec
 *    retrait d'un éventuel BOM. Ne renvoie jamais de "�" créé par un
 *    mauvais décodage de notre part.
 */
export function decodePowerShellOutput(output: Buffer | string): string {
  let buf = typeof output === "string" ? Buffer.from(output, "utf8") : output;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) buf = buf.subarray(3);

  // Base64 = ASCII pur : on peut l'inspecter en latin1 sans rien perdre.
  const compact = buf.toString("latin1").replace(/\s+/g, "");
  if (compact.length > 0 && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    const decoded = Buffer.from(compact, "base64").toString("utf8").replace(/^\uFEFF/, "").trim();
    // On n'accepte le résultat que s'il ressemble à notre JSON : un simple mot
    // ("null", "OK") est aussi du Base64 valide mais n'est pas notre sortie.
    if (decoded.startsWith("{") || decoded.startsWith("[")) return decoded;
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("windows-1252").decode(buf);
  }
  return text.replace(/^\uFEFF/, "").trim();
}

/**
 * Exécuteur de PowerShell (injectable) : `execFile` promisifié en production,
 * un double dans les tests. Il DOIT renvoyer des octets bruts (`encoding:
 * "buffer"`) — le décodage est notre affaire, jamais celle de Node.
 */
export type PowerShellExec = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean; encoding: "buffer"; maxBuffer: number }
) => Promise<{ stdout: Buffer }>;

const defaultExec: PowerShellExec = (file, args, options) => execFileAsync(file, args, options);

/**
 * Lance le script et décode sa sortie. Séparé de `runScript` uniquement pour
 * pouvoir être testé sans Windows : `runScript` reste le point d'entrée unique
 * de toute exécution PowerShell de l'app.
 */
export async function executePowerShell(script: string, exec: PowerShellExec): Promise<RawPsResult> {
  let stdout: Buffer;
  try {
    const res = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 5000,
      windowsHide: true,
      // Octets bruts : le décodage est fait par decodePowerShellOutput, jamais
      // par Node avec un encodage supposé.
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024, // une pochette encodée en base64 peut dépasser le buffer par défaut de 1 Mo
    });
    stdout = res.stdout;
  } catch (err) {
    throw new Error(
      `Impossible d'interroger les contrôles multimédias de Windows : ${(err as Error).message}`
    );
  }

  try {
    return JSON.parse(decodePowerShellOutput(stdout));
  } catch {
    throw new Error("Réponse inattendue de PowerShell lors de la lecture des contrôles multimédias.");
  }
}

async function runScript(script: string): Promise<RawPsResult> {
  if (!isPlatformSupported()) {
    throw new Error(
      "La lecture système n'est disponible que sur Windows (Global System Media Transport Controls)."
    );
  }
  return executePowerShell(script, defaultExec);
}

/** Au-delà de cet écart, LastUpdatedTime est jugé aberrant (valeur par défaut, horloge changée...). */
const MAX_EXTRAPOLATION_MS = 12 * 60 * 60 * 1000;

/**
 * Position du morceau à l'instant `sampledAtMs`.
 *
 * Windows fournit la position telle qu'elle était à `lastUpdatedMs` ; si la
 * lecture est en cours, on y ajoute le temps écoulé depuis. C'est ce que
 * fait le Volet multimédia de Windows lui-même. Garde-fous : jamais
 * d'extrapolation sans durée connue, ni avec un écart négatif/aberrant, ni
 * au-delà de la durée du morceau.
 */
export function resolvePosition(input: {
  positionMs: number;
  lastUpdatedMs?: number | null;
  sampledAtMs?: number | null;
  durationMs: number;
  isPlaying: boolean;
}): number {
  let position = Number.isFinite(input.positionMs) ? Math.max(0, input.positionMs) : 0;
  const { lastUpdatedMs, sampledAtMs, durationMs, isPlaying } = input;

  if (
    isPlaying &&
    durationMs > 0 &&
    typeof lastUpdatedMs === "number" &&
    typeof sampledAtMs === "number" &&
    Number.isFinite(lastUpdatedMs) &&
    Number.isFinite(sampledAtMs)
  ) {
    const age = sampledAtMs - lastUpdatedMs;
    if (age >= 0 && age <= Math.min(MAX_EXTRAPOLATION_MS, durationMs)) position += age;
  }

  return durationMs > 0 ? Math.min(position, durationMs) : position;
}

/**
 * Liste toutes les sessions multimédias actuellement enregistrées
 * auprès de Windows (une par app qui joue ou a joué récemment), pour
 * permettre à l'utilisateur de choisir explicitement son lecteur dans
 * Connections plutôt que de subir le choix "focus" de Windows.
 */
export async function listSystemMediaSessions(): Promise<SystemMediaSessionSummary[]> {
  const parsed = await runScript(buildScript({ listOnly: true }));
  if (!parsed.supported) {
    throw new Error(parsed.error ?? "Impossible de lister les lecteurs actifs sur ce système.");
  }
  return (parsed.sessions ?? []).map((s) => ({
    sourceAppId: s.sourceAppId || null,
    title: s.title || "",
    artist: s.artist || "",
  }));
}

/**
 * Interroge une fois l'état multimédia système courant (éventuellement
 * pour une session précise via `preferredAppId`). Retourne `null` si
 * rien ne joue plutôt que de lever une erreur : "personne n'écoute de
 * musique" n'est pas un cas d'échec.
 */
export async function getCurrentSystemMedia(options: GetCurrentOptions = {}): Promise<SystemNowPlaying | null> {
  const parsed = await runScript(buildScript(options));

  if (!parsed.supported) {
    throw new Error(
      parsed.error ?? "Les Global System Media Transport Controls ne sont pas disponibles sur ce système."
    );
  }

  if (!parsed.session) return null;

  const s = parsed.session;
  // Windows renvoie parfois une durée aberrante (TimeSpan.MaxValue) pour
  // les sources en direct/sans durée connue : on la ramène à 0 plutôt
  // que d'afficher une barre de progression absurde.
  const durationMs = Number.isFinite(s.durationMs) && s.durationMs < 24 * 60 * 60 * 1000 ? s.durationMs : 0;
  const isPlaying = Boolean(s.isPlaying);
  const sampledAtMs = typeof s.sampledAtMs === "number" && Number.isFinite(s.sampledAtMs) ? s.sampledAtMs : Date.now();

  return {
    title: s.title || "",
    artist: s.artist || "",
    albumArtist: s.albumArtist || null,
    album: s.album || null,
    windowTitle: s.windowTitle || null,
    sourceAppId: s.sourceAppId || null,
    isPlaying,
    playbackStatus: s.playbackStatus ?? (s.isPlaying ? "playing" : "paused"),
    positionMs: resolvePosition({
      positionMs: s.positionMs,
      lastUpdatedMs: s.lastUpdatedMs,
      sampledAtMs,
      durationMs,
      isPlaying,
    }),
    sampledAtMs,
    durationMs,
    artwork: s.artwork || null,
    hasThumbnail: Boolean(s.hasThumbnail),
    artworkError: s.artworkError || null,
  };
}
