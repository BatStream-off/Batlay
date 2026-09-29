import { useEffect, useState } from "react";

/**
 * Retourne `Date.now()`, rafraîchi toutes les `intervalMs` (250ms par
 * défaut — assez fluide pour une barre de progression/un chrono, sans
 * re-render excessif). Utilisé avec `interpolateTrack` dans le Dashboard
 * et l'overlay OBS pour faire avancer l'affichage entre deux polls.
 */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
