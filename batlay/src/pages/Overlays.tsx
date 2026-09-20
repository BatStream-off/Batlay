import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Copy, Trash2, Download, Check, Link2 } from "lucide-react";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useToastStore } from "@/stores/useToastStore";
import { getPreset, listPresetIds } from "@/presets";
import type { OverlayConfig, PresetId } from "@/types/overlay";
import { OverlayPreview } from "@/components/OverlayPreview";

const PRESET_LABELS: Record<PresetId, string> = {
  minimal: "Minimal",
  modern: "Modern",
  glass: "Glass",
  neon: "Neon",
  compact: "Compact",
  large: "Large",
  blank: "Blank",
};

export function Overlays() {
  const navigate = useNavigate();
  const { overlays, activeOverlayId, create, remove, duplicate, setActive } = useOverlayStore((s) => ({
    overlays: s.overlays,
    activeOverlayId: s.activeOverlayId,
    create: s.create,
    remove: s.remove,
    duplicate: s.duplicate,
    setActive: s.setActive,
  }));
  const push = useToastStore((s) => s.push);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [blankName, setBlankName] = useState("Nouvel overlay");
  const [blankWidth, setBlankWidth] = useState(800);
  const [blankHeight, setBlankHeight] = useState(250);

  // Miniatures des presets dans la fenêtre de création.
  const presetPreviews = useMemo(
    () =>
      listPresetIds()
        .filter((id) => id !== "blank")
        .map((id) => ({
          id,
          overlay: { ...getPreset(id), id: `preview-${id}`, name: PRESET_LABELS[id], createdAt: 0, updatedAt: 0 } as OverlayConfig,
        })),
    []
  );

  async function handleCreate(presetId: PresetId) {
    const overlay = await create(presetId);
    setPickerOpen(false);
    navigate(`/editor/${overlay.id}`);
  }

  /** Overlay sans aucun composant : on le construit de zéro dans l'éditeur. */
  async function handleCreateBlank() {
    const clamp = (n: number, fallback: number) => (Number.isFinite(n) && n >= 20 ? Math.min(7680, Math.round(n)) : fallback);
    const overlay = await create("blank", blankName.trim() || "Nouvel overlay", {
      canvasWidth: clamp(blankWidth, 800),
      canvasHeight: clamp(blankHeight, 250),
    });
    setPickerOpen(false);
    navigate(`/editor/${overlay.id}`);
  }

  async function handleCopyObsUrl(id: string) {
    try {
      const url = await window.batlay.overlay.getUrl(id);
      await navigator.clipboard.writeText(url);
      push("Overlay URL copied", "success");
    } catch (err) {
      push(
        (err as Error).message || "Impossible de récupérer l'URL — le serveur d'overlay est-il démarré ?",
        "error"
      );
    }
  }

  async function handleExport(id: string) {
    const overlay = overlays.find((o) => o.id === id);
    if (!overlay) return;
    const blob = new Blob([JSON.stringify(overlay, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${overlay.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    push("Overlay exported", "success");
  }

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-fg">My Overlays</h1>
          <p className="mt-1 text-sm text-muted">{overlays.length} overlay(s)</p>
        </div>
        <button
          onClick={() => setPickerOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-signal-600 px-4 py-2 text-sm font-medium text-white hover:bg-signal-500"
        >
          <Plus size={16} /> Create Overlay
        </button>
      </div>

      {overlays.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-2 text-center text-muted">
          <p className="text-sm">Aucun overlay pour l'instant.</p>
          <p className="text-xs text-faint">Créez-en un pour commencer à personnaliser votre stream.</p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {overlays.map((overlay) => (
            <div key={overlay.id} className="overflow-hidden rounded-xl2 border border-line bg-base-900">
              {/* Fond de scène fixe : l'overlay est fait pour se poser sur une vidéo, pas sur le fond de l'interface. */}
              <div className="relative aspect-video overflow-hidden bg-stage">
                <OverlayPreview overlay={overlay} scale="fit" />
                {activeOverlayId === overlay.id && (
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-live/15 px-2 py-0.5 text-[10px] font-medium text-live">
                    <Check size={10} /> Active
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-medium text-fg" title={overlay.name}>{overlay.name}</p>
                  <span className="shrink-0 text-[10px] uppercase text-muted">{overlay.presetId}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
                  <button
                    onClick={() => navigate(`/editor/${overlay.id}`)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-fg"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => duplicate(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-fg"
                  >
                    <Copy size={12} className="inline" /> Duplicate
                  </button>
                  <button
                    onClick={() => handleExport(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-fg"
                  >
                    <Download size={12} className="inline" /> Export
                  </button>
                  <button
                    onClick={() => handleCopyObsUrl(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-fg"
                  >
                    <Link2 size={12} className="inline" /> OBS URL
                  </button>
                  {activeOverlayId !== overlay.id && (
                    <button
                      onClick={() => setActive(overlay.id)}
                      className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-fg"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmDeleteId(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-danger hover:bg-red-500/10"
                  >
                    <Trash2 size={12} className="inline" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {pickerOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={() => setPickerOpen(false)}>
          <div
            className="max-h-full w-[760px] overflow-y-auto rounded-xl2 border border-line bg-base-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-semibold text-fg">Créer un overlay</h2>

            <div className="mt-4 rounded-xl border border-dashed border-signal-500/50 bg-base-800/40 p-4">
              <p className="text-sm font-medium text-fg">Partir de zéro</p>
              <p className="mt-0.5 text-xs text-muted">
                Un canvas vide : vous ajoutez les composants, le fond, les bordures et les ombres dans l'éditeur.
              </p>
              <div className="mt-3 grid grid-cols-[1fr_88px_88px_auto] items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">Nom</span>
                  <input
                    value={blankName}
                    onChange={(e) => setBlankName(e.target.value)}
                    className="w-full rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-fg outline-none focus:border-signal-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">Largeur</span>
                  <input
                    type="number"
                    value={blankWidth}
                    onChange={(e) => setBlankWidth(Number(e.target.value))}
                    className="w-full rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-fg outline-none focus:border-signal-500"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">Hauteur</span>
                  <input
                    type="number"
                    value={blankHeight}
                    onChange={(e) => setBlankHeight(Number(e.target.value))}
                    className="w-full rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-fg outline-none focus:border-signal-500"
                  />
                </label>
                <button
                  onClick={handleCreateBlank}
                  className="rounded-lg bg-signal-600 px-4 py-2 text-sm font-medium text-white hover:bg-signal-500"
                >
                  Créer
                </button>
              </div>
            </div>

            <p className="mb-2 mt-6 text-sm font-medium text-fg">Ou choisir un preset</p>
            <div className="grid grid-cols-3 gap-3">
              {presetPreviews.map(({ id, overlay }) => (
                <button
                  key={id}
                  onClick={() => handleCreate(id)}
                  className="overflow-hidden rounded-lg border border-base-700 text-left hover:border-signal-500"
                >
                  <div className="aspect-video bg-stage">
                    <OverlayPreview overlay={overlay} scale="fit" />
                  </div>
                  <p className="px-3 py-2 text-sm text-fg">{PRESET_LABELS[id]}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={() => setConfirmDeleteId(null)}>
          <div
            className="w-[380px] rounded-xl2 border border-line bg-base-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-fg">
              Delete "{overlays.find((o) => o.id === confirmDeleteId)?.name}"?
            </p>
            <p className="mt-1 text-sm text-muted">This action cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-base-700 px-4 py-2 text-sm text-fg hover:bg-base-800"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  remove(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
