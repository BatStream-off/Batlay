import { nanoid } from "nanoid";
import type { OverlayComponentConfig, OverlayComponentType } from "@/types/overlay";
import { defaultFill } from "@/utils/overlay-style";

/**
 * Opérations d'édition sur la liste de composants d'un overlay, en fonctions
 * pures (elles renvoient de nouvelles listes, sans jamais muter l'entrée).
 * L'ordre d'empilement est le champ `order` : plus grand = dessiné au-dessus.
 * Après chaque opération les `order` sont renumérotés 0..n-1 sans trou.
 */

export const COMPONENT_LABELS: Record<OverlayComponentType, string> = {
  artwork: "Pochette",
  title: "Titre",
  artist: "Artiste(s)",
  album: "Album",
  progressBar: "Barre de progression",
  elapsedTime: "Temps écoulé",
  remainingTime: "Temps restant",
  duration: "Durée",
  source: "Source",
  text: "Texte libre",
  shape: "Forme / fond",
};

export const COMPONENT_DESCRIPTIONS: Record<OverlayComponentType, string> = {
  artwork: "Image de l'album",
  title: "Nom du morceau",
  artist: "Tous les artistes du morceau",
  album: "Nom de l'album",
  progressBar: "Avancement dans le morceau",
  elapsedTime: "ex. 1:24",
  remainingTime: "ex. -2:26",
  duration: "Durée totale",
  source: "Spotify, VLC, Chrome…",
  text: "Texte avec {title} {artist}…",
  shape: "Rectangle, carte, séparateur",
};

export const COMPONENT_TYPES = Object.keys(COMPONENT_LABELS) as OverlayComponentType[];

export function layerName(component: OverlayComponentConfig): string {
  return component.name?.trim() || COMPONENT_LABELS[component.type];
}

type Defaults = Pick<OverlayComponentConfig, "style"> & { size: { width: number; height: number }; content?: string };

const DEFAULTS: Record<OverlayComponentType, Defaults> = {
  artwork: { size: { width: 96, height: 96 }, style: { borderRadius: 8, shape: "square" } },
  title: { size: { width: 320, height: 32 }, style: { fontSize: 22, fontWeight: 600, color: "#FFFFFF" } },
  artist: { size: { width: 320, height: 24 }, style: { fontSize: 16, fontWeight: 400, color: "#B8B8C4" } },
  album: { size: { width: 320, height: 22 }, style: { fontSize: 14, fontWeight: 400, color: "#8A8A99" } },
  progressBar: {
    size: { width: 320, height: 6 },
    style: { fillColor: "#FFFFFF", trackColor: "rgba(255,255,255,0.15)", borderRadius: 3 },
  },
  elapsedTime: { size: { width: 64, height: 18 }, style: { fontSize: 12, color: "#8A8A99" } },
  remainingTime: { size: { width: 64, height: 18 }, style: { fontSize: 12, color: "#8A8A99", textAlign: "right" } },
  duration: { size: { width: 64, height: 18 }, style: { fontSize: 12, color: "#8A8A99", textAlign: "right" } },
  source: { size: { width: 140, height: 20 }, style: { fontSize: 12, color: "#8A8A99" } },
  text: { size: { width: 260, height: 28 }, style: { fontSize: 18, fontWeight: 600, color: "#FFFFFF" }, content: "En ce moment" },
  shape: {
    size: { width: 240, height: 90 },
    style: { borderRadius: 12, background: defaultFill({ color: "#000000", opacity: 0.55 }) },
  },
};

/** Renumérote `order` en 0..n-1 en conservant l'empilement actuel (égalités : ordre du tableau). */
export function normalizeOrder(components: OverlayComponentConfig[]): OverlayComponentConfig[] {
  return components
    .map((c, index) => ({ c, index }))
    .sort((a, b) => a.c.order - b.c.order || a.index - b.index)
    .map(({ c }, i) => (c.order === i ? c : { ...c, order: i }));
}

/**
 * Nouveau composant du type demandé, placé au-dessus de tous les autres,
 * centré dans le canvas et légèrement décalé s'il y en a déjà (pour ne pas
 * empiler les ajouts successifs exactement au même endroit).
 */
export function createComponent(
  type: OverlayComponentType,
  canvas: { width: number; height: number },
  existing: OverlayComponentConfig[]
): OverlayComponentConfig {
  const d = DEFAULTS[type];
  const width = Math.min(d.size.width, canvas.width);
  const height = Math.min(d.size.height, canvas.height);
  const cascade = (existing.length % 8) * 12;
  const x = Math.round(Math.min(Math.max(0, (canvas.width - width) / 2 + cascade), canvas.width - width));
  const y = Math.round(Math.min(Math.max(0, (canvas.height - height) / 2 + cascade), canvas.height - height));
  return {
    id: nanoid(6),
    type,
    visible: true,
    order: existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.order)) + 1,
    transform: { x, y, width, height },
    style: structuredClone(d.style),
    ...(d.content !== undefined ? { content: d.content } : {}),
  };
}

export function addComponent(
  components: OverlayComponentConfig[],
  component: OverlayComponentConfig
): OverlayComponentConfig[] {
  return normalizeOrder([...components, component]);
}

export function removeComponent(components: OverlayComponentConfig[], id: string): OverlayComponentConfig[] {
  return normalizeOrder(components.filter((c) => c.id !== id));
}

/** Copie décalée de 16 px, insérée juste au-dessus de l'original. */
export function duplicateComponent(
  components: OverlayComponentConfig[],
  id: string
): { components: OverlayComponentConfig[]; newId: string | null } {
  const original = components.find((c) => c.id === id);
  if (!original) return { components, newId: null };
  const copy: OverlayComponentConfig = {
    ...structuredClone(original),
    id: nanoid(6),
    locked: false,
    name: original.name ? `${original.name} (copie)` : undefined,
    transform: { ...original.transform, x: original.transform.x + 16, y: original.transform.y + 16 },
    order: original.order + 0.5, // juste au-dessus de l'original, renuméroté ci-dessous
  };
  return { components: normalizeOrder([...components, copy]), newId: copy.id };
}

export type LayerMove = "front" | "back" | "forward" | "backward";

/** Change la position d'un calque dans l'empilement. */
export function moveLayer(components: OverlayComponentConfig[], id: string, move: LayerMove): OverlayComponentConfig[] {
  const stack = normalizeOrder(components);
  const from = stack.findIndex((c) => c.id === id);
  if (from === -1) return components;
  const to =
    move === "front" ? stack.length - 1 : move === "back" ? 0 : move === "forward" ? from + 1 : from - 1;
  return reorderTo(stack, id, to);
}

/** Place le calque `id` à l'index `toIndex` de l'empilement (0 = tout en bas). Sert au glisser-déposer. */
export function reorderTo(components: OverlayComponentConfig[], id: string, toIndex: number): OverlayComponentConfig[] {
  const stack = normalizeOrder(components);
  const from = stack.findIndex((c) => c.id === id);
  if (from === -1) return components;
  const target = Math.min(stack.length - 1, Math.max(0, toIndex));
  if (target === from) return stack;
  const next = [...stack];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next.map((c, i) => (c.order === i ? c : { ...c, order: i }));
}

export type AlignKind = "left" | "centerH" | "right" | "top" | "middleV" | "bottom";

/** Aligne un composant sur le canvas. */
export function alignInCanvas(
  transform: OverlayComponentConfig["transform"],
  canvas: { width: number; height: number },
  kind: AlignKind
): OverlayComponentConfig["transform"] {
  switch (kind) {
    case "left":
      return { ...transform, x: 0 };
    case "centerH":
      return { ...transform, x: Math.round((canvas.width - transform.width) / 2) };
    case "right":
      return { ...transform, x: canvas.width - transform.width };
    case "top":
      return { ...transform, y: 0 };
    case "middleV":
      return { ...transform, y: Math.round((canvas.height - transform.height) / 2) };
    case "bottom":
      return { ...transform, y: canvas.height - transform.height };
  }
}
