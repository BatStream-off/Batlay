import { Link, NavLink, useLocation } from "react-router-dom";
import { Link2, LayoutDashboard, Layers, PanelLeftClose, PanelLeftOpen, Plug, SlidersHorizontal } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useMusicStore } from "@/stores/useMusicStore";
import { useOverlayStore } from "@/stores/useOverlayStore";
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
  const copyObsUrl = useCopyObsUrl();
  const mainOverlay = pickMainOverlay(overlays, activeOverlayId);

  const sourceLabel = activeProviderId ? (SOURCE_LABELS[activeProviderId] ?? activeProviderId) : "Aucune source";

  return (
    <aside className={`flex shrink-0 flex-col border-r border-line bg-base-900 transition-[width] ${compact ? "w-16" : "w-60"}`}>
      <div className={`flex items-center py-6 ${compact ? "justify-center px-2" : "justify-between px-5"}`}>
        <span className="font-display text-xl font-bold tracking-tight text-fg">{compact ? "B" : "Batlay"}</span>
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
              return `flex items-center rounded-lg py-2.5 text-sm font-medium transition ${
                compact ? "justify-center px-0" : "gap-3 px-3"
              } ${active ? "bg-base-800 text-fg" : "text-muted hover:bg-base-800/60 hover:text-fg"}`;
            }}
          >
            <Icon size={17} strokeWidth={2} />
            {!compact && label}
          </NavLink>
        ))}
      </nav>

      <div className={`space-y-2.5 border-t border-line py-4 text-xs text-muted ${compact ? "px-2" : "px-4"}`}>
        {mainOverlay && !compact && (
          <button
            onClick={() => void copyObsUrl(mainOverlay.id)}
            className="flex w-full items-center gap-2 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-left text-fg transition hover:bg-base-700"
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
            className="flex w-full items-center justify-center rounded-lg border border-base-700 bg-base-800 py-2 text-accent transition hover:bg-base-700"
            title={`Copier l'URL OBS de « ${mainOverlay.name} »`}
            aria-label="Copier l'URL OBS"
          >
            <Link2 size={15} />
          </button>
        )}

        <StatusLink
          to="/settings"
          compact={compact}
          dotClass={overlayServerRunning ? "bg-live" : "bg-red-500"}
          label={overlayServerRunning ? "Serveur d'overlay en ligne" : "Serveur d'overlay hors ligne"}
        />
        <StatusLink
          to="/connections"
          compact={compact}
          dotClass={activeProviderId ? "bg-live" : "bg-warn"}
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
      className={`flex items-center rounded-md py-0.5 hover:text-fg ${compact ? "justify-center" : "gap-2"}`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  );
}
