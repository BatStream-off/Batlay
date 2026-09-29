import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
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

  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime] | Out-Null

  $manager = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $sessions = $manager.GetSessions()

  if ($__params.listOnly) {
    $list = @()
    foreach ($s in $sessions) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $list += [PSCustomObject]@{ sourceAppId = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist }
    }
    [PSCustomObject]@{ supported = $true; sessions = $list } | ConvertTo-Json -Compress -Depth 4
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
    [PSCustomObject]@{ supported = $true; session = $null; preferredMissing = $preferredMissing } | ConvertTo-Json -Compress
    exit 0
  }

  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $playback = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()

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
      album         = $props.AlbumTitle
      sourceAppId   = $session.SourceAppUserModelId
      isPlaying     = ([int]$playback.PlaybackStatus -eq 4)
      playbackStatus = $status
      positionMs    = [math]::Round($timeline.Position.TotalMilliseconds)
      durationMs    = [math]::Round($timeline.EndTime.TotalMilliseconds)
      artwork       = $artworkDataUri
      hasThumbnail  = $hasThumbnail
      artworkError  = $artworkError
    }
  }
  $result | ConvertTo-Json -Compress -Depth 4
} catch {
  [PSCustomObject]@{ supported = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;
export function isPlatformSupported() {
    return process.platform === "win32";
}
/**
 * Construit le script complet en injectant les paramètres via une
 * variable PowerShell ($__params) plutôt que par interpolation directe
 * de chaînes dans le script : `preferredAppId` vient de Windows lui-même
 * (SourceAppUserModelId listé par listSystemMediaSessions) mais on reste
 * défensif quant à son contenu.
 */
function buildScript(params) {
    const json = JSON.stringify({
        preferredAppId: params.preferredAppId ?? "",
        includeArtwork: Boolean(params.includeArtwork),
        listOnly: Boolean(params.listOnly),
    }).replace(/'/g, "''"); // échappement du guillemet simple dans une chaîne PowerShell '...'
    return `$__params = '${json}' | ConvertFrom-Json\n${PS_SCRIPT}`;
}
async function runScript(script) {
    if (!isPlatformSupported()) {
        throw new Error("La lecture système n'est disponible que sur Windows (Global System Media Transport Controls).");
    }
    let stdout;
    try {
        const res = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
            timeout: 5000,
            windowsHide: true,
            maxBuffer: 10 * 1024 * 1024, // une pochette encodée en base64 peut dépasser le buffer par défaut de 1 Mo
        });
        stdout = res.stdout;
    }
    catch (err) {
        throw new Error(`Impossible d'interroger les contrôles multimédias de Windows : ${err.message}`);
    }
    try {
        return JSON.parse(stdout.trim());
    }
    catch {
        throw new Error("Réponse inattendue de PowerShell lors de la lecture des contrôles multimédias.");
    }
}
/**
 * Liste toutes les sessions multimédias actuellement enregistrées
 * auprès de Windows (une par app qui joue ou a joué récemment), pour
 * permettre à l'utilisateur de choisir explicitement son lecteur dans
 * Connections plutôt que de subir le choix "focus" de Windows.
 */
export async function listSystemMediaSessions() {
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
export async function getCurrentSystemMedia(options = {}) {
    const parsed = await runScript(buildScript(options));
    if (!parsed.supported) {
        throw new Error(parsed.error ?? "Les Global System Media Transport Controls ne sont pas disponibles sur ce système.");
    }
    if (!parsed.session)
        return null;
    const s = parsed.session;
    return {
        title: s.title || "",
        artist: s.artist || "",
        album: s.album || null,
        sourceAppId: s.sourceAppId || null,
        isPlaying: Boolean(s.isPlaying),
        playbackStatus: s.playbackStatus ?? (s.isPlaying ? "playing" : "paused"),
        positionMs: Number.isFinite(s.positionMs) ? s.positionMs : 0,
        // Windows renvoie parfois une durée aberrante (TimeSpan.MaxValue) pour
        // les sources en direct/sans durée connue : on la ramène à 0 plutôt
        // que d'afficher une barre de progression absurde.
        durationMs: Number.isFinite(s.durationMs) && s.durationMs < 24 * 60 * 60 * 1000 ? s.durationMs : 0,
        artwork: s.artwork || null,
        hasThumbnail: Boolean(s.hasThumbnail),
        artworkError: s.artworkError || null,
    };
}
//# sourceMappingURL=system-media.js.map