/** m:ss — arrondi vers le bas (temps écoulé). */
export function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  return formatSeconds(totalSeconds);
}

/** m:ss — arrondi vers le haut (temps restant), pour que écoulé + restant = durée. */
export function formatTimeCeil(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  return formatSeconds(totalSeconds);
}

function formatSeconds(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
