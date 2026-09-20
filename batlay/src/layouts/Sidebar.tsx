import { NavLink } from "react-router-dom";
import { LayoutDashboard, Layers, Plug, SlidersHorizontal } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useMusicStore } from "@/stores/useMusicStore";

const NAV_ITEMS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/overlays", label: "Overlays", icon: Layers },
  { to: "/connections", label: "Connections", icon: Plug },
  { to: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export function Sidebar() {
  const overlayServerRunning = useSettingsStore((s) => s.overlayServerRunning);
  const activeProviderId = useMusicStore((s) => s.activeProviderId);

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-base-900">
      <div className="px-5 py-6">
        <span className="font-display text-xl font-bold tracking-tight text-fg">Batlay</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive ? "bg-base-800 text-fg" : "text-muted hover:bg-base-800/60 hover:text-fg"
              }`
            }
          >
            <Icon size={17} strokeWidth={2} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2.5 border-t border-line px-4 py-4 text-xs text-muted">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${overlayServerRunning ? "bg-live" : "bg-red-500"}`}
          />
          Overlay Server {overlayServerRunning ? "Online" : "Offline"}
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${activeProviderId ? "bg-live" : "bg-base-600"}`}
          />
          {activeProviderId === "spotify"
            ? "Spotify Connected"
            : activeProviderId === "demo"
              ? "Demo Mode"
              : activeProviderId === "system-media"
                ? "Lecture système"
                : "Aucune source"}
        </div>
      </div>
    </aside>
  );
}
