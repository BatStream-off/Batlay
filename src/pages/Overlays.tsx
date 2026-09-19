import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Copy, Trash2, Download, Check, Link2 } from "lucide-react";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useToastStore } from "@/stores/useToastStore";
import { listPresetIds } from "@/presets";
import type { PresetId } from "@/types/overlay";
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

  async function handleCreate(presetId: PresetId) {
    const overlay = await create(presetId);
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
          <h1 className="font-display text-2xl font-semibold text-white">My Overlays</h1>
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
          <p className="text-xs text-base-600">Créez-en un pour commencer à personnaliser votre stream.</p>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {overlays.map((overlay) => (
            <div key={overlay.id} className="overflow-hidden rounded-xl2 border border-base-800 bg-base-900">
              <div className="relative aspect-video overflow-hidden bg-base-950">
                <OverlayPreview overlay={overlay} scale="fit" />
                {activeOverlayId === overlay.id && (
                  <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-live/15 px-2 py-0.5 text-[10px] font-medium text-live">
                    <Check size={10} /> Active
                  </span>
                )}
              </div>
              <div className="p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-white">{overlay.name}</p>
                  <span className="text-[10px] uppercase text-muted">{overlay.presetId}</span>
                </div>
                <div className="mt-2.5 flex flex-wrap gap-1.5 text-xs">
                  <button
                    onClick={() => navigate(`/editor/${overlay.id}`)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => duplicate(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-white"
                  >
                    <Copy size={12} className="inline" /> Duplicate
                  </button>
                  <button
                    onClick={() => handleExport(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-white"
                  >
                    <Download size={12} className="inline" /> Export
                  </button>
                  <button
                    onClick={() => handleCopyObsUrl(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-white"
                  >
                    <Link2 size={12} className="inline" /> OBS URL
                  </button>
                  {activeOverlayId !== overlay.id && (
                    <button
                      onClick={() => setActive(overlay.id)}
                      className="rounded-md border border-base-700 px-2.5 py-1 text-muted hover:text-white"
                    >
                      Activate
                    </button>
                  )}
                  <button
                    onClick={() => setConfirmDeleteId(overlay.id)}
                    className="rounded-md border border-base-700 px-2.5 py-1 text-red-400 hover:bg-red-500/10"
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={() => setPickerOpen(false)}>
          <div
            className="w-[480px] rounded-xl2 border border-base-800 bg-base-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display text-lg font-semibold text-white">Choose a preset</h2>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {listPresetIds().map((id) => (
                <button
                  key={id}
                  onClick={() => handleCreate(id)}
                  className="rounded-lg border border-base-700 py-3 text-sm text-white hover:border-signal-500 hover:bg-base-800"
                >
                  {PRESET_LABELS[id]}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60" onClick={() => setConfirmDeleteId(null)}>
          <div
            className="w-[380px] rounded-xl2 border border-base-800 bg-base-900 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-white">
              Delete "{overlays.find((o) => o.id === confirmDeleteId)?.name}"?
            </p>
            <p className="mt-1 text-sm text-muted">This action cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg border border-base-700 px-4 py-2 text-sm text-white hover:bg-base-800"
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
