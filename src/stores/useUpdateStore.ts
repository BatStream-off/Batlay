import { create } from "zustand";
import type { UpdateStatus } from "../../electron/shared/update";

interface UpdateStoreState {
  status: UpdateStatus;
  version: string | null;
  /** À appeler une fois au démarrage : lit l'état courant et suit les changements. */
  init: () => () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openReleases: () => Promise<void>;
}

// Hors Electron (navigateur, tests) il n'y a pas de pont : la mise à jour est simplement indisponible.
const bridge = () => (typeof window !== "undefined" ? window.batlay?.update : undefined);

export const useUpdateStore = create<UpdateStoreState>((set) => ({
  status: { state: "idle" },
  version: null,

  init: () => {
    const api = bridge();
    if (!api) return () => {};
    void api.getVersion().then((version) => set({ version })).catch(() => {});
    void api.getStatus().then((status) => set({ status })).catch(() => {});
    return api.onStatus((status) => set({ status }));
  },

  check: async () => {
    const api = bridge();
    if (!api) return;
    set({ status: await api.check() });
  },
  download: async () => {
    const api = bridge();
    if (!api) return;
    set({ status: await api.download() });
  },
  install: async () => {
    await bridge()?.install();
  },
  openReleases: async () => {
    await bridge()?.openReleases();
  },
}));
