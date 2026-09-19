import { useEffect, useRef, useState } from "react";
import { OverlayPreview } from "@/components/OverlayPreview";
import type { OverlayConfig } from "@/types/overlay";
import type { PlaybackState } from "@/types/track";
import { useNow } from "@/hooks/useNow";
import { interpolateTrack } from "@/utils/interpolate-progress";

function getOverlayIdFromPath(): string | null {
  // Ex: /overlay/abc123 -> "abc123"
  const match = window.location.pathname.match(/\/overlay\/([^/?]+)/);
  return match ? match[1] : null;
}

/**
 * Page réellement chargée par OBS Browser Source. Elle ne contient
 * aucun dashboard, aucun menu, aucun fond opaque — uniquement l'overlay,
 * mis à jour en temps réel via WebSocket sans rechargement de page
 * (voir section "Mise à jour temps réel" du brief).
 */
export function OverlayApp() {
  const overlayId = getOverlayIdFromPath();
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>({ track: null, isPlaying: false, updatedAt: 0 });
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // La progression réelle du provider n'arrive que toutes les ~2s
  // (polling) : `now` permet de la faire avancer en continu à l'écran
  // entre deux mises à jour (voir src/utils/interpolate-progress.ts).
  // Appelé avant tout retour anticipé (Règles des Hooks : nombre de hooks
  // fixe entre deux rendus).
  const now = useNow();

  useEffect(() => {
    if (!overlayId) {
      setError("overlayId manquant dans l'URL.");
      return;
    }

    fetch(`/api/overlays/${overlayId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Overlay introuvable.");
        return res.json();
      })
      .then(setConfig)
      .catch((err) => setError((err as Error).message));

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedIntentionally = false;

    function connect() {
      const ws = new WebSocket(`ws://${window.location.host}/ws/${overlayId}`);
      wsRef.current = ws;
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "state") setPlayback(msg.payload);
      };
      // Reconnexion automatique si Batlay redémarre (ex. après un crash ou
      // un changement de port) — l'overlay ne doit jamais rester figé.
      ws.onclose = () => {
        if (closedIntentionally) return;
        reconnectTimer = setTimeout(connect, 2000);
      };
    }
    connect();

    return () => {
      closedIntentionally = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [overlayId]);

  if (error) return null; // une overlay OBS ne doit jamais afficher un message d'erreur visible au public
  if (!config) return null;

  const track = interpolateTrack(playback, now);

  return <OverlayPreview overlay={config} track={track} scale="1:1" />;
}
