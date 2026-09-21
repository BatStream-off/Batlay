import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, Link2, Music2, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { useMusicStore } from "@/stores/useMusicStore";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { LiveProgressFill, LiveTimeText } from "@/components/LiveProgress";
import { OverlayPreview } from "@/components/OverlayPreview";
import { Button, PageHeader, StatusPill } from "@/components/ui";
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

  // Même horloge que l'overlay OBS (voir src/utils/progress-clock.ts) : la
  // progression est lue à chaque image par les composants live, pas via un
  // état React rafraîchi toutes les 250 ms.
  const track = playbackState.track;
  const mainOverlay = pickMainOverlay(overlays, activeOverlayId);
  const ready = activeProviderId !== null && mainOverlay !== null && overlayServerRunning;

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title="Tableau de bord"
        subtitle="Tout ce qu'il faut pour afficher votre musique dans OBS, en trois étapes."
      />

      {!overlayServerRunning && (
        <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-warn">
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

      {/* --- Mise en route --- */}
      <section className="mt-6 rounded-xl2 border border-line bg-base-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Mise en route</h2>
          {ready && <StatusPill tone="ok"><Check size={11} /> Tout est prêt</StatusPill>}
        </div>
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

      {/* --- En cours de lecture --- */}
      <section className="mt-4 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">En cours de lecture</h2>

        {!track ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Music2 className="text-faint" size={36} />
            <p className="text-sm text-muted">Aucune musique en cours</p>
            <p className="text-xs text-faint">
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
          <div className="flex gap-5">
            {track.artwork ? (
              <img src={track.artwork} alt="" className="h-28 w-28 rounded-lg object-cover" />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-lg bg-base-800">
                <Music2 className="text-faint" size={28} />
              </div>
            )}
            <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
              <p className="truncate font-display text-lg font-semibold text-fg" title={track.title}>{track.title}</p>
              <p className="truncate text-sm text-muted" title={track.artist}>{track.artist}</p>

              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-700">
                  <LiveProgressFill
                    reader={playbackClock}
                    fallbackProgress={track.progress}
                    duration={track.duration}
                    // Suit la couleur d'accent choisie dans Paramètres (et non plus un violet figé).
                    fillStyle={{ backgroundColor: "rgb(var(--signal-500))", borderRadius: 9999 }}
                    trackStyle={{ borderRadius: 9999 }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-muted">
                  <LiveTimeText
                    reader={playbackClock}
                    fallbackProgress={track.progress}
                    duration={track.duration}
                    mode="elapsed"
                  />
                  <span>{formatTime(track.duration)}</span>
                </div>
              </div>
            </div>

            {activeProviderId === "demo" && (
              <div className="flex items-center gap-1.5 self-center">
                <Button variant="ghost" className="!rounded-full !p-2.5" onClick={() => demoProvider.previous()} aria-label="Morceau précédent">
                  <SkipBack size={16} />
                </Button>
                <Button
                  variant="secondary"
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
        )}
      </section>

      {/* --- Aperçu de l'overlay principal --- */}
      {mainOverlay && (
        <section className="mt-4 rounded-xl2 border border-line bg-base-900 p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Aperçu : {mainOverlay.name}</h2>
            <Button size="sm" onClick={() => navigate(`/editor/${mainOverlay.id}`)}>
              Modifier
            </Button>
          </div>
          {/* Fond de scène fixe : l'overlay se pose sur une vidéo, pas sur le fond de l'interface. */}
          <div className="relative aspect-[3/1] overflow-hidden rounded-lg bg-stage">
            <OverlayPreview
              overlay={mainOverlay}
              track={track ?? undefined}
              reader={track ? playbackClock : null}
              scale="fit"
            />
          </div>
          {!track && <p className="mt-2 text-xs text-faint">Morceau d'exemple : l'aperçu montrera votre musique dès qu'elle sera détectée.</p>}
        </section>
      )}
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
    <li className="flex items-center gap-4">
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          done ? "bg-live/15 text-ok" : "bg-base-800 text-muted"
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
