import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { OverlayCanvas } from "@/components/OverlayPreview";
import type { ComponentTransform, OverlayComponentConfig, OverlayConfig } from "@/types/overlay";
import type { Track } from "@/types/track";
import type { ProgressReader } from "@/utils/progress-clock";
import { HANDLES, resizeRect, snapRect, type Guide, type Handle } from "@/utils/editor-geometry";

export type CanvasBackdrop = "checker" | "dark" | "light" | "green";

export const BACKDROPS: Record<CanvasBackdrop, CSSProperties> = {
  checker: { background: "conic-gradient(#2a2a34 25%, #1c1c24 0 50%, #2a2a34 0 75%, #1c1c24 0) 0 0 / 16px 16px" },
  dark: { background: "#0b0b10" },
  light: { background: "#e9e9ee" },
  // Fond vert : simule une scène OBS incrustée (chroma) pour juger les transparences.
  green: { background: "#14a04a" },
};

const HANDLE_CURSOR: Record<Handle, string> = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

const HANDLE_POS: Record<Handle, CSSProperties> = {
  nw: { left: 0, top: 0 }, n: { left: "50%", top: 0 }, ne: { left: "100%", top: 0 },
  e: { left: "100%", top: "50%" }, se: { left: "100%", top: "100%" },
  s: { left: "50%", top: "100%" }, sw: { left: 0, top: "100%" }, w: { left: 0, top: "50%" },
};

interface DragState {
  id: string;
  mode: "move" | Handle;
  startX: number;
  startY: number;
  start: ComponentTransform;
  /** Clé de fusion d'historique : tout le geste = une seule étape d'annulation. */
  key: string;
}

interface EditorCanvasProps {
  overlay: OverlayConfig;
  track: Track;
  reader: ProgressReader | null;
  zoom: number;
  backdrop: CanvasBackdrop;
  selectedId: string | null;
  snapEnabled: boolean;
  onSelect: (id: string | null) => void;
  onTransform: (id: string, transform: ComponentTransform, historyKey: string) => void;
}

const SNAP_THRESHOLD_PX = 6;

export function EditorCanvas({
  overlay,
  track,
  reader,
  zoom,
  backdrop,
  selectedId,
  snapEnabled,
  onSelect,
  onTransform,
}: EditorCanvasProps) {
  const { canvasWidth, canvasHeight } = overlay.theme;
  const dragRef = useRef<DragState | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const ordered = [...overlay.components].filter((c) => c.visible).sort((a, b) => a.order - b.order);

  function begin(e: ReactPointerEvent<HTMLElement>, component: OverlayComponentConfig, mode: DragState["mode"]) {
    e.stopPropagation();
    onSelect(component.id);
    if (component.locked || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      id: component.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...component.transform },
      key: `drag:${component.id}:${Date.now()}`,
    };
  }

  function move(e: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;

    let next: ComponentTransform;
    let nextGuides: Guide[] = [];

    if (drag.mode === "move") {
      let rect = { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy };
      // Maj : verrouille l'axe dominant, pour des déplacements parfaitement droits.
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) rect = { ...rect, y: drag.start.y };
        else rect = { ...rect, x: drag.start.x };
      }
      if (snapEnabled && !e.altKey) {
        const others = ordered.filter((c) => c.id !== drag.id).map((c) => c.transform);
        const snapped = snapRect(rect, others, { width: canvasWidth, height: canvasHeight }, SNAP_THRESHOLD_PX / zoom);
        rect = snapped.rect;
        nextGuides = snapped.guides;
      }
      next = { x: Math.round(rect.x), y: Math.round(rect.y), width: rect.width, height: rect.height };
    } else {
      // Maj : conserve les proportions ; Alt : redimensionne depuis le centre.
      next = resizeRect(drag.start, drag.mode, dx, dy, { keepAspect: e.shiftKey, fromCenter: e.altKey });
    }

    setGuides(nextGuides);
    onTransform(drag.id, next, drag.key);
  }

  function end(e: ReactPointerEvent<HTMLElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    setGuides([]);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }

  return (
    <div
      style={{
        position: "relative",
        width: canvasWidth * zoom,
        height: canvasHeight * zoom,
        outline: "1px dashed rgba(155,107,255,0.55)",
        outlineOffset: 0,
        ...BACKDROPS[backdrop],
      }}
    >
      {/* Rendu identique à la page OBS — y compris le rognage : tout ce qui dépasse du
          canvas est coupé par la Browser Source, l'aperçu doit donc le couper aussi. */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
        <div
          style={{ position: "absolute", left: 0, top: 0, width: canvasWidth, height: canvasHeight, transform: `scale(${zoom})`, transformOrigin: "top left" }}
        >
          <OverlayCanvas overlay={overlay} track={track} reader={reader} />
        </div>
      </div>

      {/* Calque d'interaction : une zone cliquable par composant, dans l'ordre d'empilement. */}
      <div
        style={{ position: "absolute", inset: 0 }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget) onSelect(null);
        }}
      >
        {ordered.map((c) => {
          const selected = c.id === selectedId;
          const t = c.transform;
          return (
            <div
              key={c.id}
              onPointerDown={(e) => begin(e, c, "move")}
              onPointerMove={move}
              onPointerUp={end}
              onPointerCancel={end}
              onPointerEnter={() => setHoverId(c.id)}
              onPointerLeave={() => setHoverId((h) => (h === c.id ? null : h))}
              style={{
                position: "absolute",
                left: t.x * zoom,
                top: t.y * zoom,
                width: t.width * zoom,
                height: t.height * zoom,
                cursor: c.locked ? "default" : "move",
                // Un composant verrouillé laisse passer les clics vers ceux du dessous.
                pointerEvents: c.locked && !selected ? "none" : "auto",
                outline: selected
                  ? "2px solid #9B6BFF"
                  : hoverId === c.id
                    ? "1px solid rgba(155,107,255,0.7)"
                    : undefined,
                touchAction: "none",
              }}
            >
              {selected &&
                !c.locked &&
                HANDLES.map((h) => (
                  <div
                    key={h}
                    onPointerDown={(e) => begin(e, c, h)}
                    onPointerMove={move}
                    onPointerUp={end}
                    onPointerCancel={end}
                    style={{
                      position: "absolute",
                      ...HANDLE_POS[h],
                      width: 10,
                      height: 10,
                      marginLeft: -5,
                      marginTop: -5,
                      background: "#fff",
                      border: "2px solid #9B6BFF",
                      borderRadius: 2,
                      cursor: HANDLE_CURSOR[h],
                      touchAction: "none",
                    }}
                  />
                ))}
            </div>
          );
        })}

        {guides.map((g, i) => (
          <div
            key={`${g.axis}-${i}`}
            style={{
              position: "absolute",
              pointerEvents: "none",
              background: "#ff3ea5",
              ...(g.axis === "x"
                ? { left: g.position * zoom, top: 0, width: 1, height: "100%" }
                : { top: g.position * zoom, left: 0, height: 1, width: "100%" }),
            }}
          />
        ))}
      </div>
    </div>
  );
}
