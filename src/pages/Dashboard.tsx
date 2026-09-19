import { useMusicStore } from "@/stores/useMusicStore";
import { Music2, Play, Pause } from "lucide-react";
import { useNow } from "@/hooks/useNow";
import { interpolateTrack } from "@/utils/interpolate-progress";

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function Dashboard() {
  const { playbackState, activeProviderId, demoProvider } = useMusicStore((s) => ({
    playbackState: s.playbackState,
    activeProviderId: s.activeProviderId,
    demoProvider: s.demoProvider,
  }));
  const track = interpolateTrack(playbackState, useNow());

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="font-display text-2xl font-semibold text-white">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">Aperçu de ce qui est actuellement diffusé.</p>

      <section className="mt-8 rounded-xl2 border border-base-800 bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">Currently Playing</h2>

        {!track ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <Music2 className="text-base-600" size={36} />
            <p className="text-sm text-muted">Nothing is playing</p>
            <p className="text-xs text-base-600">
              Connectez Spotify ou lancez le Mode Demo depuis la page Connections.
            </p>
          </div>
        ) : (
          <div className="flex gap-5">
            {track.artwork ? (
              <img src={track.artwork} alt="" className="h-28 w-28 rounded-lg object-cover" />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-lg bg-base-800">
                <Music2 className="text-base-600" size={28} />
              </div>
            )}
            <div className="flex flex-1 flex-col justify-center gap-1">
              <p className="font-display text-lg font-semibold text-white">{track.title}</p>
              <p className="text-sm text-muted">{track.artist}</p>

              <div className="mt-3">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-700">
                  <div
                    className="h-full rounded-full bg-signal-500 transition-[width]"
                    style={{ width: `${track.duration > 0 ? Math.min(100, (track.progress / track.duration) * 100) : 0}%` }}
                  />
                </div>
                <div className="mt-1.5 flex justify-between text-xs text-muted">
                  <span>{formatTime(track.progress)}</span>
                  <span>{formatTime(track.duration)}</span>
                </div>
              </div>
            </div>

            {activeProviderId === "demo" && (
              <button
                onClick={() => demoProvider.playPause()}
                className="self-center rounded-full bg-base-800 p-3 text-white transition hover:bg-base-700"
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
            className="rounded-lg border border-base-800 px-4 py-1.5 text-xs text-muted hover:text-white"
          >
            Previous
          </button>
          <button
            onClick={() => demoProvider.next()}
            className="rounded-lg border border-base-800 px-4 py-1.5 text-xs text-muted hover:text-white"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
