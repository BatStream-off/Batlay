import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatedSwap, useAnimationEnvironment } from "@/animation/react";
import { normalizeOverlayAnimation, resolveComponentMotion } from "@/animation/config";
import { isMotionAllowed } from "@/animation/engine";
import { componentContentKey, NO_TRACK_KEY } from "@/utils/overlay-motion";
import type { FillConfig, OverlayConfig, OverlayComponentConfig } from "@/types/overlay";
import type { Track } from "@/types/track";
import type { ProgressReader } from "@/utils/progress-clock";
import { LiveProgressFill, LiveTimeText } from "@/components/LiveProgress";
import { formatArtists } from "@/utils/artists";
import { formatTime } from "@/utils/format-time";
import {
  artworkBackdropStyle,
  canvasFrameStyle,
  componentBoxStyle,
  resolveFill,
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

/** Pochette d'exemple (SVG en data URI : aucun fichier, aucune requête réseau), pour l'aperçu de l'éditeur. */
function sampleArtwork(a: string, b: string, c: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
    `<rect width="300" height="300" fill="url(#g)"/><circle cx="210" cy="95" r="70" fill="${c}" opacity=".75"/>` +
    `<circle cx="80" cy="230" r="110" fill="${b}" opacity=".5"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
export const SAMPLE_ARTWORKS = [sampleArtwork("#ff5f6d", "#3a1c71", "#ffc371"), sampleArtwork("#0bd3d3", "#1d2b64", "#f8cdda")] as const;

/**
 * Second morceau d'exemple : l'éditeur alterne entre les deux pour montrer la
 * transition (« Tester la transition »). Accents et deux artistes : on voit
 * aussi qu'ils survivent à l'animation.
 */
export const SAMPLE_TRACK_ALT: Track = {
  id: "sample-alt",
  title: "Tout oublier",
  artist: "Angèle, Roméo Elvis",
  artists: ["Angèle", "Roméo Elvis"],
  album: "Brol",
  source: "Spotify",
  duration: 213_000,
  progress: 61_000,
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
  const env = useAnimationEnvironment();
  const settings = normalizeOverlayAnimation(overlay.animations);
  const motionAllowed = isMotionAllowed(settings, env.reducedMotion);
  const frameMotion = resolveComponentMotion(overlay.animations, undefined, { motionAllowed });
  const components = [...overlay.components].filter((c) => c.visible).sort((a, b) => a.order - b.order);
  const frameArtwork = overlay.theme.background?.mode === "artwork";
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
      {track && <style>{MARQUEE_KEYFRAMES}</style>}
      {/* Fond de l'overlay : apparaît / disparaît avec la musique ; en mode « pochette », fondu d'une pochette à l'autre. */}
      <AnimatedSwap
        swapKey={track ? (frameArtwork ? `artwork:${track.artwork ?? ""}` : "present") : NO_TRACK_KEY}
        value={track}
        render={(t) => (t ? (frameArtwork ? <ArtworkBackdrop fill={overlay.theme.background!} src={t.artwork} /> : "") : null)}
        layerStyle={frameArtwork ? { ...canvasFrameStyle(overlay.theme), isolation: "isolate" } : canvasFrameStyle(overlay.theme)}
        enter={frameMotion.enter}
        exit={frameMotion.exit}
      />
      {components.map((component, index) => (
        <AnimatedComponent
          key={component.id}
          component={component}
          index={index}
          overlay={overlay}
          track={track}
          reader={reader}
          motionAllowed={motionAllowed}
        />
      ))}
    </div>
  );
}

/**
 * Fond « pochette » : la pochette du morceau, agrandie et floutée, SOUS le
 * contenu (z-index -1 dans un bloc isolé) et rognée aux bords du bloc. Sans
 * pochette, il ne reste que la couleur de secours du fond.
 */
function ArtworkBackdrop({ fill, src }: { fill: FillConfig; src?: string }) {
  if (!src) return null;
  return (
    <span aria-hidden="true" style={{ position: "absolute", inset: 0, overflow: "hidden", borderRadius: "inherit", zIndex: -1, pointerEvents: "none" }}>
      <img src={src} alt="" style={artworkBackdropStyle(fill)} />
    </span>
  );
}

/**
 * Un composant de l'overlay, avec ses transitions (src/animation/). Hors
 * contexte d'animation (miniatures, listes), rendu strictement identique à
 * l'ancien : un seul bloc, aucune animation.
 */
function AnimatedComponent({
  component,
  index,
  overlay,
  track,
  reader,
  motionAllowed,
}: {
  component: OverlayComponentConfig;
  index: number;
  overlay: OverlayConfig;
  track: Track | null;
  reader?: ProgressReader | null;
  motionAllowed: boolean;
}) {
  const motionKey = JSON.stringify([overlay.animations, component.animation, index, motionAllowed]);
  // Recalculé seulement quand un réglage d'animation change, pas à chaque mesure de lecture.
  const motion = useMemo(
    () => resolveComponentMotion(overlay.animations, component.animation, { index, motionAllowed }),
    // motionKey résume toutes les dépendances (réglages de l'overlay et du composant, rang, autorisation).
    [motionKey]
  );
  const fill = resolveFill(component.style);
  const artworkFill = fill?.mode === "artwork" ? fill : null;
  const boxStyle = componentStyle(component);
  return (
    <AnimatedSwap
      // Fond « pochette » : la clé suit aussi la pochette (fondu d'une image à l'autre, même pour une forme).
      swapKey={componentContentKey(component, track) + (artworkFill && track ? `|bg:${track.artwork ?? ""}` : "")}
      value={track}
      // Une forme ou une barre n'a pas de contenu textuel : chaîne vide = bloc affiché quand même.
      render={(t) =>
        t ? (
          artworkFill ? (
            <>
              <ArtworkBackdrop fill={artworkFill} src={t.artwork} />
              {componentContent(component, t, reader)}
            </>
          ) : (
            (componentContent(component, t, reader) ?? "")
          )
        ) : null
      }
      layerStyle={artworkFill ? { ...boxStyle, isolation: "isolate" } : boxStyle}
      enter={motion.enter}
      exit={motion.exit}
      loop={motion.loop}
      loopActive={track?.isPlaying ?? false}
    />
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
