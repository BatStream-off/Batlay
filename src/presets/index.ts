import type {
  OverlayConfig,
  OverlayComponentConfig,
  PresetId,
  AnimationConfig,
} from "@/types/overlay";
import { nanoid } from "nanoid";

type PresetBase = Omit<OverlayConfig, "id" | "name" | "createdAt" | "updatedAt">;

const DEFAULT_ANIMATION: AnimationConfig = {
  enter: "fade",
  exit: "fade",
  durationMs: 400,
  easing: "cubic-bezier(0.16, 1, 0.3, 1)",
};

function component(
  type: OverlayComponentConfig["type"],
  overrides: Partial<OverlayComponentConfig> = {}
): OverlayComponentConfig {
  return {
    id: nanoid(6),
    type,
    visible: true,
    order: 0,
    transform: { x: 0, y: 0, width: 200, height: 60 },
    style: {},
    ...overrides,
  };
}

const PRESETS: Record<PresetId, PresetBase> = {
  minimal: {
    schemaVersion: 1,
    presetId: "minimal",
    theme: { canvasWidth: 720, canvasHeight: 200, padding: 16, gap: 12 },
    animations: DEFAULT_ANIMATION,
    components: [
      component("artwork", {
        order: 0,
        transform: { x: 16, y: 16, width: 96, height: 96 },
        style: { borderRadius: 8, shape: "square", shadow: false },
      }),
      component("title", {
        order: 1,
        transform: { x: 128, y: 28, width: 500, height: 32 },
        style: { fontSize: 22, fontWeight: 600, color: "#FFFFFF" },
      }),
      component("artist", {
        order: 2,
        transform: { x: 128, y: 64, width: 500, height: 24 },
        style: { fontSize: 16, fontWeight: 400, color: "#B8B8C4" },
      }),
      component("progressBar", {
        order: 3,
        visible: false,
        transform: { x: 128, y: 96, width: 460, height: 4 },
        style: { fillColor: "#FFFFFF", trackColor: "rgba(255,255,255,0.15)", borderRadius: 2 },
      }),
    ],
  },

  modern: {
    schemaVersion: 1,
    presetId: "modern",
    theme: { canvasWidth: 780, canvasHeight: 220, padding: 20, gap: 14 },
    animations: { ...DEFAULT_ANIMATION, enter: "slideUp", exit: "fade" },
    components: [
      component("artwork", {
        order: 0,
        transform: { x: 20, y: 20, width: 120, height: 120 },
        style: { borderRadius: 16, shape: "square", shadow: true },
      }),
      component("title", {
        order: 1,
        transform: { x: 156, y: 40, width: 560, height: 34 },
        style: { fontSize: 24, fontWeight: 700, color: "#FFFFFF" },
      }),
      component("artist", {
        order: 2,
        transform: { x: 156, y: 78, width: 560, height: 26 },
        style: { fontSize: 17, fontWeight: 500, color: "#9B6BFF" },
      }),
      component("progressBar", {
        order: 3,
        transform: { x: 156, y: 116, width: 520, height: 6 },
        style: { fillColor: "#9B6BFF", trackColor: "rgba(255,255,255,0.12)", borderRadius: 3 },
      }),
      component("elapsedTime", {
        order: 4,
        transform: { x: 156, y: 132, width: 80, height: 18 },
        style: { fontSize: 12, color: "#8A8A99" },
      }),
      component("duration", {
        order: 5,
        transform: { x: 596, y: 132, width: 80, height: 18 },
        style: { fontSize: 12, color: "#8A8A99", textAlign: "right" },
      }),
    ],
  },

  glass: {
    schemaVersion: 1,
    presetId: "glass",
    theme: { canvasWidth: 760, canvasHeight: 210, padding: 18, gap: 12 },
    animations: { ...DEFAULT_ANIMATION, enter: "fade", exit: "fade", durationMs: 500 },
    components: [
      component("artwork", {
        order: 0,
        transform: { x: 18, y: 18, width: 110, height: 110 },
        style: { borderRadius: 14, shape: "square", shadow: true, borderWidth: 1, borderColor: "rgba(255,255,255,0.25)" },
      }),
      component("title", {
        order: 1,
        transform: { x: 148, y: 36, width: 560, height: 32 },
        style: { fontSize: 22, fontWeight: 600, color: "#FFFFFF" },
      }),
      component("artist", {
        order: 2,
        transform: { x: 148, y: 72, width: 560, height: 24 },
        style: { fontSize: 15, fontWeight: 400, color: "rgba(255,255,255,0.75)" },
      }),
      component("progressBar", {
        order: 3,
        transform: { x: 148, y: 110, width: 520, height: 4 },
        style: { fillColor: "#FFFFFF", trackColor: "rgba(255,255,255,0.2)", borderRadius: 2 },
      }),
    ],
  },

  neon: {
    schemaVersion: 1,
    presetId: "neon",
    theme: { canvasWidth: 800, canvasHeight: 230, padding: 20, gap: 14 },
    animations: { ...DEFAULT_ANIMATION, enter: "slideLeft", exit: "slideRight", durationMs: 350 },
    components: [
      component("artwork", {
        order: 0,
        transform: { x: 20, y: 20, width: 120, height: 120 },
        style: { borderRadius: 12, shape: "square", shadow: true, borderWidth: 2, borderColor: "#9B6BFF" },
      }),
      component("title", {
        order: 1,
        transform: { x: 156, y: 34, width: 560, height: 34 },
        style: { fontSize: 25, fontWeight: 700, color: "#FFFFFF" },
      }),
      component("artist", {
        order: 2,
        transform: { x: 156, y: 72, width: 560, height: 26 },
        style: { fontSize: 17, fontWeight: 600, color: "#37E29A" },
      }),
      component("progressBar", {
        order: 3,
        transform: { x: 156, y: 112, width: 520, height: 6 },
        style: { fillColor: "#9B6BFF", trackColor: "rgba(255,255,255,0.1)", borderRadius: 3 },
      }),
    ],
  },

  compact: {
    schemaVersion: 1,
    presetId: "compact",
    theme: { canvasWidth: 420, canvasHeight: 96, padding: 10, gap: 8 },
    animations: { ...DEFAULT_ANIMATION, durationMs: 300 },
    components: [
      component("artwork", {
        order: 0,
        transform: { x: 10, y: 10, width: 76, height: 76 },
        style: { borderRadius: 8, shape: "square", shadow: false },
      }),
      component("title", {
        order: 1,
        transform: { x: 96, y: 20, width: 310, height: 24 },
        style: { fontSize: 16, fontWeight: 600, color: "#FFFFFF" },
      }),
      component("artist", {
        order: 2,
        transform: { x: 96, y: 48, width: 310, height: 20 },
        style: { fontSize: 13, fontWeight: 400, color: "#B8B8C4" },
      }),
    ],
  },

  large: {
    schemaVersion: 1,
    presetId: "large",
    theme: { canvasWidth: 960, canvasHeight: 300, padding: 28, gap: 18 },
    animations: { ...DEFAULT_ANIMATION, enter: "scale", exit: "fade", durationMs: 450 },
    components: [
      component("artwork", {
        order: 0,
        transform: { x: 28, y: 28, width: 180, height: 180 },
        style: { borderRadius: 20, shape: "square", shadow: true },
      }),
      component("title", {
        order: 1,
        transform: { x: 228, y: 60, width: 680, height: 44 },
        style: { fontSize: 32, fontWeight: 700, color: "#FFFFFF" },
      }),
      component("artist", {
        order: 2,
        transform: { x: 228, y: 110, width: 680, height: 32 },
        style: { fontSize: 20, fontWeight: 500, color: "#9B6BFF" },
      }),
      component("album", {
        order: 3,
        transform: { x: 228, y: 148, width: 680, height: 24 },
        style: { fontSize: 15, fontWeight: 400, color: "#8A8A99" },
      }),
      component("progressBar", {
        order: 4,
        transform: { x: 228, y: 190, width: 640, height: 8 },
        style: { fillColor: "#9B6BFF", trackColor: "rgba(255,255,255,0.12)", borderRadius: 4 },
      }),
    ],
  },

  blank: {
    schemaVersion: 1,
    presetId: "blank",
    theme: { canvasWidth: 800, canvasHeight: 250, padding: 16, gap: 12 },
    animations: DEFAULT_ANIMATION,
    components: [],
  },
};

export function getPreset(presetId: PresetId): PresetBase {
  // Retourne une copie profonde pour éviter toute mutation partagée entre overlays.
  return structuredClone(PRESETS[presetId]);
}

export function listPresetIds(): PresetId[] {
  return Object.keys(PRESETS) as PresetId[];
}
