import { create } from "zustand";

export interface Settings {
  launchOnStartup: boolean;
  startMinimized: boolean;
  theme: "dark" | "light";
  language: "fr" | "en";
  overlayServerPort: number;
  preferredSystemMediaAppId: string | null;
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
  },

  update: async (partial) => {
    const updated = await window.batlay.config.setSettings(partial);
    set({ settings: updated });
  },
}));
