import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, Link2, Music2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useMusicStore } from "@/stores/useMusicStore";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { LiveProgressFill, LiveTimeText } from "@/components/LiveProgress";
import { OverlayPreview } from "@/components/OverlayPreview";
import { Button, PageHeader, SectionTitle, StatusPill } from "@/components/ui";
import { useCopyObsUrl } from "@/hooks/useCopyObsUrl";
import { playbackClock } from "@/services/playback-clock";
import { formatTime } from "@/utils/format-time";
import { pickMainOverlay } from "@/utils/ui-helpers";

const SOURCE_LABELS: Record<string, string> = {
  spotify: "Spotify",
  demo: "Mode démo",
  "system-media": "Lecture système Windows",
};

export function Dashboard() {
  const navigate = useNavigate();
  const { playbackState, activeProviderId, demoProvider } = useMusicStore((s) => ({
    playbackState: s.playbackState,
    activeProviderId: s.activeProviderId,
    demoProvider: s.demoProvider,
  }));
  const { overlays, activeOverlayId } = useOverlayStore((s) => ({ overlays: s.overlays, activeOverlayId: s.activeOverlayId }));
  const overlayServerRunning = useSettingsStore((s) => s.overlayServerRunning);
  const copyObsUrl = useCopyObsUrl();
  // Une fois tout configuré, le guide se replie : il ne sert plus qu'à la première installation.
  const [stepsOpen, setStepsOpen] = useState(false);

  // Même horloge que l'overlay OBS (voir src/utils/progress-clock.ts) : la
  // progression est lue à chaque image par les composants live, pas via un
  // état React rafraîchi toutes les 250 ms.
  const track = playbackState.track;
  const mainOverlay = pickMainOverlay(overlays, activeOverlayId);
  const ready = activeProviderId !== null && mainOverlay !== null && overlayServerRunning;
  const showSteps = !ready || stepsOpen;

  return (
    <div className="stagger mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title="Tableau de bord"
        subtitle={
          ready
            ? "Votre musique est prête à être affichée dans OBS."
            : "Tout ce qu'il faut pour afficher votre musique dans OBS, en trois étapes."
        }
      />

      {!overlayServerRunning && (
        <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-gradient-to-r from-amber-500/15 to-amber-500/5 px-4 py-3 text-sm text-warn">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <p>
            Le serveur d'overlay est hors ligne : OBS ne pourra pas afficher l'overlay. Le port est peut-être déjà utilisé —
            changez-le dans{" "}
            <button onClick={() => navigate("/settings")} className="underline hover:text-fg">
              Paramètres
            </button>
            .
          </p>
        </div>
      )}

      {/* --- Prêt : une seule ligne, l'action utile (copier l'URL) au premier plan --- */}
      {ready && mainOverlay && (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-live/30 bg-gradient-to-r from-live/15 via-live/5 to-transparent px-4 py-3 shadow-[0_0_40px_-16px_rgb(55_226_154/0.6)]">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-live/20 text-ok ring-1 ring-live/40">
            <Check size={14} />
          </span>
          <p className="min-w-0 flex-1 text-sm text-fg">
            Tout est prêt. Collez l'URL de <span className="font-medium">{mainOverlay.name}</span> dans une source « Navigateur »
            d'OBS ({mainOverlay.theme.canvasWidth} × {mainOverlay.theme.canvasHeight}).
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="sm" aria-expanded={stepsOpen} onClick={() => setStepsOpen((open) => !open)}>
              {stepsOpen ? "Masquer les étapes" : "Revoir les étapes"}
            </Button>
            <Button variant="primary" size="sm" onClick={() => void copyObsUrl(mainOverlay.id)}>
              <Link2 size={13} /> Copier l'URL OBS
            </Button>
          </div>
        </div>
      )}

      {/* --- Mise en route : c'est bien une suite d'étapes, d'où la numérotation --- */}
      {showSteps && (
        <section className="mt-6 card p-6">
          <SectionTitle className="mb-5" hint="À faire dans l'ordre, une seule fois.">
            Mise en route
          </SectionTitle>
          <ol className="space-y-4">
            <Step
              number={1}
              done={activeProviderId !== null}
              title="Choisir la source musicale"
              detail={
                activeProviderId
                  ? `Source active : ${SOURCE_LABELS[activeProviderId] ?? activeProviderId}`
                  : "Lecture système, Spotify ou mode démo pour tester sans compte."
              }
              action={
                activeProviderId ? null : (
                  <Button size="sm" variant="primary" onClick={() => navigate("/connections")}>
                    Choisir <ArrowRight size={13} />
                  </Button>
                )
              }
            />
            <Step
              number={2}
              done={mainOverlay !== null}
              title="Créer ou choisir un overlay"
              detail={mainOverlay ? `Overlay principal : ${mainOverlay.name}` : "Partez d'un preset, puis ajustez-le dans l'éditeur."}
              action={
                mainOverlay ? (
                  <Button size="sm" onClick={() => navigate(`/editor/${mainOverlay.id}`)}>
                    Modifier
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" onClick={() => navigate("/overlays")}>
                    Créer <ArrowRight size={13} />
                  </Button>
                )
              }
            />
            <Step
              number={3}
              done={false}
              title="Ajouter l'overlay dans OBS"
              detail={
                mainOverlay
                  ? `Sources → + → Navigateur, collez l'URL et réglez la taille sur ${mainOverlay.theme.canvasWidth} × ${mainOverlay.theme.canvasHeight}.`
                  : "Disponible dès qu'un overlay existe."
              }
              action={
                <Button
                  size="sm"
                  variant={mainOverlay ? "primary" : "secondary"}
                  disabled={!mainOverlay}
                  onClick={() => mainOverlay && void copyObsUrl(mainOverlay.id)}
                >
                  <Link2 size={13} /> Copier l'URL
                </Button>
              }
            />
          </ol>
        </section>
      )}

      {/* --- En cours de lecture : le morceau d'abord, puis ce que verra OBS --- */}
      <section className="card mt-4 overflow-hidden">
        {/* Halo : la pochette, agrandie et floutée, teinte toute la carte. */}
        {track?.artwork && (
          <img
            src={track.artwork}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute -top-10 left-0 h-72 w-full scale-125 object-cover opacity-30 blur-3xl saturate-150"
          />
        )}
        <div className="relative p-6">
          <SectionTitle
            className="mb-5"
            actions={
              track ? (
                <StatusPill tone={track.isPlaying ? "ok" : "neutral"}>
                  <svg viewBox="0 0 16 16" className={`h-3 w-3 ${track.isPlaying ? "" : "eq-paused"}`} fill="currentColor" aria-hidden="true">
                    <rect className="eq-bar" x="2" y="7" width="3" height="7" rx="1.5" />
                    <rect className="eq-bar" x="6.5" y="2" width="3" height="12" rx="1.5" />
                    <rect className="eq-bar" x="11" y="5" width="3" height="9" rx="1.5" />
                  </svg>
                  {track.isPlaying ? "En lecture" : "En pause"}
                </StatusPill>
              ) : null
            }
          >
            En cours de lecture
          </SectionTitle>

          {!track ? (
            <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
              <Music2 className="text-faint" size={36} />
              <p className="text-sm text-muted">Aucune musique en cours</p>
              <p className="max-w-sm text-xs text-faint">
                {activeProviderId
                  ? "Lancez un morceau dans votre lecteur : il apparaîtra ici."
                  : "Choisissez une source dans « Connexions » pour afficher votre musique."}
              </p>
              {!activeProviderId && (
                <Button size="sm" onClick={() => navigate("/connections")}>
                  Ouvrir Connexions
                </Button>
              )}
            </div>
          ) : (
            <div className="flex gap-6">
              {track.artwork ? (
                <img src={track.artwork} alt="" className="h-40 w-40 shrink-0 rounded-2xl object-cover shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] ring-1 ring-white/10" />
              ) : (
                <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-base-700 to-base-800 ring-1 ring-base-700">
                  <Music2 className="text-faint" size={36} />
                </div>
              )}
              <div className="flex min-w-0 flex-1 flex-col justify-center">
                <p className="text-gradient truncate font-display text-3xl font-bold leading-tight tracking-tight" title={track.title}>
                  {track.title}
                </p>
                <p className="mt-1 truncate text-base text-muted" title={track.artist}>
                  {track.artist}
                </p>
                {(track.album || track.source) && (
                  <p className="mt-0.5 truncate text-xs text-faint">
                    {[track.album, track.source && `via ${track.source}`].filter(Boolean).join(", ")}
                  </p>
                )}

                <div className="mt-5">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-base-700/80 shadow-inner">
                    <LiveProgressFill
                      reader={playbackClock}
                      fallbackProgress={track.progress}
                      duration={track.duration}
                      // Suit la couleur d'accent choisie dans Paramètres (et non plus un violet figé).
                      fillStyle={{
                        backgroundImage: "linear-gradient(90deg, rgb(var(--signal-600)), rgb(var(--signal-400)))",
                        boxShadow: "0 0 14px rgb(var(--signal-500) / 0.8)",
                        borderRadius: 9999,
                      }}
                      trackStyle={{ borderRadius: 9999 }}
                    />
                  </div>
                  <div className="mt-1.5 flex justify-between text-xs tabular-nums text-muted">
                    <LiveTimeText
                      reader={playbackClock}
                      fallbackProgress={track.progress}
                      duration={track.duration}
                      mode="elapsed"
                    />
                    <span>{formatTime(track.duration)}</span>
                  </div>
                </div>

                {activeProviderId === "demo" && (
                  <div className="mt-3 flex items-center gap-1.5">
                    <Button variant="ghost" className="!rounded-full !p-2.5" onClick={() => demoProvider.previous()} aria-label="Morceau précédent">
                      <SkipBack size={16} />
                    </Button>
                    <Button
                      variant="primary"
                      className="!rounded-full !p-3"
                      onClick={() => demoProvider.playPause()}
                      aria-label={track.isPlaying ? "Pause" : "Lecture"}
                    >
                      {track.isPlaying ? <Pause size={18} /> : <Play size={18} />}
                    </Button>
                    <Button variant="ghost" className="!rounded-full !p-2.5" onClick={() => demoProvider.next()} aria-label="Morceau suivant">
                      <SkipForward size={16} />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Aperçu de l'overlay principal : ce que reçoit OBS, dans la même carte que le morceau. */}
        {mainOverlay && (
          <div className="border-t border-line p-6">
            <SectionTitle
              className="mb-4"
              hint="Rendu de l'overlay principal."
              actions={
                <Button size="sm" onClick={() => navigate(`/editor/${mainOverlay.id}`)}>
                  Modifier
                </Button>
              }
            >
              {mainOverlay.name}
            </SectionTitle>
            {/* Fond de scène fixe : l'overlay se pose sur une vidéo, pas sur le fond de l'interface. */}
            <div className="relative aspect-[3/1] overflow-hidden rounded-xl bg-stage ring-1 ring-base-700 shadow-[inset_0_2px_24px_rgba(0,0,0,0.5)]">
              <OverlayPreview
                overlay={mainOverlay}
                track={track ?? undefined}
                reader={track ? playbackClock : null}
                scale="fit"
              />
            </div>
            {!track && <p className="mt-2 text-xs text-faint">Morceau d'exemple : l'aperçu montrera votre musique dès qu'elle sera détectée.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function Step({
  number,
  done,
  title,
  detail,
  action,
}: {
  number: number;
  done: boolean;
  title: string;
  detail: string;
  action: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-4 rounded-xl px-2 py-1.5 transition hover:bg-base-800/40">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? "bg-live/15 text-ok ring-1 ring-live/40" : "bg-base-800 text-muted ring-1 ring-base-700"
        }`}
      >
        {done ? <Check size={14} /> : number}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="text-xs text-muted">{detail}</p>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </li>
  );
}
