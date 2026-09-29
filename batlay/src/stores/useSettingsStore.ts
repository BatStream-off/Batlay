import { create } from "zustand";
import { applyThemePreference, systemPrefersDark } from "@/theme/apply-theme";
import { applyAccentColor } from "@/theme/accent";
import type { ThemePreference } from "../../electron/shared/theme";

export interface Settings {
  launchOnStartup: boolean;
  startMinimized: boolean;
  theme: ThemePreference;
  language: "fr" | "en";
  overlayServerPort: number;
  preferredSystemMediaAppId: string | null;
  /** Couleur des boutons choisie par l'utilisateur (hex `#rrggbb`). `null` = violet par défaut. */
  accentColor: string | null;
}

interface SettingsStoreState {
  settings: Settings | null;
  overlayServerRunning: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<Settings>) => Promise<void>;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  settings: null,
  overlayServerRunning: false,

  load: async () => {
    const config = await window.batlay.config.get();
    const running = await window.batlay.overlay.isRunning();
    set({ settings: config.settings, overlayServerRunning: running });
    // Couleur des boutons : appliquée dès le chargement, comme le thème.
    applyAccentColor(document.documentElement, config.settings.accentColor ?? null);
  },

  update: async (partial) => {
    const updated = await window.batlay.config.setSettings(partial);
    set({ settings: updated });
    // Thème appliqué tout de suite, sans attendre un rechargement. Pour « system »
    // le process principal confirme ensuite par `theme:changed` (source de vérité
    // = nativeTheme) : si matchMedia n'a pas encore suivi, cet événement corrige.
    if (partial.theme !== undefined) {
      applyThemePreference(document.documentElement, updated.theme, systemPrefersDark());
    }
    if (partial.accentColor !== undefined) {
      applyAccentColor(document.documentElement, updated.accentColor);
    }
  },
}));
