import { Link, NavLink, useLocation } from "react-router-dom";
import { ArrowUpCircle, Link2, LayoutDashboard, Layers, PanelLeftClose, PanelLeftOpen, Plug, SlidersHorizontal } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useMusicStore } from "@/stores/useMusicStore";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useUpdateStore } from "@/stores/useUpdateStore";
import { useCopyObsUrl } from "@/hooks/useCopyObsUrl";
import { pickMainOverlay } from "@/utils/ui-helpers";

const NAV_ITEMS = [
  { to: "/", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/overlays", label: "Overlays", icon: Layers },
  { to: "/connections", label: "Connexions", icon: Plug },
  { to: "/settings", label: "Paramètres", icon: SlidersHorizontal },
];

const SOURCE_LABELS: Record<string, string> = {
  spotify: "Spotify connecté",
  demo: "Mode démo",
  "system-media": "Lecture système",
};

interface SidebarProps {
  /** Version étroite (icônes seules) : rend de la place à l'éditeur. */
  compact: boolean;
  /** Affiché seulement dans l'éditeur, où la barre se réduit toute seule. */
  onToggleCompact?: () => void;
}

export function Sidebar({ compact, onToggleCompact }: SidebarProps) {
  const { pathname } = useLocation();
  const overlayServerRunning = useSettingsStore((s) => s.overlayServerRunning);
  const activeProviderId = useMusicStore((s) => s.activeProviderId);
  const { overlays, activeOverlayId } = useOverlayStore((s) => ({ overlays: s.overlays, activeOverlayId: s.activeOverlayId }));
  const isPlaying = useMusicStore((s) => s.playbackState.track?.isPlaying ?? false);
  const updateStatus = useUpdateStore((s) => s.status);
  const updateReady = updateStatus.state === "available" || updateStatus.state === "downloaded";
  const updateVersion = updateStatus.state === "available" || updateStatus.state === "downloaded" ? updateStatus.version : "";
  const copyObsUrl = useCopyObsUrl();
  const mainOverlay = pickMainOverlay(overlays, activeOverlayId);

  const sourceLabel = activeProviderId ? (SOURCE_LABELS[activeProviderId] ?? activeProviderId) : "Aucune source";

  return (
    <aside
      className={`relative z-10 flex shrink-0 flex-col border-r border-line bg-base-900/80 backdrop-blur-xl transition-[width] duration-300 ${compact ? "w-16" : "w-60"}`}
    >
      <div className={`flex items-center py-6 ${compact ? "justify-center px-2" : "justify-between px-5"}`}>
        <span className="flex items-center gap-2.5">
          {/* Trois barres d'égaliseur : la marque reste lisible même quand la barre est réduite. */}
          <span
            className="btn-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            aria-hidden="true"
          >
            {/* Trois barres d'égaliseur : elles dansent quand un morceau est en lecture. */}
            <svg viewBox="0 0 16 16" className={`h-[18px] w-[18px] ${isPlaying ? "" : "eq-paused"}`} fill="currentColor">
              <rect className="eq-bar" x="2" y="7" width="2.5" height="7" rx="1.25" />
              <rect className="eq-bar" x="6.75" y="2" width="2.5" height="12" rx="1.25" />
              <rect className="eq-bar" x="11.5" y="5" width="2.5" height="9" rx="1.25" />
            </svg>
          </span>
          <span className={compact ? "sr-only" : "text-gradient font-display text-xl font-bold tracking-tight"}>Batlay</span>
        </span>
        {onToggleCompact && !compact && (
          <button
            onClick={onToggleCompact}
            className="rounded-md p-1 text-muted hover:bg-base-800 hover:text-fg"
            title="Réduire la barre latérale"
            aria-label="Réduire la barre latérale"
          >
            <PanelLeftClose size={16} />
          </button>
        )}
      </div>

      <nav className={`flex flex-1 flex-col gap-1 ${compact ? "px-2" : "px-3"}`} aria-label="Navigation principale">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            title={compact ? label : undefined}
            aria-label={compact ? label : undefined}
            className={({ isActive }) => {
              // L'éditeur fait partie de « Overlays » : sans ça, aucun onglet ne serait allumé pendant l'édition.
              const active = isActive || (to === "/overlays" && pathname.startsWith("/editor"));
              return `group relative flex items-center rounded-xl py-2.5 text-sm font-medium transition ${
                compact ? "justify-center px-0" : "gap-3 px-3"
              } ${
                active
                  ? "bg-gradient-to-r from-signal-600/25 via-signal-600/10 to-transparent text-fg"
                  : "text-muted hover:bg-base-800/70 hover:text-fg"
              }`;
            }}
          >
            {({ isActive }) => {
              const active = isActive || (to === "/overlays" && pathname.startsWith("/editor"));
              return (
                <>
                  {/* Repère d'onglet actif : une barre lumineuse sur le bord gauche. */}
                  <span
                    className={`absolute top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-signal-500 shadow-[0_0_12px_rgb(var(--signal-500))] transition-all ${
                      compact ? "-left-2" : "-left-3"
                    } ${active ? "opacity-100" : "scale-y-50 opacity-0"}`}
                    aria-hidden="true"
                  />
                  <Icon size={18} strokeWidth={active ? 2.25 : 2} className={active ? "text-accent" : "transition group-hover:text-fg"} />
                  {!compact && label}
                </>
              );
            }}
          </NavLink>
        ))}
      </nav>

      <div className={`space-y-2.5 border-t border-line py-4 text-xs text-muted ${compact ? "px-2" : "px-3"}`}>
        {updateReady && (
          <Link
            to="/settings"
            title={`Mise à jour ${updateVersion} disponible`}
            aria-label={`Mise à jour ${updateVersion} disponible`}
            className={`btn-primary flex w-full items-center rounded-xl text-left transition ${
              compact ? "justify-center py-2" : "gap-2.5 px-3 py-2"
            }`}
          >
            <ArrowUpCircle size={compact ? 15 : 14} className="shrink-0" />
            {!compact && (
              <span className="min-w-0">
                <span className="block text-xs font-semibold">Mise à jour disponible</span>
                <span className="block truncate text-[11px] opacity-80">{updateVersion ? `Version ${updateVersion}` : "Nouvelle version"}</span>
              </span>
            )}
          </Link>
        )}
        {mainOverlay && !compact && (
          <button
            onClick={() => void copyObsUrl(mainOverlay.id)}
            className="btn-secondary flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-fg transition"
            title={`Copier l'URL OBS de « ${mainOverlay.name} »`}
          >
            <Link2 size={14} className="shrink-0 text-accent" />
            <span className="min-w-0">
              <span className="block text-xs font-medium">Copier l'URL OBS</span>
              <span className="block truncate text-[11px] text-muted">{mainOverlay.name}</span>
            </span>
          </button>
        )}
        {mainOverlay && compact && (
          <button
            onClick={() => void copyObsUrl(mainOverlay.id)}
            className="btn-secondary flex w-full items-center justify-center rounded-xl py-2 text-accent transition"
            title={`Copier l'URL OBS de « ${mainOverlay.name} »`}
            aria-label="Copier l'URL OBS"
          >
            <Link2 size={15} />
          </button>
        )}

        <StatusLink
          to="/settings"
          compact={compact}
          dotClass={overlayServerRunning ? "dot-live" : "bg-red-500"}
          label={overlayServerRunning ? "Serveur d'overlay en ligne" : "Serveur d'overlay hors ligne"}
        />
        <StatusLink
          to="/connections"
          compact={compact}
          dotClass={activeProviderId ? "dot-live" : "bg-amber-400"}
          label={sourceLabel}
        />

        {onToggleCompact && compact && (
          <button
            onClick={onToggleCompact}
            className="flex w-full items-center justify-center rounded-lg py-1.5 text-muted hover:bg-base-800 hover:text-fg"
            title="Agrandir la barre latérale"
            aria-label="Agrandir la barre latérale"
          >
            <PanelLeftOpen size={16} />
          </button>
        )}
      </div>
    </aside>
  );
}

/** Ligne d'état cliquable : mène à la page où l'on peut corriger le problème. */
function StatusLink({ to, dotClass, label, compact }: { to: string; dotClass: string; label: string; compact: boolean }) {
  return (
    <Link
      to={to}
      title={label}
      aria-label={label}
      className={`flex items-center rounded-lg px-1.5 py-1 transition hover:bg-base-800/60 hover:text-fg ${compact ? "justify-center" : "gap-2.5"}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  );
}
