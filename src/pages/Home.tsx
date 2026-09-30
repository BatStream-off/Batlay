import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowRight, Check, Copy, MessageSquare, Music2 } from "lucide-react";
import { useMusicStore } from "@/stores/useMusicStore";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useTwitchStore } from "@/stores/useTwitchStore";
import { useToastStore } from "@/stores/useToastStore";
import { useCopyObsUrl } from "@/hooks/useCopyObsUrl";
import { Button, PageHeader, StatusPill } from "@/components/ui";
import { pickMainOverlay } from "@/utils/ui-helpers";
import { channelLabel, chatStatus, isOtherChannel } from "@/utils/twitch-ui";

const SOURCE_LABELS: Record<string, string> = {
  spotify: "Spotify",
  demo: "Mode démo",
  "system-media": "Lecture système",
};

type Tone = "ok" | "warn" | "bad" | "idle";
const DOT: Record<Tone, string> = { ok: "dot-live", warn: "bg-amber-400", bad: "bg-red-500", idle: "bg-base-700" };

interface Check {
  label: string;
  value: string;
  tone: Tone;
}
interface Issue {
  text: string;
  to: string;
  cta: string;
}

/**
 * Vue d'ensemble : l'état des deux overlays en un coup d'œil. Chacun a sa carte (ce qu'il affiche en ce moment,
 * ses points de contrôle, son action principale) ; aucun ne dépend de l'autre. Ce qui reste à régler est
 * regroupé en une liste d'actions, ou remplacé par une confirmation quand tout est prêt.
 */
export function Home() {
  const navigate = useNavigate();
  const { activeProviderId, track } = useMusicStore((s) => ({ activeProviderId: s.activeProviderId, track: s.playbackState.track }));
  const { overlays, activeOverlayId } = useOverlayStore((s) => ({ overlays: s.overlays, activeOverlayId: s.activeOverlayId }));
  const { settings, musicServerUp } = useSettingsStore((s) => ({ settings: s.settings, musicServerUp: s.overlayServerRunning }));
  const twitch = useTwitchStore((s) => s.state);
  const push = useToastStore((s) => s.push);
  const copyMusicUrl = useCopyObsUrl();

  const mainOverlay = pickMainOverlay(overlays, activeOverlayId);
  const chat = chatStatus(twitch);
  const musicReady = musicServerUp && activeProviderId !== null && mainOverlay !== null;
  const chatReady = twitch.server.running && twitch.status === "connected" && twitch.chat === "live";
  const twitchConnected = twitch.status === "connected";

  async function copyChatUrl() {
    try {
      await navigator.clipboard.writeText(twitch.server.overlayUrl);
      push("URL du chat copiée — collez-la dans une source « Navigateur » d'OBS.", "success");
    } catch {
      push("Copie impossible : sélectionnez l'URL dans la page Chat Twitch.", "error");
    }
  }

  const musicChecks: Check[] = [
    { label: "Serveur", value: musicServerUp ? `En ligne, port ${settings?.overlayServerPort ?? "…"}` : "Hors ligne", tone: musicServerUp ? "ok" : "bad" },
    { label: "Source", value: activeProviderId ? (SOURCE_LABELS[activeProviderId] ?? activeProviderId) : "Aucune", tone: activeProviderId ? "ok" : "warn" },
    { label: "Overlay", value: mainOverlay ? mainOverlay.name : "Aucun", tone: mainOverlay ? "ok" : "warn" },
  ];
  const chatChecks: Check[] = [
    { label: "Serveur", value: twitch.server.running ? `En ligne, port ${twitch.server.port}` : "Hors ligne", tone: twitch.server.running ? "ok" : "bad" },
    { label: "Compte", value: twitch.account ? twitch.account.displayName : "Non connecté", tone: twitchConnected ? "ok" : "warn" },
    { label: "Sources OBS", value: String(twitch.overlayClients), tone: twitch.overlayClients > 0 ? "ok" : "idle" },
  ];

  const issues: Issue[] = [];
  if (!musicServerUp) issues.push({ text: "Le serveur de l'overlay musical est hors ligne (port déjà utilisé ?).", to: "/settings", cta: "Changer le port" });
  if (!activeProviderId) issues.push({ text: "Aucune source musicale n'est choisie.", to: "/connections", cta: "Choisir une source" });
  if (!mainOverlay) issues.push({ text: "Aucun overlay musical n'existe encore.", to: "/overlays", cta: "Créer un overlay" });
  if (!twitch.server.running) issues.push({ text: "Le serveur du chat est hors ligne.", to: "/chat", cta: "Voir le détail" });
  else if (!twitchConnected) issues.push({ text: "Twitch n'est pas connecté : le chat ne peut pas s'afficher.", to: "/chat", cta: "Connecter Twitch" });
  else if (twitch.error) issues.push({ text: twitch.error.message, to: "/chat", cta: "Corriger" });

  const allReady = musicReady && chatReady;

  return (
    <div className="stagger mx-auto max-w-4xl px-8 py-10">
      <PageHeader
        title="Vue d'ensemble"
        subtitle="Deux overlays indépendants, à ajouter séparément dans OBS. Ils fonctionnent en même temps."
      />

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {/* --- Musique --- */}
        <OverlayCard
          icon={<Music2 size={18} />}
          title="Musique"
          status={<StatusPill tone={musicReady ? "ok" : "warn"}>{musicReady ? "● Prêt" : "À configurer"}</StatusPill>}
          backdrop={track?.artwork ?? null}
          hero={
            <div className="flex items-center gap-4">
              {track?.artwork ? (
                <img src={track.artwork} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover shadow-[0_12px_28px_-10px_rgba(0,0,0,0.7)] ring-1 ring-white/10" />
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-base-700 to-base-800 ring-1 ring-base-700">
                  <Music2 size={22} className="text-faint" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                {track ? (
                  <>
                    <p className="truncate font-display text-lg font-semibold leading-tight text-fg" title={track.title}>
                      {track.title}
                    </p>
                    <p className="truncate text-sm text-muted" title={track.artist}>
                      {track.artist}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
                      <svg viewBox="0 0 16 16" className={`h-3 w-3 ${track.isPlaying ? "text-accent" : "eq-paused"}`} fill="currentColor" aria-hidden="true">
                        <rect className="eq-bar" x="2" y="7" width="3" height="7" rx="1.5" />
                        <rect className="eq-bar" x="6.5" y="2" width="3" height="12" rx="1.5" />
                        <rect className="eq-bar" x="11" y="5" width="3" height="9" rx="1.5" />
                      </svg>
                      {track.isPlaying ? "En lecture" : "En pause"}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-fg">Aucune musique en cours</p>
                    <p className="text-xs text-muted">Lancez un morceau dans votre lecteur : il apparaîtra ici.</p>
                  </>
                )}
              </div>
            </div>
          }
          checks={musicChecks}
          actions={
            <>
              <Button size="sm" disabled={!mainOverlay || !musicServerUp} onClick={() => mainOverlay && void copyMusicUrl(mainOverlay.id)}>
                <Copy size={14} /> Copier l'URL OBS
              </Button>
              <Button size="sm" variant="primary" onClick={() => navigate("/musique")}>
                Lecture en cours <ArrowRight size={13} />
              </Button>
            </>
          }
        />

        {/* --- Chat --- */}
        <OverlayCard
          icon={<MessageSquare size={18} />}
          title="Chat Twitch"
          status={<StatusPill tone={chatReady || chat.tone === "ok" ? "ok" : "warn"}>{chatReady ? "● En direct" : chat.label}</StatusPill>}
          backdrop={null}
          hero={
            <div className="flex items-center gap-4">
              <ChannelAvatar name={channelLabel(twitch)} url={twitch.channel?.profileImageUrl ?? twitch.account?.profileImageUrl ?? null} />
              <div className="min-w-0 flex-1">
                {twitchConnected || twitch.channelLogin ? (
                  <>
                    <p className="truncate font-display text-lg font-semibold leading-tight text-fg" title={channelLabel(twitch)}>
                      {channelLabel(twitch)}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {twitch.channel ? `@${twitch.channel.login}` : twitch.channelLogin ? `@${twitch.channelLogin}` : ""}
                      {isOtherChannel(twitch) ? " · autre chaîne" : ""}
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-faint">
                      <span className={`h-2 w-2 rounded-full ${chatReady ? "dot-live" : "bg-amber-400"}`} aria-hidden="true" />
                      {chat.label.replace("● ", "")}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-medium text-fg">Aucune chaîne affichée</p>
                    <p className="text-xs text-muted">Connectez Twitch pour afficher le chat de votre chaîne, ou d'une autre.</p>
                  </>
                )}
              </div>
            </div>
          }
          checks={chatChecks}
          actions={
            <>
              <Button size="sm" disabled={!twitch.server.running} onClick={() => void copyChatUrl()}>
                <Copy size={14} /> Copier l'URL OBS
              </Button>
              <Button size="sm" variant="primary" onClick={() => navigate("/chat")}>
                Chat Twitch <ArrowRight size={13} />
              </Button>
            </>
          }
        />
      </div>

      {/* --- Ce qui reste à faire, ou confirmation --- */}
      {issues.length > 0 ? (
        <section className="card mt-4 p-5" aria-label="À régler">
          <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
            <AlertTriangle size={16} className="text-warn" aria-hidden="true" />
            {issues.length === 1 ? "Une chose à régler" : `${issues.length} choses à régler`}
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {issues.map((issue) => (
              <li key={issue.text} className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <p className="min-w-0 text-sm text-muted">{issue.text}</p>
                <Button size="sm" className="shrink-0" onClick={() => navigate(issue.to)}>
                  {issue.cta}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div
          className={`mt-4 flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
            allReady ? "border-live/30 bg-gradient-to-r from-live/15 via-live/5 to-transparent text-fg" : "border-line text-muted"
          }`}
        >
          {allReady && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-live/20 text-ok ring-1 ring-live/40">
              <Check size={14} />
            </span>
          )}
          <p>
            {allReady ? "Tout est prêt. " : ""}
            Dans OBS, ajoutez une source « Navigateur » par overlay : l'une avec l'URL Musique, l'autre avec l'URL Chat.
            Arrêter l'un n'affecte pas l'autre.
          </p>
        </div>
      )}
    </div>
  );
}

function OverlayCard({
  icon,
  title,
  status,
  backdrop,
  hero,
  checks,
  actions,
}: {
  icon: ReactNode;
  title: string;
  status: ReactNode;
  /** Image floutée qui teinte la carte (pochette du morceau en cours). */
  backdrop: string | null;
  hero: ReactNode;
  checks: Check[];
  actions: ReactNode;
}) {
  return (
    <section className="card flex flex-col overflow-hidden" aria-label={title}>
      {backdrop && (
        <img
          src={backdrop}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute -top-8 left-0 h-48 w-full scale-125 object-cover opacity-25 blur-3xl saturate-150"
        />
      )}
      <div className="relative flex flex-1 flex-col p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-fg">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-signal-600/15 text-accent ring-1 ring-signal-600/25">{icon}</span>
            {title}
          </h2>
          {status}
        </div>

        <div className="mt-5">{hero}</div>

        <dl className="mt-5 flex-1 space-y-2.5 border-t border-line pt-4 text-sm">
          {checks.map(({ label, value, tone }) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="flex min-w-0 items-center gap-2 text-fg" title={value}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[tone]}`} aria-hidden="true" />
                <span className="truncate">{value}</span>
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-5 flex flex-wrap justify-end gap-2">{actions}</div>
      </div>
    </section>
  );
}

/** Photo de profil de la chaîne, ou son initiale tant qu'elle manque ou ne charge pas. */
function ChannelAvatar({ name, url }: { name: string; url: string | null }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return <img src={url} alt="" onError={() => setFailed(true)} className="h-16 w-16 shrink-0 rounded-full object-cover ring-1 ring-white/10" />;
  }
  return (
    <span className="btn-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-full font-display text-2xl font-bold" aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
