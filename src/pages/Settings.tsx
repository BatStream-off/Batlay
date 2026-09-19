import { useEffect } from "react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useToastStore } from "@/stores/useToastStore";

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
      <h1 className="font-display text-2xl font-semibold text-white">Settings</h1>

      <section className="mt-6 rounded-xl2 border border-base-800 bg-base-900 p-6">
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

      <section className="mt-4 rounded-xl2 border border-base-800 bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">Overlay Server</h2>
        <div className="flex items-center justify-between text-sm text-white">
          <span>Status</span>
          <span className={overlayServerRunning ? "text-live" : "text-red-400"}>
            {overlayServerRunning ? "● Online" : "● Offline"}
          </span>
        </div>
        <label className="mt-3 flex items-center justify-between text-sm text-white">
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

      <section className="mt-4 rounded-xl2 border border-base-800 bg-base-900 p-6">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">About</h2>
        <p className="text-sm text-white">Batlay</p>
        <p className="text-xs text-muted">Version 0.1.0</p>
      </section>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2 text-sm text-white">
      {label}
      <button
        onClick={() => onChange(!checked)}
        className={`h-5 w-9 rounded-full transition ${checked ? "bg-signal-600" : "bg-base-700"}`}
      >
        <span
          className={`block h-4 w-4 translate-y-0.5 rounded-full bg-white transition ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
    </label>
  );
}
