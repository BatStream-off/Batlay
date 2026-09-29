import { useEffect } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useToastStore } from "@/stores/useToastStore";
import { ColorField } from "@/components/editor/fields";
import { DEFAULT_ACCENT_HEX } from "@/theme/accent";
import type { ThemePreference } from "../../electron/shared/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

export function Settings() {
  const { settings, overlayServerRunning, load, update } = useSettingsStore((s) => ({
    settings: s.settings,
    overlayServerRunning: s.overlayServerRunning,
    load: s.load,
    update: s.update,
  }));
  const push = useToastStore((s) => s.push);

  useEffect(() => {
    load();
  }, [load]);

  if (!settings) return null;

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <h1 className="font-display text-2xl font-semibold text-fg">Settings</h1>

      <section className="mt-6 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">General</h2>
        <Toggle
          label="Launch on startup"
          checked={settings.launchOnStartup}
          onChange={(v) => update({ launchOnStartup: v })}
        />
        <Toggle
          label="Start minimized"
          checked={settings.startMinimized}
          onChange={(v) => update({ startMinimized: v })}
        />
      </section>

      <section className="mt-4 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">Appearance</h2>
        <div className="flex items-center justify-between text-sm text-fg">
          <span id="theme-label">Theme</span>
          <div
            role="radiogroup"
            aria-labelledby="theme-label"
            className="flex gap-1 rounded-lg border border-base-700 bg-base-800 p-0.5"
          >
            {THEME_OPTIONS.map((option) => {
              const selected = settings.theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update({ theme: option.value })}
                  className={`rounded-md px-3 py-1 text-xs transition ${
                    selected ? "bg-signal-600 text-white" : "text-muted hover:text-fg"
                  }`}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">« System » suit le thème clair/sombre de Windows.</p>

        <div className="mt-4 border-t border-line pt-4">
          <ColorField
            label="Couleur des boutons"
            value={settings.accentColor ?? DEFAULT_ACCENT_HEX}
            onChange={(accentColor) => update({ accentColor })}
          />
          {settings.accentColor && (
            <button
              type="button"
              onClick={() => update({ accentColor: null })}
              className="mt-2 text-xs text-muted hover:text-fg"
            >
              Réinitialiser la couleur par défaut
            </button>
          )}
        </div>
      </section>

      <section className="mt-4 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">Overlay Server</h2>
        <div className="flex items-center justify-between text-sm text-fg">
          <span>Status</span>
          <span className={overlayServerRunning ? "text-ok" : "text-danger"}>
            {overlayServerRunning ? "● Online" : "● Offline"}
          </span>
        </div>
        <label className="mt-3 flex items-center justify-between text-sm text-fg">
          <span>Port</span>
          <input
            type="number"
            value={settings.overlayServerPort}
            onChange={(e) => {
              update({ overlayServerPort: Number(e.target.value) });
              push("Redémarrez Batlay pour appliquer le nouveau port.", "info");
            }}
            className="w-24 rounded-md border border-base-700 bg-base-800 px-2 py-1 text-right text-sm outline-none focus:border-signal-500"
          />
        </label>
        <p className="mt-2 text-xs text-muted">
          Un changement de port nécessite de redémarrer Batlay pour prendre effet.
        </p>
      </section>

      <section className="mt-4 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">About</h2>
        <p className="text-sm text-fg">Batlay</p>
        <p className="text-xs text-muted">Version 0.1.0</p>
        <p className="text-xs text-muted">Créateur : Adilbl</p>
      </section>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2 text-sm text-fg">
      {label}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition ${
          checked ? "bg-signal-600" : "bg-base-700"
        }`}
      >
        <span
          className={`h-5 w-5 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </label>
  );
}
