/**
 * Géométrie de l'éditeur, en fonctions pures (aucune dépendance React/DOM) :
 * redimensionnement par poignées et magnétisme. Testées dans
 * tests/editor-geometry.test.ts.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export interface ResizeOptions {
  /** Conserve le rapport largeur/hauteur (poignées d'angle uniquement). */
  keepAspect?: boolean;
  /** Redimensionne depuis le centre (Alt). */
  fromCenter?: boolean;
  minSize?: number;
}

/**
 * Nouvelle géométrie quand on tire la poignée `handle` de (dx, dy) pixels.
 * Le côté OPPOSÉ reste fixe (ou le centre avec `fromCenter`) ; jamais de
 * taille négative ni sous `minSize`.
 */
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, opts: ResizeOptions = {}): Rect {
  const min = opts.minSize ?? 4;
  const factor = opts.fromCenter ? 2 : 1;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");

  let width = start.width + (east ? dx * factor : west ? -dx * factor : 0);
  let height = start.height + (south ? dy * factor : north ? -dy * factor : 0);

  const isCorner = (west || east) && (north || south);
  if (opts.keepAspect && isCorner && start.width > 0 && start.height > 0) {
    // Le rapport suit l'axe qui a le plus changé, en proportion.
    const scale = Math.max(width / start.width, height / start.height);
    width = start.width * scale;
    height = start.height * scale;
  }

  width = Math.max(min, width);
  height = Math.max(min, height);
  if (opts.keepAspect && isCorner && start.width > 0 && start.height > 0) {
    // Le minimum d'un axe ne doit pas casser le rapport de l'autre.
    const ratio = start.width / start.height;
    if (width / height > ratio) height = width / ratio;
    else width = height * ratio;
  }

  let x = start.x;
  let y = start.y;
  if (opts.fromCenter) {
    x = start.x + (start.width - width) / 2;
    y = start.y + (start.height - height) / 2;
  } else {
    if (west) x = start.x + start.width - width;
    if (north) y = start.y + start.height - height;
  }

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

export interface Guide {
  axis: "x" | "y";
  position: number;
}

function snapAxis(
  start: number,
  size: number,
  targets: number[],
  threshold: number
): { offset: number; guide: number | null } {
  // Bords et milieu de l'élément déplacé.
  const points = [start, start + size / 2, start + size];
  let best: { offset: number; guide: number } | null = null;
  for (const point of points) {
    for (const target of targets) {
      const diff = target - point;
      if (Math.abs(diff) <= threshold && (!best || Math.abs(diff) < Math.abs(best.offset))) {
        best = { offset: diff, guide: target };
      }
    }
  }
  return best ?? { offset: 0, guide: null };
}

/**
 * Magnétisme pendant un déplacement : aligne les bords/centre de `rect` sur
 * ceux du canvas et des autres composants, à `threshold` pixels près, et
 * renvoie les guides à afficher.
 */
export function snapRect(
  rect: Rect,
  others: Rect[],
  canvas: { width: number; height: number },
  threshold: number
): { rect: Rect; guides: Guide[] } {
  const xTargets = [0, canvas.width / 2, canvas.width];
  const yTargets = [0, canvas.height / 2, canvas.height];
  for (const o of others) {
    xTargets.push(o.x, o.x + o.width / 2, o.x + o.width);
    yTargets.push(o.y, o.y + o.height / 2, o.y + o.height);
  }

  const sx = snapAxis(rect.x, rect.width, xTargets, threshold);
  const sy = snapAxis(rect.y, rect.height, yTargets, threshold);

  const guides: Guide[] = [];
  if (sx.guide !== null) guides.push({ axis: "x", position: sx.guide });
  if (sy.guide !== null) guides.push({ axis: "y", position: sy.guide });

  return {
    rect: { ...rect, x: Math.round(rect.x + sx.offset), y: Math.round(rect.y + sy.offset) },
    guides,
  };
}
