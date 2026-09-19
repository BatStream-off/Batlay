import type { CSSProperties } from "react";
import type { OverlayConfig, OverlayComponentConfig } from "@/types/overlay";
import type { Track } from "@/types/track";

interface OverlayPreviewProps {
  overlay: OverlayConfig;
  track?: Track | null;
  /** "fit" scale down to fill a thumbnail container; "1:1" render at native size (used by the real OBS overlay page). */
  scale?: "fit" | "1:1";
  onSelectComponent?: (id: string) => void;
  selectedComponentId?: string | null;
}

const SAMPLE_TRACK: Track = {
  id: "sample",
  title: "Blinding Lights",
  artist: "The Weeknd",
  album: "After Hours",
  source: "Spotify",
  duration: 200_000,
  progress: 84_000,
  isPlaying: true,
};

function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

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

function componentContent(component: OverlayComponentConfig, track: Track): React.ReactNode {
  switch (component.type) {
    case "artwork":
      return track.artwork ? (
        <img src={track.artwork} alt="" style={{ ...FILL_PARENT, objectFit: "cover", display: "block" }} />
      ) : (
        <div style={{ ...FILL_PARENT, backgroundColor: "rgba(255,255,255,0.08)" }} />
      );
    case "title":
      // Métadonnées absentes : on affiche un libellé propre plutôt qu'un
      // bloc vide, qui donnerait l'impression que l'overlay est cassé.
      return track.title || "Titre inconnu";
    case "artist":
      // Tous les artistes sont conservés tels quels ("A, B, C") : c'est le
      // provider qui décide du formatage, pas l'affichage.
      return track.artist || "Artiste inconnu";
    case "album":
      return track.album ?? "";
    case "source":
      return track.source ?? "";
    case "elapsedTime":
      return formatTime(track.progress);
    case "duration":
      return formatTime(track.duration);
    case "progressBar": {
      const pct =
        track.duration > 0
          ? Math.min(100, Math.max(0, (track.progress / track.duration) * 100))
          : 0;
      return (
        <div
          style={{
            ...FILL_PARENT,
            overflow: "hidden",
            backgroundColor: component.style.trackColor ?? "rgba(255,255,255,0.15)",
            borderRadius: component.style.borderRadius,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              backgroundColor: component.style.fillColor ?? "#FFFFFF",
              borderRadius: component.style.borderRadius,
            }}
          />
        </div>
      );
    }
    default:
      return null;
  }
}

function componentStyle(component: OverlayComponentConfig): CSSProperties {
  const s = component.style;
  const base: CSSProperties = {
    position: "absolute",
    left: component.transform.x,
    top: component.transform.y,
    width: component.transform.width,
    height: component.transform.height,
  };

  if (component.type === "artwork") {
    return {
      ...base,
      borderRadius: s.shape === "circle" ? "50%" : (s.borderRadius ?? 0),
      overflow: "hidden",
      border: s.borderWidth ? `${s.borderWidth}px solid ${s.borderColor ?? "transparent"}` : undefined,
      boxShadow: s.shadow ? "0 8px 24px -6px rgba(0,0,0,0.5)" : undefined,
    };
  }

  if (component.type === "progressBar") return base;

  return {
    ...base,
    fontSize: s.fontSize ?? 16,
    fontWeight: s.fontWeight ?? 400,
    color: s.color ?? "#FFFFFF",
    textAlign: s.textAlign ?? "left",
    opacity: s.opacity ?? 1,
    maxWidth: s.maxWidth,
    textTransform: s.textTransform ?? "none",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontFamily: "'Inter', system-ui, sans-serif",
  };
}

export function OverlayPreview({ overlay, track, scale = "fit", onSelectComponent, selectedComponentId }: OverlayPreviewProps) {
  // `track` omis (undefined) : contexte d'édition/miniature -> exemple réaliste.
  // `track` explicitement `null` : overlay OBS réel sans musique détectée pour
  // l'instant -> ne rien afficher (jamais de fausse donnée dans le vrai overlay).
  const effectiveTrack = track === undefined ? SAMPLE_TRACK : track;
  const { canvasWidth, canvasHeight } = overlay.theme;

  const wrapperStyle: CSSProperties =
    scale === "fit"
      ? {
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }
      : { width: canvasWidth, height: canvasHeight };

  return (
    <div style={wrapperStyle}>
      <div
        style={{
          position: "relative",
          width: canvasWidth,
          height: canvasHeight,
          transformOrigin: "center",
        }}
        className={scale === "fit" ? "origin-center scale-[0.32]" : ""}
      >
        {effectiveTrack &&
          [...overlay.components]
            .filter((c) => c.visible)
            .sort((a, b) => a.order - b.order)
            .map((component) => (
              <div
                key={component.id}
                style={componentStyle(component)}
                onClick={() => onSelectComponent?.(component.id)}
                className={
                  onSelectComponent
                    ? `cursor-pointer ${selectedComponentId === component.id ? "outline outline-2 outline-signal-500" : ""}`
                    : undefined
                }
              >
                {componentContent(component, effectiveTrack)}
              </div>
            ))}
      </div>
    </div>
  );
}
