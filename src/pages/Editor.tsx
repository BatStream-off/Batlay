import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Save, Copy } from "lucide-react";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useToastStore } from "@/stores/useToastStore";
import { OverlayPreview } from "@/components/OverlayPreview";
import type { OverlayConfig, OverlayComponentConfig } from "@/types/overlay";

const COMPONENT_LABELS: Record<OverlayComponentConfig["type"], string> = {
  artwork: "Artwork",
  title: "Title",
  artist: "Artist",
  album: "Album",
  progressBar: "Progress Bar",
  elapsedTime: "Elapsed Time",
  duration: "Duration",
  source: "Source",
};

export function Editor() {
  const { overlayId } = useParams<{ overlayId: string }>();
  const navigate = useNavigate();
  const { getById, update } = useOverlayStore((s) => ({ getById: s.getById, update: s.update }));
  const push = useToastStore((s) => s.push);

  const [draft, setDraft] = useState<OverlayConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [obsUrl, setObsUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!overlayId) return;
    const overlay = getById(overlayId);
    if (!overlay) {
      push("Overlay introuvable", "error");
      navigate("/overlays");
      return;
    }
    setDraft(structuredClone(overlay));
    window.batlay.overlay
      .getUrl(overlayId)
      .then(setObsUrl)
      .catch((err) => {
        setObsUrl(null);
        push((err as Error).message || "Impossible de récupérer l'URL de l'overlay.", "error");
      });
  }, [overlayId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return null;

  const selected = draft.components.find((c) => c.id === selectedId) ?? null;

  function patchComponent(id: string, patch: Partial<OverlayComponentConfig>) {
    setDraft((d) =>
      d ? { ...d, components: d.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : d
    );
  }

  function patchComponentStyle(id: string, style: Partial<OverlayComponentConfig["style"]>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            components: d.components.map((c) =>
              c.id === id ? { ...c, style: { ...c.style, ...style } } : c
            ),
          }
        : d
    );
  }

  function patchTransform(id: string, patch: Partial<OverlayComponentConfig["transform"]>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            components: d.components.map((c) =>
              c.id === id ? { ...c, transform: { ...c.transform, ...patch } } : c
            ),
          }
        : d
    );
  }

  async function save() {
    if (!draft) return;
    await update(draft);
    push("Overlay saved", "success");
  }

  async function copyUrl() {
    if (!obsUrl) return;
    await navigator.clipboard.writeText(obsUrl);
    push("Overlay URL copied", "success");
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-base-800 px-6 py-4">
        <div>
          <p className="text-xs text-muted">Batlay Editor</p>
          <h1 className="font-display text-lg font-semibold text-white">{draft.name}</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            className="flex items-center gap-1.5 rounded-lg bg-signal-600 px-4 py-2 text-sm font-medium text-white hover:bg-signal-500"
          >
            <Save size={14} /> Save
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Components list */}
        <div className="w-56 shrink-0 overflow-y-auto border-r border-base-800 p-3">
          <p className="mb-2 px-2 text-xs font-medium uppercase text-muted">Components</p>
          {draft.components.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className={`mb-1 flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                selectedId === c.id ? "bg-base-800 text-white" : "text-muted hover:bg-base-800/60"
              }`}
            >
              <span>{COMPONENT_LABELS[c.type]}</span>
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  patchComponent(c.id, { visible: !c.visible });
                }}
              >
                {c.visible ? <Eye size={14} /> : <EyeOff size={14} className="text-base-600" />}
              </span>
            </button>
          ))}
        </div>

        {/* Live preview */}
        <div className="flex flex-1 items-center justify-center overflow-auto bg-[radial-gradient(circle,#1A1A22_1px,transparent_1px)] bg-[length:16px_16px] p-8">
          <div className="rounded-lg border border-dashed border-base-700 bg-base-950/40 p-2">
            <OverlayPreview
              overlay={draft}
              scale="1:1"
              onSelectComponent={setSelectedId}
              selectedComponentId={selectedId}
            />
          </div>
        </div>

        {/* Properties */}
        <div className="w-72 shrink-0 overflow-y-auto border-l border-base-800 p-4">
          <p className="mb-3 text-xs font-medium uppercase text-muted">Properties</p>
          {!selected ? (
            <p className="text-sm text-muted">Sélectionnez un composant pour le modifier.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-1.5 text-xs text-muted">Position</p>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="X" value={selected.transform.x} onChange={(v) => patchTransform(selected.id, { x: v })} />
                  <NumberField label="Y" value={selected.transform.y} onChange={(v) => patchTransform(selected.id, { y: v })} />
                </div>
              </div>
              <div>
                <p className="mb-1.5 text-xs text-muted">Size</p>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField label="W" value={selected.transform.width} onChange={(v) => patchTransform(selected.id, { width: v })} />
                  <NumberField label="H" value={selected.transform.height} onChange={(v) => patchTransform(selected.id, { height: v })} />
                </div>
              </div>

              {selected.type !== "artwork" && selected.type !== "progressBar" && (
                <div>
                  <p className="mb-1.5 text-xs text-muted">Typography</p>
                  <div className="grid grid-cols-2 gap-2">
                    <NumberField
                      label="Size"
                      value={selected.style.fontSize ?? 16}
                      onChange={(v) => patchComponentStyle(selected.id, { fontSize: v })}
                    />
                    <NumberField
                      label="Weight"
                      value={selected.style.fontWeight ?? 400}
                      step={100}
                      onChange={(v) => patchComponentStyle(selected.id, { fontWeight: v })}
                    />
                  </div>
                  <ColorField
                    label="Color"
                    value={selected.style.color ?? "#FFFFFF"}
                    onChange={(v) => patchComponentStyle(selected.id, { color: v })}
                  />
                </div>
              )}

              {selected.type === "artwork" && (
                <div>
                  <p className="mb-1.5 text-xs text-muted">Artwork</p>
                  <NumberField
                    label="Border radius"
                    value={selected.style.borderRadius ?? 0}
                    onChange={(v) => patchComponentStyle(selected.id, { borderRadius: v })}
                  />
                  <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      checked={selected.style.shadow ?? false}
                      onChange={(e) => patchComponentStyle(selected.id, { shadow: e.target.checked })}
                    />
                    Shadow
                  </label>
                </div>
              )}

              {selected.type === "progressBar" && (
                <div className="space-y-2">
                  <ColorField
                    label="Fill color"
                    value={selected.style.fillColor ?? "#FFFFFF"}
                    onChange={(v) => patchComponentStyle(selected.id, { fillColor: v })}
                  />
                </div>
              )}
            </div>
          )}

          {obsUrl && (
            <div className="mt-8 border-t border-base-800 pt-4">
              <p className="mb-1.5 text-xs font-medium uppercase text-muted">OBS Browser Source</p>
              <p className="mb-1 text-[11px] text-muted">Overlay URL</p>
              <div className="flex items-center gap-1.5 rounded-lg border border-base-700 bg-base-800 px-2 py-1.5">
                <code className="flex-1 truncate text-[11px] text-muted">{obsUrl}</code>
                <button onClick={copyUrl} className="text-muted hover:text-white">
                  <Copy size={13} />
                </button>
              </div>
              <p className="mt-2 text-[11px] text-muted">
                Recommended Size: {draft.theme.canvasWidth} × {draft.theme.canvasHeight}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-white outline-none focus:border-signal-500"
      />
    </label>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="mt-2 flex items-center justify-between text-[11px] text-muted">
      {label}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-6 w-10 rounded border border-base-700 bg-transparent" />
    </label>
  );
}
