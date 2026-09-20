import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { OverlayConfig, OverlayComponentConfig } from "@/types/overlay";
import type { Track } from "@/types/track";
import type { ProgressReader } from "@/utils/progress-clock";
import { LiveProgressFill, LiveTimeText } from "@/components/LiveProgress";
import { formatArtists } from "@/utils/artists";
import { formatTime } from "@/utils/format-time";
import {
  canvasFrameStyle,
  componentBoxStyle,
  renderTemplate,
  textBoxStyle,
} from "@/utils/overlay-style";

interface OverlayPreviewProps {
  overlay: OverlayConfig;
  /**
   * `undefined` : contexte d'édition/miniature -> morceau d'exemple réaliste.
   * `null`      : overlay OBS réel sans musique détectée -> rien n'est affiché
   *               (jamais de fausse donnée, ni de fond vide, dans le vrai overlay).
   */
  track?: Track | null;
  /**
   * Horloge de progression (voir src/utils/progress-clock.ts). Sans elle, la
   * barre et le temps écoulé affichent la progression statique de `track`.
   */
  reader?: ProgressReader | null;
  /**
   * "fit"  : réduit pour remplir le conteneur (miniatures) ;
   * "1:1"  : taille native (page OBS) ;
   * nombre : zoom explicite (éditeur).
   */
  scale?: "fit" | "1:1" | number;
}

export const SAMPLE_TRACK: Track = {
  id: "sample",
  title: "Starboy",
  artist: "The Weeknd, Daft Punk",
  artists: ["The Weeknd", "Daft Punk"],
  album: "Starboy",
  source: "Spotify",
  duration: 230_000,
  progress: 84_000,
  isPlaying: true,
};

/**
 * IMPORTANT — ne PAS utiliser de classes Tailwind (h-full, w-full, ...) pour
 * la géométrie des composants d'overlay.
 *
 * Ce composant est rendu par DEUX bundles distincts :
 *   - le Dashboard (index.html -> src/main.tsx), qui importe globals.css
 *     et embarque donc bien Tailwind ;
 *   - la page overlay chargée par OBS (overlay.html -> overlay/main.tsx),
 *     qui n'importe AUCUNE feuille de style.
 *
 * Dans OBS, toute classe Tailwind est donc un no-op : un élément dont la
 * hauteur ne vient que de `h-full` s'effondre à 0px et devient invisible
 * (c'était exactement le bug de la barre de progression). Les styles inline
 * ci-dessous sont identiques dans les deux contextes.
 */
const FILL_PARENT: CSSProperties = { width: "100%", height: "100%" };

const MARQUEE_GAP_PX = 48;
const MARQUEE_KEYFRAMES = `@keyframes batlay-marquee { from { transform: translateX(0); } to { transform: translateX(var(--batlay-marquee-distance)); } }`;

/**
 * Texte qui défile en boucle SEULEMENT s'il déborde de son bloc. Un texte qui
 * tient reste immobile. C'est ce qui permet d'afficher « Artiste 1, Artiste 2,
 * Artiste 3 » en entier dans un bloc étroit, là où « … » n'en montrait qu'un.
 */
function MarqueeText({ text, speed }: { text: string; speed: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const span = textRef.current;
    if (!box || !span) return;
    const measure = () => {
      const width = span.offsetWidth; // largeur de mise en page : insensible à la transformation animée
      setTextWidth(width);
      setOverflowing(width > box.clientWidth + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    observer.observe(span);
    return () => observer.disconnect();
  }, [text]);

  const distance = textWidth + MARQUEE_GAP_PX;
  const durationS = Math.max(4, distance / Math.max(5, speed));

  return (
    <div ref={boxRef} style={{ width: "100%", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
      <div
        key={overflowing ? `run-${text}` : "still"}
        style={
          overflowing
            ? ({
                display: "inline-flex",
                gap: MARQUEE_GAP_PX,
                animation: `batlay-marquee ${durationS}s linear infinite`,
                willChange: "transform",
                ["--batlay-marquee-distance" as string]: `-${distance}px`,
              } as CSSProperties)
            : { display: "inline-block" }
        }
      >
        <span ref={textRef} style={{ display: "inline-block" }}>
          {text}
        </span>
        {overflowing && (
          <span aria-hidden style={{ display: "inline-block" }}>
            {text}
          </span>
        )}
      </div>
    </div>
  );
}

function TextContent({ component, text }: { component: OverlayComponentConfig; text: string }) {
  const mode = component.style.overflow ?? (component.type === "artist" ? "marquee" : "ellipsis");
  if (mode === "marquee") return <MarqueeText text={text} speed={component.style.marqueeSpeed ?? 40} />;
  if (mode === "wrap") {
    return <div style={{ width: "100%", minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" }}>{text}</div>;
  }
  return (
    <div style={{ width: "100%", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
      {text}
    </div>
  );
}

function componentContent(component: OverlayComponentConfig, track: Track, reader?: ProgressReader | null): ReactNode {
  const live = { reader, fallbackProgress: track.progress, duration: track.duration };
  switch (component.type) {
    case "artwork":
      return track.artwork ? (
        <img
          src={track.artwork}
          alt=""
          style={{ ...FILL_PARENT, objectFit: component.style.objectFit ?? "cover", display: "block" }}
        />
      ) : (
        <div style={{ ...FILL_PARENT, backgroundColor: "rgba(255,255,255,0.08)" }} />
      );
    case "title":
      // Métadonnées absentes : libellé propre plutôt qu'un bloc vide.
      return <TextContent component={component} text={track.title || "Titre inconnu"} />;
    case "artist":
      // TOUS les artistes, jamais seulement le premier ; le séparateur est réglable.
      return (
        <TextContent
          component={component}
          text={formatArtists(track, component.style.artistSeparator) || "Artiste inconnu"}
        />
      );
    case "album":
      return <TextContent component={component} text={track.album ?? ""} />;
    case "source":
      return <TextContent component={component} text={track.source ?? ""} />;
    case "text":
      return (
        <TextContent
          component={component}
          text={renderTemplate(component.content ?? "", {
            title: track.title,
            artist: formatArtists(track, component.style.artistSeparator),
            album: track.album ?? "",
            source: track.source ?? "",
          })}
        />
      );
    case "elapsedTime":
      return <LiveTimeText {...live} mode="elapsed" />;
    case "remainingTime":
      return <LiveTimeText {...live} mode="remaining" />;
    case "duration":
      return formatTime(track.duration);
    case "progressBar":
      return (
        <LiveProgressFill
          {...live}
          trackStyle={{
            backgroundColor: component.style.trackColor ?? "rgba(255,255,255,0.15)",
            borderRadius: component.style.borderRadius,
          }}
          fillStyle={{
            backgroundColor: component.style.fillColor ?? "#FFFFFF",
            borderRadius: component.style.borderRadius,
          }}
        />
      );
    case "shape":
    default:
      return null;
  }
}

const TEXT_TYPES = new Set<OverlayComponentConfig["type"]>([
  "title",
  "artist",
  "album",
  "source",
  "elapsedTime",
  "remainingTime",
  "duration",
  "text",
]);

function componentStyle(component: OverlayComponentConfig): CSSProperties {
  const box = componentBoxStyle(component);
  if (component.type === "artwork") return { ...box, overflow: "hidden" };
  if (TEXT_TYPES.has(component.type)) return { ...box, ...textBoxStyle(component) };
  return box; // progressBar, shape
}

/**
 * Rendu natif (1:1) d'un overlay. Partagé par la page OBS, l'éditeur et les
 * miniatures.
 */
export function OverlayCanvas({
  overlay,
  track,
  reader,
}: {
  overlay: OverlayConfig;
  track: Track | null;
  reader?: ProgressReader | null;
}) {
  const { canvasWidth, canvasHeight, borderRadius } = overlay.theme;
  return (
    <div
      style={{
        position: "relative",
        width: canvasWidth,
        height: canvasHeight,
        // Arrondi du canvas : rogne aussi les composants qui dépassent.
        overflow: borderRadius ? "hidden" : undefined,
        borderRadius: borderRadius || undefined,
      }}
    >
      {track && (
        <>
          <style>{MARQUEE_KEYFRAMES}</style>
          <div style={canvasFrameStyle(overlay.theme)} />
          {[...overlay.components]
            .filter((c) => c.visible)
            .sort((a, b) => a.order - b.order)
            .map((component) => (
              <div key={component.id} style={componentStyle(component)}>
                {componentContent(component, track, reader)}
              </div>
            ))}
        </>
      )}
    </div>
  );
}

/** Échelle qui fait tenir `contentW × contentH` dans le conteneur observé. */
function useFitScale(contentW: number, contentH: number, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.32);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0 && contentW > 0 && contentH > 0) {
        // Marge de 8 % pour ne pas coller aux bords de la vignette.
        setScale(Math.min(width / contentW, height / contentH) * 0.92);
      }
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [contentW, contentH, enabled]);

  return { ref, scale };
}

export function OverlayPreview({ overlay, track, reader, scale = "fit" }: OverlayPreviewProps) {
  const effectiveTrack = track === undefined ? SAMPLE_TRACK : track;
  const { canvasWidth, canvasHeight } = overlay.theme;
  const fit = useFitScale(canvasWidth, canvasHeight, scale === "fit");

  const canvas = <OverlayCanvas overlay={overlay} track={effectiveTrack} reader={reader} />;

  if (scale === "1:1") return <div style={{ width: canvasWidth, height: canvasHeight }}>{canvas}</div>;

  const factor = scale === "fit" ? fit.scale : scale;
  const scaled = (
    <div style={{ width: canvasWidth * factor, height: canvasHeight * factor, flexShrink: 0 }}>
      <div style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${factor})`, transformOrigin: "top left" }}>
        {canvas}
      </div>
    </div>
  );

  if (scale !== "fit") return scaled;
  return (
    <div
      ref={fit.ref}
      style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
    >
      {scaled}
    </div>
  );
}
