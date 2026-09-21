import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Copy, Download, Link2, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useToastStore } from "@/stores/useToastStore";
import { useCopyObsUrl } from "@/hooks/useCopyObsUrl";
import { getPreset, listPresetIds } from "@/presets";
import { CANVAS_SIZES } from "@/utils/overlay-model";
import { formatRelativeDate, pickMainOverlay } from "@/utils/ui-helpers";
import type { OverlayConfig, PresetId } from "@/types/overlay";
import { OverlayPreview } from "@/components/OverlayPreview";
import { Button, DropdownMenu, Modal, PageHeader, StatusPill } from "@/components/ui";

const PRESET_LABELS: Record<PresetId, string> = {
  minimal: "Minimal",
  modern: "Modern",
  glass: "Glass",
  neon: "Neon",
  compact: "Compact",
  large: "Large",
  blank: "Vide",
};

const inputClass =
  "w-full rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-fg outline-none focus:border-signal-500";

/** Borne une dimension saisie : nombre fini, 20 px minimum, 7680 px maximum. */
const clampDimension = (n: number, fallback: number) =>
  Number.isFinite(n) && n >= 20 ? Math.min(7680, Math.round(n)) : fallback;

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
  const copyObsUrl = useCopyObsUrl();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [blankOpen, setBlankOpen] = useState(false);
  const [blankWidth, setBlankWidth] = useState(800);
  const [blankHeight, setBlankHeight] = useState(250);

  const mainId = pickMainOverlay(overlays, activeOverlayId)?.id ?? null;

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

  function closePicker() {
    setPickerOpen(false);
    setBlankOpen(false);
    setNewName("");
  }

  async function handleCreate(presetId: PresetId) {
    const overlay = await create(presetId, newName.trim() || undefined);
    closePicker();
    navigate(`/editor/${overlay.id}`);
  }

  /** Overlay sans aucun composant : on le construit de zéro dans l'éditeur. */
  async function handleCreateBlank() {
    const overlay = await create("blank", newName.trim() || "Nouvel overlay", {
      canvasWidth: clampDimension(blankWidth, 800),
      canvasHeight: clampDimension(blankHeight, 250),
    });
    closePicker();
    navigate(`/editor/${overlay.id}`);
  }

  function handleExport(overlay: OverlayConfig) {
    const blob = new Blob([JSON.stringify(overlay, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${overlay.name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    push("Overlay exporté (.json)", "success");
  }

  async function handleDuplicate(overlay: OverlayConfig) {
    await duplicate(overlay.id);
    push(`« ${overlay.name} » dupliqué`, "success");
  }

  async function handleSetMain(overlay: OverlayConfig) {
    await setActive(overlay.id);
    push(`« ${overlay.name} » est maintenant l'overlay principal`, "success");
  }

  const toDelete = overlays.find((o) => o.id === confirmDeleteId);

  return (
    <div className="mx-auto max-w-5xl px-8 py-10">
      <PageHeader
        title="Mes overlays"
        subtitle={overlays.length === 0 ? "Aucun overlay pour l'instant" : `${overlays.length} overlay${overlays.length > 1 ? "s" : ""}`}
        actions={
          <Button variant="primary" onClick={() => setPickerOpen(true)}>
            <Plus size={16} /> Nouvel overlay
          </Button>
        }
      />

      {overlays.length === 0 ? (
        <div className="mt-12 flex flex-col items-center gap-3 rounded-xl2 border border-dashed border-line py-16 text-center">
          <p className="text-sm font-medium text-fg">Créez votre premier overlay</p>
          <p className="max-w-sm text-xs text-muted">
            Choisissez un preset (Minimal, Glass, Neon...) ou partez d'un canvas vide, puis ajustez chaque élément dans l'éditeur.
          </p>
          <Button variant="primary" className="mt-2" onClick={() => setPickerOpen(true)}>
            <Plus size={16} /> Nouvel overlay
          </Button>
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-3">
          {overlays.map((overlay) => {
            const isMain = mainId === overlay.id;
            const modified = formatRelativeDate(overlay.updatedAt);
            return (
              <div key={overlay.id} className="rounded-xl2 border border-line bg-base-900">
                {/* Fond de scène fixe : l'overlay est fait pour se poser sur une vidéo, pas sur le fond de l'interface.
                    Un clic sur l'aperçu ouvre l'éditeur : c'est le geste le plus naturel. */}
                <button
                  onClick={() => navigate(`/editor/${overlay.id}`)}
                  className="group relative block aspect-video w-full overflow-hidden rounded-t-xl2 bg-stage"
                  title="Ouvrir dans l'éditeur"
                  aria-label={`Modifier ${overlay.name}`}
                >
                  <OverlayPreview overlay={overlay} scale="fit" />
                  {/* Voile posé sur la scène (fixe) : blanc en dur, indépendant du thème de l'interface. */}
                  <span
                    className="absolute inset-0 flex items-center justify-center bg-black/50 text-xs font-medium opacity-0 transition group-hover:opacity-100"
                    style={{ color: "#fff" }}
                  >
                    <Pencil size={13} className="mr-1.5" /> Modifier
                  </span>
                  {isMain && (
                    <span className="absolute right-2 top-2">
                      <StatusPill tone="ok"><Star size={10} /> Principal</StatusPill>
                    </span>
                  )}
                </button>
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-fg" title={overlay.name}>{overlay.name}</p>
                  <p className="mt-0.5 truncate text-[11px] text-muted">
                    {overlay.theme.canvasWidth} × {overlay.theme.canvasHeight}
                    {modified && ` · modifié ${modified}`}
                  </p>
                  <div className="mt-3 flex items-center gap-1.5">
                    <Button size="sm" variant="primary" className="flex-1" onClick={() => navigate(`/editor/${overlay.id}`)}>
                      <Pencil size={12} /> Modifier
                    </Button>
                    <Button size="sm" className="flex-1" onClick={() => void copyObsUrl(overlay.id)} title="Copier l'URL à coller dans OBS">
                      <Link2 size={12} /> URL OBS
                    </Button>
                    <DropdownMenu
                      label="Plus d'actions"
                      items={[
                        ...(isMain
                          ? []
                          : [{ label: "Définir comme principal", icon: <Check size={14} />, onClick: () => void handleSetMain(overlay) }]),
                        { label: "Dupliquer", icon: <Copy size={14} />, onClick: () => void handleDuplicate(overlay) },
                        { label: "Exporter (.json)", icon: <Download size={14} />, onClick: () => handleExport(overlay) },
                        { label: "Supprimer", icon: <Trash2 size={14} />, danger: true, onClick: () => setConfirmDeleteId(overlay.id) },
                      ]}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {overlays.length > 1 && (
        <p className="mt-4 text-xs text-faint">
          L'overlay « Principal » est celui dont l'URL OBS est proposée dans la barre latérale et le tableau de bord.
        </p>
      )}

      {pickerOpen && (
        <Modal title="Nouvel overlay" onClose={closePicker} widthClass="w-[760px]">
          <h2 className="font-display text-lg font-semibold text-fg">Nouvel overlay</h2>

          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] text-muted">Nom (facultatif)</span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex. Overlay stream principal"
              autoFocus
              className={inputClass}
            />
          </label>

          <p className="mb-2 mt-5 text-sm font-medium text-fg">Choisissez un point de départ</p>
          <div className="grid grid-cols-3 gap-3">
            {presetPreviews.map(({ id, overlay }) => (
              <button
                key={id}
                onClick={() => void handleCreate(id)}
                className="overflow-hidden rounded-lg border border-base-700 text-left transition hover:border-signal-500"
              >
                <div className="aspect-video bg-stage">
                  <OverlayPreview overlay={overlay} scale="fit" />
                </div>
                <p className="px-3 py-2 text-sm text-fg">{PRESET_LABELS[id]}</p>
              </button>
            ))}
            <button
              onClick={() => setBlankOpen((o) => !o)}
              aria-expanded={blankOpen}
              className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed px-3 py-6 text-sm transition hover:border-signal-500 ${
                blankOpen ? "border-signal-500 bg-base-800/60 text-fg" : "border-base-700 text-muted"
              }`}
            >
              <Plus size={18} />
              Canvas vide
            </button>
          </div>

          {blankOpen && (
            <div className="mt-4 rounded-xl border border-dashed border-signal-500/50 bg-base-800/40 p-4">
              <p className="text-xs text-muted">
                Aucun composant : vous ajoutez les éléments, le fond, les bordures et les ombres dans l'éditeur.
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {CANVAS_SIZES.map((size) => (
                  <button
                    key={size.label}
                    onClick={() => {
                      setBlankWidth(size.w);
                      setBlankHeight(size.h);
                    }}
                    className="rounded-md border border-base-700 px-2 py-1 text-[11px] text-muted hover:text-fg"
                  >
                    {size.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-[88px_88px_auto] items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">Largeur (px)</span>
                  <input type="number" value={blankWidth} onChange={(e) => setBlankWidth(Number(e.target.value))} className={inputClass} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] text-muted">Hauteur (px)</span>
                  <input type="number" value={blankHeight} onChange={(e) => setBlankHeight(Number(e.target.value))} className={inputClass} />
                </label>
                <Button variant="primary" onClick={() => void handleCreateBlank()}>
                  Créer
                </Button>
              </div>
            </div>
          )}
        </Modal>
      )}

      {toDelete && (
        <Modal title="Supprimer l'overlay" onClose={() => setConfirmDeleteId(null)}>
          <p className="text-fg">Supprimer « {toDelete.name} » ?</p>
          <p className="mt-1 text-sm text-muted">
            Cette action est définitive. Si l'overlay est utilisé dans OBS, la source n'affichera plus rien.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmDeleteId(null)}>Annuler</Button>
            <Button
              variant="danger"
              onClick={() => {
                void remove(toDelete.id);
                setConfirmDeleteId(null);
                push("Overlay supprimé", "success");
              }}
            >
              Supprimer
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
