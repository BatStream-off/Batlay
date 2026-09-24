import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useToastStore } from "@/stores/useToastStore";
import { ColorField } from "@/components/editor/fields";
import { Button, PageHeader, StatusPill } from "@/components/ui";
import { RegenerateObsLinkModal } from "@/components/RegenerateObsLinkModal";
import { DEFAULT_ACCENT_HEX } from "@/theme/accent";
import { validatePort } from "@/utils/ui-helpers";
import type { ThemePreference } from "../../electron/shared/theme";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "dark", label: "Sombre" },
  { value: "light", label: "Clair" },
  { value: "system", label: "Système" },
];

export function Settings() {
  const { settings, overlayServerRunning, load, update } = useSettingsStore((s) => ({
    settings: s.settings,
    overlayServerRunning: s.overlayServerRunning,
    load: s.load,
    update: s.update,
  }));
  const push = useToastStore((s) => s.push);
  const { overlayCount, regenerateAllObsLinks } = useOverlayStore((s) => ({
    overlayCount: s.overlays.length,
    regenerateAllObsLinks: s.regenerateAllObsLinks,
  }));
  const [confirmRegenerateAll, setConfirmRegenerateAll] = useState(false);

  // Le port se saisit dans un texte local et n'est enregistré qu'à la validation
  // (Entrée / sortie du champ) : avant, chaque frappe était enregistrée — taper
  // « 8945 » sauvegardait successivement 8, 89, 894 puis 8945, avec une
  // notification à chaque touche.
  const savedPort = settings?.overlayServerPort;
  const [portText, setPortText] = useState("");
  const [portError, setPortError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (savedPort !== undefined) setPortText(String(savedPort));
  }, [savedPort]);

  if (!settings) return null;

  async function commitPort() {
    const result = validatePort(portText);
    if (!result.ok) {
      setPortError(result.reason);
      return;
    }
    setPortError(null);
    if (result.port === savedPort) return;
    await update({ overlayServerPort: result.port });
    push("Port enregistré : redémarrez Batlay pour l'appliquer.", "info");
  }

  async function handleRegenerateAll() {
    try {
      const count = await regenerateAllObsLinks();
      push(
        `${count} lien${count > 1 ? "s" : ""} OBS régénéré${count > 1 ? "s" : ""} : recopiez-les dans OBS (Mes overlays > URL OBS).`,
        "success"
      );
    } catch (err) {
      push((err as Error).message || "Impossible de régénérer les liens OBS.", "error");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-8 py-10">
      <PageHeader title="Paramètres" />

      <section className="mt-6 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Général</h2>
        <Toggle
          label="Lancer au démarrage de Windows"
          hint="Version installée uniquement."
          checked={settings.launchOnStartup}
          onChange={(v) => update({ launchOnStartup: v })}
        />
        <Toggle
          label="Démarrer réduit"
          hint="Batlay s'ouvre réduit dans la barre des tâches : pratique pour l'ouvrir avec Windows sans qu'il gêne."
          checked={settings.startMinimized}
          onChange={(v) => update({ startMinimized: v })}
        />
      </section>

      <section className="mt-4 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">Apparence</h2>
        <div className="flex items-center justify-between text-sm text-fg">
          <span id="theme-label">Thème</span>
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
        <p className="mt-2 text-xs text-muted">« Système » suit le thème clair/sombre de Windows.</p>

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
        <h2 className="mb-4 text-xs font-medium uppercase tracking-wide text-muted">Serveur d'overlay</h2>
        <div className="flex items-center justify-between text-sm text-fg">
          <span>État</span>
          <StatusPill tone={overlayServerRunning ? "ok" : "warn"}>{overlayServerRunning ? "● En ligne" : "● Hors ligne"}</StatusPill>
        </div>
        <label className="mt-3 flex items-center justify-between text-sm text-fg">
          <span>Port</span>
          <input
            type="text"
            inputMode="numeric"
            value={portText}
            onChange={(e) => {
              setPortText(e.target.value);
              setPortError(null);
            }}
            onBlur={() => void commitPort()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-invalid={portError !== null}
            className="w-24 rounded-md border border-base-700 bg-base-800 px-2 py-1 text-right text-sm outline-none focus:border-signal-500"
          />
        </label>
        {portError ? (
          <p role="alert" className="mt-2 text-xs text-danger">{portError}</p>
        ) : (
          <p className="mt-2 text-xs text-muted">
            Un changement de port nécessite de redémarrer Batlay, et les URL déjà collées dans OBS devront être mises à jour.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-4 border-t border-line pt-4">
          <div className="min-w-0">
            <p className="text-sm text-fg">Liens OBS</p>
            <p className="mt-0.5 text-xs text-muted">
              Crée de nouveaux liens pour tous vos overlays. Les anciens cessent de fonctionner (lien partagé par erreur, source OBS à réinitialiser...).
            </p>
          </div>
          <Button size="sm" disabled={overlayCount === 0} onClick={() => setConfirmRegenerateAll(true)}>
            <RefreshCw size={14} /> Régénérer
          </Button>
        </div>
      </section>

      <section className="mt-4 rounded-xl2 border border-line bg-base-900 p-6">
        <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">À propos</h2>
        <p className="text-sm text-fg">Batlay</p>
        <p className="text-xs text-muted">Version 0.1.1</p>
        <p className="text-xs text-muted">Créateur : Adilbl</p>
      </section>

      {confirmRegenerateAll && (
        <RegenerateObsLinkModal
          count={overlayCount}
          onClose={() => setConfirmRegenerateAll(false)}
          onConfirm={() => {
            setConfirmRegenerateAll(false);
            void handleRegenerateAll();
          }}
        />
      )}
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-sm text-fg">{label}</p>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
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
    </div>
  );
}
