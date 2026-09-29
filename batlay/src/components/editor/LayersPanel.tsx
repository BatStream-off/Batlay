import { useState } from "react";
import {
  Copy,
  Disc3,
  Eye,
  EyeOff,
  GripVertical,
  Hourglass,
  Image as ImageIcon,
  Lock,
  Minus,
  Plus,
  Radio,
  Square,
  Timer,
  Trash2,
  Type,
  TextQuote,
  Unlock,
  Users,
  Clock,
  ChevronUp,
  ChevronDown,
} from "lucide-react";
import type { OverlayComponentConfig, OverlayComponentType } from "@/types/overlay";
import {
  COMPONENT_DESCRIPTIONS,
  COMPONENT_LABELS,
  COMPONENT_TYPES,
  layerName,
  normalizeOrder,
} from "@/utils/overlay-model";

const ICONS: Record<OverlayComponentType, typeof Type> = {
  artwork: ImageIcon,
  title: Type,
  artist: Users,
  album: Disc3,
  progressBar: Minus,
  elapsedTime: Clock,
  remainingTime: Hourglass,
  duration: Timer,
  source: Radio,
  text: TextQuote,
  shape: Square,
};

interface LayersPanelProps {
  components: OverlayComponentConfig[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (type: OverlayComponentType) => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLocked: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** Déplace le calque à l'index `toIndex` de l'empilement (0 = tout en bas). */
  onReorder: (id: string, toIndex: number) => void;
}

export function LayersPanel(props: LayersPanelProps) {
  const { components, selectedId, onSelect, onAdd, onRemove, onDuplicate, onToggleVisible, onToggleLocked, onRename, onReorder } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  // Affichage de haut en bas = du calque le plus AU-DESSUS au plus en dessous.
  const stack = normalizeOrder(components);
  const rows = [...stack].reverse();

  return (
    <div className="flex h-full flex-col">
      <div className="relative border-b border-line p-3">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-signal-600 px-3 py-2 text-sm font-medium text-white hover:bg-signal-500"
        >
          <Plus size={14} /> Ajouter un composant
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
            <div className="absolute left-3 right-3 top-[52px] z-30 max-h-[60vh] overflow-y-auto rounded-xl border border-base-700 bg-base-900 p-1.5 shadow-glow">
              {COMPONENT_TYPES.map((type) => {
                const Icon = ICONS[type];
                return (
                  <button
                    key={type}
                    onClick={() => {
                      onAdd(type);
                      setMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-base-800"
                  >
                    <Icon size={15} className="shrink-0 text-accent" />
                    <span className="min-w-0">
                      <span className="block text-sm text-fg">{COMPONENT_LABELS[type]}</span>
                      <span className="block truncate text-[11px] text-muted">{COMPONENT_DESCRIPTIONS[type]}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2" onDragLeave={() => setOverIndex(null)}>
        {rows.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted">
            Overlay vide. Ajoutez un premier composant avec le bouton ci-dessus.
          </p>
        ) : (
          rows.map((c, rowIndex) => {
            const stackIndex = stack.length - 1 - rowIndex;
            const Icon = ICONS[c.type];
            const selected = selectedId === c.id;
            const dropHere = dragId !== null && overIndex === stackIndex && dragId !== c.id;
            return (
              <div
                key={c.id}
                draggable={renamingId !== c.id}
                onDragStart={(e) => {
                  setDragId(c.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", c.id);
                }}
                onDragOver={(e) => {
                  if (!dragId) return;
                  e.preventDefault();
                  setOverIndex(stackIndex);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== c.id) onReorder(dragId, stackIndex);
                  setDragId(null);
                  setOverIndex(null);
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOverIndex(null);
                }}
                onClick={() => onSelect(c.id)}
                className={`group mb-1 flex items-center gap-1.5 rounded-lg border px-1.5 py-1.5 text-sm transition ${
                  selected ? "border-signal-500/60 bg-base-800 text-fg" : "border-transparent text-muted hover:bg-base-800/60"
                } ${dropHere ? "border-t-2 border-t-signal-500" : ""} ${dragId === c.id ? "opacity-40" : ""}`}
              >
                <GripVertical size={13} className="shrink-0 cursor-grab text-faint" />
                <Icon size={14} className="shrink-0" />
                {renamingId === c.id ? (
                  <input
                    autoFocus
                    defaultValue={layerName(c)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      onRename(c.id, e.target.value);
                      setRenamingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded bg-base-700 px-1 text-sm text-fg outline-none"
                  />
                ) : (
                  <span
                    className={`min-w-0 flex-1 truncate ${c.visible ? "" : "line-through opacity-50"}`}
                    onDoubleClick={() => setRenamingId(c.id)}
                    title="Double-clic pour renommer"
                  >
                    {layerName(c)}
                  </span>
                )}

                <IconButton title={c.locked ? "Déverrouiller" : "Verrouiller"} onClick={() => onToggleLocked(c.id)} active={c.locked}>
                  {c.locked ? <Lock size={13} /> : <Unlock size={13} className="opacity-40" />}
                </IconButton>
                <IconButton title={c.visible ? "Masquer" : "Afficher"} onClick={() => onToggleVisible(c.id)}>
                  {c.visible ? <Eye size={13} /> : <EyeOff size={13} className="text-faint" />}
                </IconButton>
              </div>
            );
          })
        )}
      </div>

      {/* Actions sur le calque sélectionné : toujours visibles, jamais cachées sous un survol. */}
      {(() => {
        const stackIndex = stack.findIndex((c) => c.id === selectedId);
        const hasSelection = stackIndex !== -1;
        return (
          <div className="grid grid-cols-4 gap-1 border-t border-line p-2">
            <ActionButton
              title="Monter d'un cran (Ctrl+])"
              disabled={!hasSelection || stackIndex === stack.length - 1}
              onClick={() => selectedId && onReorder(selectedId, stackIndex + 1)}
            >
              <ChevronUp size={15} />
            </ActionButton>
            <ActionButton
              title="Descendre d'un cran (Ctrl+[)"
              disabled={!hasSelection || stackIndex === 0}
              onClick={() => selectedId && onReorder(selectedId, stackIndex - 1)}
            >
              <ChevronDown size={15} />
            </ActionButton>
            <ActionButton title="Dupliquer (Ctrl+D)" disabled={!hasSelection} onClick={() => selectedId && onDuplicate(selectedId)}>
              <Copy size={14} />
            </ActionButton>
            <ActionButton title="Supprimer (Suppr)" danger disabled={!hasSelection} onClick={() => selectedId && onRemove(selectedId)}>
              <Trash2 size={14} />
            </ActionButton>
          </div>
        );
      })()}
    </div>
  );
}

function ActionButton({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center rounded-md border border-base-700 bg-base-800 py-1.5 text-muted transition disabled:cursor-not-allowed disabled:opacity-30 ${
        danger ? "hover:border-red-500/50 hover:text-danger" : "hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}

function IconButton({
  children,
  title,
  onClick,
  danger,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded p-1 transition disabled:cursor-not-allowed disabled:opacity-25 ${
        danger ? "hover:bg-red-500/15 hover:text-danger" : "hover:bg-base-700 hover:text-fg"
      } ${active ? "text-accent" : ""}`}
    >
      {children}
    </button>
  );
}
