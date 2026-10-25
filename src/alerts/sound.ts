/**
 * Sons des alertes. Le « carillon » est SYNTHÉTISÉ (Web Audio) : aucun fichier,
 * aucune requête. Un son importé est lu tel quel. Toute erreur de lecture
 * (lecture automatique bloquée par le logiciel, fichier absent) est ignorée :
 * une alerte s'affiche même sans son.
 */

let context: AudioContext | null = null;

function audioContext(): AudioContext | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    context ??= new Ctx();
    void context.resume?.();
    return context;
  } catch {
    return null;
  }
}

/** Deux notes douces (do – sol), enveloppe sans clic, ~0,7 s. */
export function playChime(volume: number): void {
  const ctx = audioContext();
  if (!ctx || volume <= 0) return;
  const start = ctx.currentTime + 0.02;
  [
    [523.25, 0],
    [783.99, 0.14],
  ].forEach(([freq, offset]) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const t = start + offset;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.35 * volume), t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.65);
  });
}

/** Lit un fichier ; renvoie une fonction d'arrêt (alerte passée ou page fermée). */
export function playFile(url: string, volume: number): () => void {
  try {
    const audio = new Audio(url);
    audio.volume = Math.min(1, Math.max(0, volume));
    void audio.play().catch(() => undefined);
    return () => {
      audio.pause();
      audio.src = "";
    };
  } catch {
    return () => undefined;
  }
}
