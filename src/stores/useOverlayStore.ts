import { create } from "zustand";
import { nanoid } from "nanoid";
import type { OverlayConfig, PresetId } from "@/types/overlay";
import { getPreset } from "@/presets";

export interface CreateOptions {
  /** Taille du canvas ; par défaut celle du preset. */
  canvasWidth?: number;
  canvasHeight?: number;
}

interface OverlayStoreState {
  overlays: OverlayConfig[];
  activeOverlayId: string | null;
  loaded: boolean;

  load: () => Promise<void>;
  create: (presetId: PresetId, name?: string, options?: CreateOptions) => Promise<OverlayConfig>;
  update: (overlay: OverlayConfig) => Promise<void>;
  remove: (id: string) => Promise<void>;
  duplicate: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  getById: (id: string) => OverlayConfig | undefined;
}

async function persist(overlays: OverlayConfig[]): Promise<void> {
  await window.batlay.config.saveOverlays(overlays as unknown[]);
}

export const useOverlayStore = create<OverlayStoreState>((set, get) => ({
  overlays: [],
  activeOverlayId: null,
  loaded: false,

  load: async () => {
    const [overlays, activeOverlayId] = await Promise.all([
      window.batlay.config.getOverlays(),
      window.batlay.config.getActiveOverlayId(),
    ]);
    set({ overlays: (overlays as OverlayConfig[]) ?? [], activeOverlayId, loaded: true });
  },

  create: async (presetId, name, options = {}) => {
    const preset = getPreset(presetId);
    const overlay: OverlayConfig = {
      ...preset,
      theme: {
        ...preset.theme,
        canvasWidth: options.canvasWidth ?? preset.theme.canvasWidth,
        canvasHeight: options.canvasHeight ?? preset.theme.canvasHeight,
      },
      id: nanoid(10),
      name: name ?? presetLabel(presetId),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const overlays = [...get().overlays, overlay];
    set({ overlays });
    await persist(overlays);
    return overlay;
  },

  update: async (overlay) => {
    const overlays = get().overlays.map((o) =>
      o.id === overlay.id ? { ...overlay, updatedAt: Date.now() } : o
    );
    set({ overlays });
    await persist(overlays);
  },

  remove: async (id) => {
    const previousActiveId = get().activeOverlayId;
    const overlays = get().overlays.filter((o) => o.id !== id);
    const activeOverlayId = previousActiveId === id ? null : previousActiveId;
    set({ overlays, activeOverlayId });
    await persist(overlays);
    if (activeOverlayId !== previousActiveId) {
      await window.batlay.config.setActiveOverlayId(activeOverlayId);
    }
  },

  duplicate: async (id) => {
    const original = get().overlays.find((o) => o.id === id);
    if (!original) return;
    const copy: OverlayConfig = {
      // Copie profonde : la copie ne doit partager aucun objet avec l'original.
      ...structuredClone(original),
      id: nanoid(10),
      name: `${original.name} (copie)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const overlays = [...get().overlays, copy];
    set({ overlays });
    await persist(overlays);
  },

  rename: async (id, name) => {
    const overlays = get().overlays.map((o) => (o.id === id ? { ...o, name, updatedAt: Date.now() } : o));
    set({ overlays });
    await persist(overlays);
  },

  setActive: async (id) => {
    set({ activeOverlayId: id });
    await window.batlay.config.setActiveOverlayId(id);
  },

  getById: (id) => get().overlays.find((o) => o.id === id),
}));

function presetLabel(presetId: PresetId): string {
  const labels: Record<PresetId, string> = {
    minimal: "Minimal",
    modern: "Modern",
    glass: "Glass",
    neon: "Neon",
    compact: "Compact",
    large: "Large",
    blank: "Blank",
  };
  return labels[presetId];
}
