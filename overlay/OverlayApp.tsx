import { useEffect, useRef, useState } from "react";
import { OverlayPreview } from "@/components/OverlayPreview";
import type { OverlayConfig } from "@/types/overlay";
import type { PlaybackState } from "@/types/track";
import { ProgressClock, feedClock } from "@/utils/progress-clock";

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
 *
 * Progression : la même ProgressClock que le Dashboard (src/utils/
 * progress-clock.ts) interpole la position entre deux mesures du provider et
 * absorbe les écarts sans saut ; les composants live la lisent à chaque
 * image d'animation. L'état React ne change qu'à l'arrivée d'un message.
 */
export function OverlayApp() {
  const overlayId = getOverlayIdFromPath();
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [playback, setPlayback] = useState<PlaybackState>({ track: null, isPlaying: false, updatedAt: 0 });
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const clockRef = useRef<ProgressClock>(new ProgressClock());

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
        // JSON.parse d'un message texte WebSocket : toujours de l'UTF-8.
        const msg = JSON.parse(event.data);
        if (msg.type === "state") {
          const payload = msg.payload as PlaybackState;
          // `sentAt` = horloge de Batlay à l'envoi ; avec `updatedAt` (même
          // horloge) on connaît l'âge exact de la mesure sans dépendre de
          // l'horloge de cette page.
          feedClock(clockRef.current, payload, typeof msg.sentAt === "number" ? msg.sentAt : undefined);
          setPlayback(payload);
        } else if (msg.type === "config") {
          // Sauvegarde dans l'éditeur : appliquée en direct, sans recharger la source OBS.
          setConfig(msg.payload as OverlayConfig);
        }
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

  return <OverlayPreview overlay={config} track={playback.track} reader={clockRef.current} scale="1:1" />;
}
