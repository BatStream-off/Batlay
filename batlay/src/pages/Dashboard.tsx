import { useMusicStore } from "@/stores/useMusicStore";
import { Music2, Play, Pause } from "lucide-react";
import { LiveProgressFill, LiveTimeText } from "@/components/LiveProgress";
import { playbackClock } from "@/services/playback-clock";
import { formatTime } from "@/utils/format-time";

export function Dashboard() {
  const { playbackState, activeProviderId, demoProvider } = useMusicStore((s) => ({
    playbackState: s.playbackState,
    activeProviderId: s.activeProviderId,
    demoProvider: s.demoProvider,
  }));
  // Même horloge que l'overlay OBS (voir src/utils/progress-clock.ts) : la
  // progression est lue à chaque image par les composants live, pas via un
  // état React rafraîchi toutes les 250 ms.
  const track = playbackState.track;

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="font-display text-2xl font-semibold text-fg">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Aperçu de ce qui est actuellement diffusé.</p>

      <section className="mt-8 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">Currently Playing</h2>

        {!track ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <Music2 className="text-faint" size={36} />
            <p className="text-sm text-muted">Nothing is playing</p>
            <p className="text-xs text-faint">
              Connectez Spotify ou lancez le Mode Demo depuis la page Connections.
            </p>
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
                    fillStyle={{ backgroundColor: "#9B6BFF", borderRadius: 9999 }}
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
              <button
                onClick={() => demoProvider.playPause()}
                className="self-center rounded-full bg-base-800 p-3 text-fg transition hover:bg-base-700"
                aria-label={track.isPlaying ? "Pause" : "Play"}
              >
                {track.isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
            )}
          </div>
        )}
      </section>

      {activeProviderId === "demo" && track && (
        <div className="mt-3 flex justify-center gap-3">
          <button
            onClick={() => demoProvider.previous()}
            className="rounded-lg border border-line px-4 py-1.5 text-xs text-muted hover:text-fg"
          >
            Previous
          </button>
          <button
            onClick={() => demoProvider.next()}
            className="rounded-lg border border-line px-4 py-1.5 text-xs text-muted hover:text-fg"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
