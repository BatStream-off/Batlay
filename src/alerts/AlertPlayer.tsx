import { useEffect, useRef } from "react";
import type { AlertEvent, AlertStyle } from "../../electron/shared/alerts";
import { isEnterEffect, isExitEffect, type MotionSpec } from "../animation/config";
import { cancelAll, playEnter, playExit, prefersReducedMotion } from "../animation/engine";
import { AlertCard } from "./AlertCard";
import { playChime, playFile } from "./sound";

/**
 * Cycle de vie d'UNE alerte : entrée animée + son, affichage `durationMs`,
 * sortie animée, puis `onDone`. Partagé par la page OBS et l'aperçu.
 * Animations : moteur commun (src/animation/), effet revalidé ici.
 * Démontage (alerte passée, page fermée) : animations, minuteur et son arrêtés.
 */

export function alertMotion(style: AlertStyle, reduced: boolean): { enter: MotionSpec | null; exit: MotionSpec | null } {
  if (reduced) return { enter: null, exit: null };
  const spec = (effect: string): MotionSpec | null =>
    effect === "none" ? null : { effect, durationMs: style.animMs, delayMs: 0, easing: "cubic-bezier(0.16, 1, 0.3, 1)", intensity: 0.55 };
  return {
    enter: spec(isEnterEffect(style.enter) ? style.enter : "fade"),
    exit: spec(isExitEffect(style.exit) ? style.exit : "fade"),
  };
}

export function AlertPlayer({
  event,
  style,
  mediaUrl,
  onDone,
  muted = false,
}: {
  event: AlertEvent;
  style: AlertStyle;
  /** Identifiant d'un fichier importé → adresse utilisable par cette page. */
  mediaUrl: (id: string) => string | null;
  onDone: () => void;
  muted?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    const el = ref.current;
    const motion = alertMotion(style, prefersReducedMotion());
    let stopSound = () => undefined as void;
    let alive = true;
    playEnter(el, motion.enter);
    if (!muted && style.volume > 0) {
      if (style.sound.type === "chime") playChime(style.volume);
      else if (style.sound.type === "file") {
        const url = mediaUrl(style.sound.mediaId);
        if (url) stopSound = playFile(url, style.volume);
      }
    }
    const timer = setTimeout(() => {
      void playExit(el, motion.exit).finished.then(() => {
        if (alive) done.current();
      });
    }, (motion.enter?.durationMs ?? 0) + style.durationMs);
    return () => {
      alive = false;
      clearTimeout(timer);
      cancelAll(el);
      stopSound();
    };
    // Une alerte = un cycle : relancé seulement pour un NOUVEL événement.
  }, [event.id]);

  return <AlertCard ref={ref} event={event} style={style} imageUrl={style.imageId ? mediaUrl(style.imageId) : null} />;
}
