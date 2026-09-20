import { useLayoutEffect, useRef, type CSSProperties } from "react";
import type { ProgressReader } from "@/utils/progress-clock";
import { subscribeFrame } from "@/utils/frame-ticker";
import { formatTime, formatTimeCeil } from "@/utils/format-time";

/**
 * Composants d'affichage "live" : ils lisent l'horloge à chaque image
 * d'animation et écrivent DIRECTEMENT dans le DOM (transform / textContent),
 * sans passer par l'état React. Résultat : 60 images/s fluides sans
 * re-rendre l'overlay entier, et une barre qui ne dépend plus de la cadence
 * (250 ms) d'un setInterval ni d'une transition CSS qui rattrapait en retard.
 *
 * IMPORTANT — styles INLINE uniquement, jamais de classes Tailwind : ces
 * composants sont aussi rendus par la page overlay d'OBS, dont le bundle
 * n'embarque aucune feuille de style (voir OverlayPreview.tsx).
 *
 * Sans `reader`, l'affichage est statique (`fallbackProgress`) : miniatures,
 * aperçu de l'éditeur, etc.
 */

interface LiveBaseProps {
  reader?: ProgressReader | null;
  /** Progression (ms) affichée quand il n'y a pas d'horloge. */
  fallbackProgress: number;
  /** Durée totale (ms) ; 0 = inconnue. */
  duration: number;
}

export function progressRatio(progressMs: number, durationMs: number): number {
  if (!(durationMs > 0)) return 0;
  return Math.min(1, Math.max(0, progressMs / durationMs));
}

interface LiveProgressFillProps extends LiveBaseProps {
  trackStyle?: CSSProperties;
  fillStyle?: CSSProperties;
}

/**
 * Barre de progression. Le remplissage est un bloc PLEINE largeur déplacé par
 * `translate3d` (composité par le GPU, sans recalcul de mise en page) et
 * rogné par le conteneur `overflow: hidden` : le bord avant garde son arrondi
 * exact, ce qu'un `scaleX` déformerait.
 */
export function LiveProgressFill({ reader, fallbackProgress, duration, trackStyle, fillStyle }: LiveProgressFillProps) {
  const fillRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    let last = "";
    const apply = (nowMs: number) => {
      const progress = reader ? reader.read(nowMs) : fallbackProgress;
      const percent = (progressRatio(progress, duration) - 1) * 100;
      const value = `translate3d(${percent.toFixed(3)}%,0,0)`;
      if (value !== last) {
        last = value;
        el.style.transform = value;
      }
    };
    apply(performance.now());
    if (!reader) return;
    return subscribeFrame(apply);
  }, [reader, fallbackProgress, duration]);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        // Force un calque de composition : évite les artefacts d'arrondi
        // pendant que le remplissage se déplace.
        transform: "translateZ(0)",
        ...trackStyle,
      }}
    >
      <div
        ref={fillRef}
        style={{ width: "100%", height: "100%", willChange: "transform", transform: "translate3d(-100%,0,0)", ...fillStyle }}
      />
    </div>
  );
}

interface LiveTimeTextProps extends LiveBaseProps {
  mode: "elapsed" | "remaining";
}

/** Temps écoulé / restant : le texte n'est réécrit que lorsque la seconde change. */
export function LiveTimeText({ reader, fallbackProgress, duration, mode }: LiveTimeTextProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last: string | null = null;
    const apply = (nowMs: number) => {
      const progress = reader ? reader.read(nowMs) : fallbackProgress;
      const text =
        mode === "elapsed" ? formatTime(progress) : duration > 0 ? `-${formatTimeCeil(duration - progress)}` : "";
      if (text !== last) {
        last = text;
        el.textContent = text;
      }
    };
    apply(performance.now());
    if (!reader) return;
    return subscribeFrame(apply);
  }, [reader, fallbackProgress, duration, mode]);

  return <span ref={ref} />;
}
