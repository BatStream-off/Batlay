/**
 * Boucle d'animation unique partagée par tous les composants "live"
 * (barre de progression, temps écoulé...). Une seule requestAnimationFrame
 * quelle que soit la quantité de composants, arrêtée dès qu'il n'y a plus
 * d'abonné — un overlay sans barre de progression ne consomme rien.
 *
 * Les composants lisent l'horloge à chaque image et écrivent directement
 * dans le DOM : aucun re-render React à 60 images/s.
 */
type FrameListener = (nowMs: number) => void;

const listeners = new Set<FrameListener>();
let rafId: number | null = null;
let timeoutId: ReturnType<typeof setTimeout> | null = null;

function schedule(): void {
  if (typeof requestAnimationFrame === "function") {
    rafId = requestAnimationFrame(tick);
  } else {
    // Environnement sans rAF (tests) : ~60 Hz.
    timeoutId = setTimeout(tick, 16);
  }
}

function tick(): void {
  rafId = null;
  timeoutId = null;
  if (listeners.size === 0) return;
  const now = performance.now();
  for (const listener of Array.from(listeners)) listener(now);
  if (listeners.size > 0) schedule();
}

export function subscribeFrame(listener: FrameListener): () => void {
  listeners.add(listener);
  if (rafId === null && timeoutId === null) schedule();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (rafId !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(rafId);
      if (timeoutId !== null) clearTimeout(timeoutId);
      rafId = null;
      timeoutId = null;
    }
  };
}
