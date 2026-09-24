import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, Link2, Magnet, Minus, Plus, Redo2, RotateCcw, Save, Undo2 } from "lucide-react";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useToastStore } from "@/stores/useToastStore";
import { useMusicStore } from "@/stores/useMusicStore";
import { playbackClock } from "@/services/playback-clock";
import { SAMPLE_TRACK } from "@/components/OverlayPreview";
import { BACKDROPS, EditorCanvas, type CanvasBackdrop } from "@/components/editor/EditorCanvas";
import { ShortcutsHelp } from "@/components/editor/ShortcutsHelp";
import { Button, Modal } from "@/components/ui";
import { useCopyObsUrl } from "@/hooks/useCopyObsUrl";
import { LayersPanel } from "@/components/editor/LayersPanel";
import { PropertiesPanel } from "@/components/editor/PropertiesPanel";
import { SegmentedField } from "@/components/editor/fields";
import { useEditorHistory } from "@/hooks/useEditorHistory";
import type {
  ComponentStyle,
  ComponentTransform,
  OverlayComponentConfig,
  OverlayComponentType,
  OverlayConfig,
  OverlayTheme,
} from "@/types/overlay";
import type { ProgressReader } from "@/utils/progress-clock";
import { ZOOM_STEPS, clampZoom, stepZoom } from "@/utils/ui-helpers";
import { unsavedDrafts } from "@/utils/unsaved-drafts";
import {
  addComponent,
  alignInCanvas,
  createComponent,
  duplicateComponent,
  removeComponent,
  reorderTo,
  type AlignKind,
} from "@/utils/overlay-model";

/** Supprime les clés `undefined` (une propriété retirée doit disparaître du JSON, pas rester à undefined). */
function cleanStyle(style: ComponentStyle): ComponentStyle {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(style)) if (v !== undefined) out[k] = v;
  return out as ComponentStyle;
}

export function Editor() {
  const { overlayId } = useParams<{ overlayId: string }>();
  const navigate = useNavigate();
  const { overlays, loaded } = useOverlayStore((s) => ({ overlays: s.overlays, loaded: s.loaded }));
  const push = useToastStore((s) => s.push);
  const source = overlays.find((o) => o.id === overlayId);

  useEffect(() => {
    if (loaded && !source) {
      push("Overlay introuvable", "error");
      navigate("/overlays");
    }
  }, [loaded, source]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source) return null;
  return <EditorInner key={source.id} source={source} />;
}

function EditorInner({ source }: { source: OverlayConfig }) {
  const navigate = useNavigate();
  const update = useOverlayStore((s) => s.update);
  const push = useToastStore((s) => s.push);
  const liveTrack = useMusicStore((s) => s.playbackState.track);
  const copyObsUrl = useCopyObsUrl();

  const restored = useMemo(() => {
    const cached = unsavedDrafts.get(source.id);
    return cached && cached.baseUpdatedAt === source.updatedAt ? cached.draft : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const history = useEditorHistory<OverlayConfig>(restored ?? structuredClone(source));
  const draft = history.present;

  // Dernière version ENREGISTRÉE : sert à détecter les changements en attente et à les annuler.
  const [saved, setSaved] = useState<OverlayConfig>(source);
  const savedJson = useMemo(() => JSON.stringify(saved), [saved]);
  const dirty = useMemo(() => JSON.stringify(draft) !== savedJson, [draft, savedJson]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [zoomMode, setZoomMode] = useState<"fit" | number>("fit");
  const [backdrop, setBackdrop] = useState<CanvasBackdrop>("checker");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [previewMode, setPreviewMode] = useState<"sample" | "live">("sample");
  const [obsUrl, setObsUrl] = useState<string | null>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);

  const canvas = { width: draft.theme.canvasWidth, height: draft.theme.canvasHeight };
  const outsideCount = draft.components.filter((c) => {
    const t = c.transform;
    return c.visible && (t.x < 0 || t.y < 0 || t.x + t.width > canvas.width || t.y + t.height > canvas.height);
  }).length;
  const selected = draft.components.find((c) => c.id === selectedId) ?? null;

  // --- URL OBS ---
  useEffect(() => {
    window.batlay.overlay
      .getUrl(source.id)
      .then(setObsUrl)
      .catch((err) => {
        setObsUrl(null);
        push((err as Error).message || "Impossible de récupérer l'URL de l'overlay.", "error");
      });
  }, [source.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (restored) push("Brouillon non enregistré restauré.", "info");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Zoom « ajuster » : mesure la zone d'édition ---
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      const z = Math.min((width - 64) / canvas.width, (height - 64) / canvas.height);
      setFitZoom(Math.min(2, Math.max(0.1, Number.isFinite(z) ? z : 1)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [canvas.width, canvas.height]);
  const zoom = zoomMode === "fit" ? fitZoom : zoomMode;
  // Le zoom courant lu par les gestionnaires d'événements (clavier, molette) sans les réinscrire à chaque rendu.
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const zoomStep = (direction: 1 | -1) => setZoomMode(stepZoom(zoomRef.current, direction));
  const zoomFit = () => setZoomMode("fit");

  // Ctrl + molette = zoom continu. Écouteur natif non passif : celui de React est passif,
  // et preventDefault() y serait ignoré (la page se zoomerait en même temps).
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoomMode(clampZoom(zoomRef.current * Math.exp(-e.deltaY * 0.002)));
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const customZoom = zoomMode !== "fit" && !ZOOM_STEPS.some((z) => Math.abs(z - zoomMode) < 1e-6);

  // --- Aperçu : morceau d'exemple (barre qui boucle) ou musique en cours ---
  const sampleReader = useMemo<ProgressReader>(
    () => ({ read: (nowMs) => (SAMPLE_TRACK.progress + nowMs) % SAMPLE_TRACK.duration }),
    []
  );
  const useLive = previewMode === "live" && liveTrack !== null;
  const previewTrack = useLive ? liveTrack : SAMPLE_TRACK;
  const previewReader = useLive ? playbackClock : sampleReader;

  // --- Modifications (toutes passent par l'historique) ---
  const mapComponent = (id: string, fn: (c: OverlayComponentConfig) => OverlayComponentConfig, key?: string, windowMs?: number) =>
    history.apply(
      (d) => ({ ...d, components: d.components.map((c) => (c.id === id ? fn(c) : c)) }),
      { key, windowMs }
    );

  const patchComponent = (id: string, patch: Partial<OverlayComponentConfig>, key?: string) =>
    mapComponent(id, (c) => ({ ...c, ...patch }), key);

  const patchStyle = (id: string, patch: Partial<ComponentStyle>, key?: string) =>
    mapComponent(id, (c) => ({ ...c, style: cleanStyle({ ...c.style, ...patch }) }), key);

  const patchTransform = (id: string, patch: Partial<ComponentTransform>, key?: string) =>
    mapComponent(id, (c) => ({ ...c, transform: { ...c.transform, ...patch } }), key);

  const setTransform = (id: string, transform: ComponentTransform, key: string) =>
    // Un geste de souris entier = une seule étape d'annulation, quelle que soit sa durée.
    mapComponent(id, (c) => ({ ...c, transform }), key, Infinity);

  const patchTheme = (patch: Partial<OverlayTheme>, key?: string) =>
    history.apply((d) => ({ ...d, theme: { ...d.theme, ...patch } }), { key });

  function addNew(type: OverlayComponentType) {
    const component = createComponent(type, canvas, draft.components);
    history.apply((d) => ({ ...d, components: addComponent(d.components, component) }));
    setSelectedId(component.id);
  }

  function remove(id: string) {
    history.apply((d) => ({ ...d, components: removeComponent(d.components, id) }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }

  function duplicate(id: string) {
    const result = duplicateComponent(draft.components, id);
    if (!result.newId) return;
    history.apply((d) => ({ ...d, components: result.components }));
    setSelectedId(result.newId);
  }

  function align(id: string, kind: AlignKind) {
    const c = draft.components.find((x) => x.id === id);
    if (c) patchTransform(id, alignInCanvas(c.transform, canvas, kind));
  }

  async function save() {
    await update(draft);
    setSaved(structuredClone(draft));
    unsavedDrafts.delete(source.id);
    push("Overlay enregistré — appliqué en direct dans OBS", "success");
  }

  function revert() {
    history.reset(structuredClone(saved));
    setSelectedId(null);
  }

  // --- Raccourcis clavier (toujours sur la dernière version de l'état) ---
  /** Monte (+1) ou descend (-1) le calque sélectionné d'un cran dans l'empilement. */
  function moveSelected(delta: 1 | -1) {
    if (!selected) return;
    const index = [...draft.components].sort((a, b) => a.order - b.order).findIndex((c) => c.id === selected.id);
    history.apply((d) => ({ ...d, components: reorderTo(d.components, selected.id, index + delta) }));
  }

  const latest = useRef({ undo: history.undo, redo: history.redo, save, remove, duplicate, patchTransform, moveSelected, selected, zoomStep, zoomFit });
  latest.current = { undo: history.undo, redo: history.redo, save, remove, duplicate, patchTransform, moveSelected, selected, zoomStep, zoomFit };

  // Une fenêtre modale ouverte : les raccourcis ne doivent pas agir sur l'éditeur en arrière-plan (Suppr effacerait un calque).
  const modalOpen = useRef(false);
  modalOpen.current = confirmRevert;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (modalOpen.current) return;
      const l = latest.current;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (mod && key === "s") {
        e.preventDefault();
        void l.save();
        return;
      }

      // Dans un champ de saisie, les touches gardent leur sens habituel (annuler du texte, flèches...).
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]")) return;

      // Zoom : indépendant de la sélection. `code` pour le 0 : sur un clavier AZERTY la touche
      // du 0 produit « à » sans Maj, alors que sa position physique reste « Digit0 ».
      if (mod && (e.code === "Digit0" || e.code === "Numpad0" || key === "0")) {
        e.preventDefault();
        l.zoomFit();
        return;
      }
      if (mod && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        l.zoomStep(1);
        return;
      }
      if (mod && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        l.zoomStep(-1);
        return;
      }

      if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        l.undo();
      } else if (mod && (key === "y" || (key === "z" && e.shiftKey))) {
        e.preventDefault();
        l.redo();
      } else if (!l.selected) {
        if (e.key === "Escape") setSelectedId(null);
      } else if (mod && key === "d") {
        e.preventDefault();
        l.duplicate(l.selected.id);
      } else if (mod && (e.key === "]" || e.key === "[" || e.key === "ArrowUp" || e.key === "ArrowDown")) {
        // Ctrl + ↑/↓ en plus de Ctrl + ]/[ : ces deux crochets demandent AltGr sur un clavier AZERTY.
        e.preventDefault();
        l.moveSelected(e.key === "]" || e.key === "ArrowUp" ? 1 : -1);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        l.remove(l.selected.id);
      } else if (e.key === "Escape") {
        setSelectedId(null);
      } else if (e.key.startsWith("Arrow") && !l.selected.locked) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const t = l.selected.transform;
        const patch: Partial<ComponentTransform> =
          e.key === "ArrowLeft" ? { x: t.x - step }
          : e.key === "ArrowRight" ? { x: t.x + step }
          : e.key === "ArrowUp" ? { y: t.y - step }
          : { y: t.y + step };
        l.patchTransform(l.selected.id, patch, `nudge:${l.selected.id}`);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Quitter l'éditeur avec des changements : on garde le brouillon pour le retour.
  const exitState = useRef({ draft, dirty, baseUpdatedAt: source.updatedAt });
  exitState.current = { draft, dirty, baseUpdatedAt: source.updatedAt };
  useEffect(
    () => () => {
      const { draft: d, dirty: isDirty, baseUpdatedAt } = exitState.current;
      if (isDirty) unsavedDrafts.set(source.id, { draft: d, baseUpdatedAt });
      else unsavedDrafts.delete(source.id);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <button
            onClick={() => navigate("/overlays")}
            className="shrink-0 rounded-lg border border-base-700 p-2 text-muted hover:text-fg"
            title={dirty ? "Retour aux overlays (le brouillon est conservé)" : "Retour aux overlays"}
            aria-label="Retour aux overlays"
          >
            <ArrowLeft size={15} />
          </button>
          {/* Le nom se modifie directement ici, comme un titre de document. */}
          <input
            value={draft.name}
            onChange={(e) => history.apply((d) => ({ ...d, name: e.target.value }), { key: "overlay-name" })}
            onBlur={(e) => {
              if (!e.target.value.trim()) history.apply((d) => ({ ...d, name: "Sans titre" }), { key: "overlay-name" });
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Nom de l'overlay"
            title="Renommer l'overlay"
            className="min-w-0 max-w-sm flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-display text-lg font-semibold text-fg outline-none hover:border-base-700 focus:border-signal-500"
          />
          {dirty && (
            <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-warn-strong">
              non enregistré
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ToolbarButton title="Annuler (Ctrl+Z)" onClick={history.undo} disabled={!history.canUndo}>
            <Undo2 size={15} />
          </ToolbarButton>
          <ToolbarButton title="Rétablir (Ctrl+Y)" onClick={history.redo} disabled={!history.canRedo}>
            <Redo2 size={15} />
          </ToolbarButton>

          {dirty && (
            <Button onClick={() => setConfirmRevert(true)} title="Revenir à la dernière version enregistrée">
              <RotateCcw size={14} /> Abandonner
            </Button>
          )}
          <Button
            onClick={() => void copyObsUrl(source.id)}
            disabled={!obsUrl}
            title="Copier l'URL à coller dans une source « Navigateur » d'OBS"
          >
            <Link2 size={14} /> URL OBS
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={!dirty} title="Enregistrer (Ctrl+S)">
            {dirty ? (
              <>
                <Save size={14} /> Enregistrer
              </>
            ) : (
              <>
                <Check size={14} /> Enregistré
              </>
            )}
          </Button>
        </div>
      </header>

      {outsideCount > 0 && (
        <p className="border-b border-line bg-amber-500/10 px-4 py-1.5 text-xs text-warn">
          {outsideCount === 1 ? "1 composant dépasse" : `${outsideCount} composants dépassent`} du canvas : la partie qui
          dépasse sera coupée dans OBS. Agrandissez le canvas ou déplacez-le{outsideCount === 1 ? "" : "s"}.
        </p>
      )}

      {previewMode === "live" && !liveTrack && (
        <p className="border-b border-line bg-amber-500/10 px-4 py-1.5 text-xs text-warn">
          Aucune musique détectée pour l'instant (page Connexions) : le morceau d'exemple est affiché.
        </p>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 shrink-0 border-r border-line">
          <LayersPanel
            components={draft.components}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onAdd={addNew}
            onRemove={remove}
            onDuplicate={duplicate}
            onToggleVisible={(id) => patchComponent(id, { visible: !draft.components.find((c) => c.id === id)?.visible })}
            onToggleLocked={(id) => patchComponent(id, { locked: !draft.components.find((c) => c.id === id)?.locked })}
            onRename={(id, name) => patchComponent(id, { name: name.trim() || undefined })}
            onReorder={(id, toIndex) => history.apply((d) => ({ ...d, components: reorderTo(d.components, id, toIndex) }))}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Barre d'outils de l'aperçu : tout ce qui règle la VUE (rien de ce qui est enregistré). */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line px-3 py-2">
            <div className="flex items-center gap-2">
              <ToolbarButton
                title={snapEnabled ? "Magnétisme activé (Alt = temporairement désactivé)" : "Magnétisme désactivé"}
                onClick={() => setSnapEnabled((v) => !v)}
                active={snapEnabled}
              >
                <Magnet size={15} />
              </ToolbarButton>
              <div className="flex items-center gap-1" role="group" aria-label="Fond derrière l'aperçu">
                {(
                  [
                    ["checker", "Damier"],
                    ["dark", "Sombre"],
                    ["light", "Clair"],
                    ["green", "Vert (scène)"],
                  ] as [CanvasBackdrop, string][]
                ).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setBackdrop(value)}
                    title={`Fond : ${label} (pas enregistré : c'est la scène d'OBS qui sera derrière)`}
                    aria-label={`Fond ${label}`}
                    aria-pressed={backdrop === value}
                    className={`h-6 w-6 rounded-md border-2 transition ${
                      backdrop === value ? "border-signal-500" : "border-base-700 hover:border-base-600"
                    }`}
                    style={BACKDROPS[value]}
                  />
                ))}
              </div>
              <SegmentedField
                value={previewMode}
                onChange={setPreviewMode}
                options={[
                  { label: "Exemple", value: "sample", title: "Morceau d'exemple avec barre animée" },
                  { label: "En direct", value: "live", title: "Musique actuellement détectée" },
                ]}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <ToolbarButton title="Dézoomer (Ctrl+-)" onClick={() => zoomStep(-1)}>
                <Minus size={15} />
              </ToolbarButton>
              <select
                value={zoomMode === "fit" ? "fit" : String(zoomMode)}
                onChange={(e) => {
                  setZoomMode(e.target.value === "fit" ? "fit" : Number(e.target.value));
                  // Rend le focus : tant qu'un <select> l'a, les raccourcis (Suppr, flèches...) sont ignorés.
                  e.currentTarget.blur();
                }}
                className="rounded-lg border border-base-700 bg-base-800 px-2 py-2 text-xs text-fg outline-none"
                title="Zoom (Ctrl+0 pour ajuster)"
                aria-label="Zoom"
              >
                <option value="fit">Ajusté ({Math.round(fitZoom * 100)} %)</option>
                {customZoom && <option value={String(zoomMode)}>{Math.round((zoomMode as number) * 100)} %</option>}
                {ZOOM_STEPS.map((z) => (
                  <option key={z} value={String(z)}>{Math.round(z * 100)} %</option>
                ))}
              </select>
              <ToolbarButton title="Zoomer (Ctrl++)" onClick={() => zoomStep(1)}>
                <Plus size={15} />
              </ToolbarButton>
              <ShortcutsHelp />
            </div>
          </div>

          <div
            ref={stageRef}
            // Cliquer dans le vide (autour du canvas) désélectionne, comme dans tout éditeur graphique.
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelectedId(null);
            }}
            className="flex flex-1 overflow-auto bg-[radial-gradient(circle,rgb(var(--grid))_1px,transparent_1px)] bg-[length:16px_16px] p-8"
          >
            <div className="m-auto">
              <EditorCanvas
                overlay={draft}
                track={previewTrack}
                reader={previewReader}
                zoom={zoom}
                backdrop={backdrop}
                selectedId={selectedId}
                snapEnabled={snapEnabled}
                onSelect={setSelectedId}
                onTransform={setTransform}
              />
              {draft.components.length === 0 && (
                <p className="mt-6 text-center text-sm text-muted">
                  Overlay vide — ajoutez des composants depuis la palette de gauche, ou réglez le fond de l'overlay à droite.
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="w-80 shrink-0 overflow-y-auto border-l border-line">
          <PropertiesPanel
            overlay={draft}
            selected={selected}
            obsUrl={obsUrl}
            onCopyUrl={() => void copyObsUrl(source.id)}
            onPatchComponent={patchComponent}
            onPatchTransform={patchTransform}
            onPatchStyle={patchStyle}
            onAlign={align}
            onPatchTheme={patchTheme}
            onRenameOverlay={(name) => history.apply((d) => ({ ...d, name }), { key: "overlay-name" })}
          />
        </div>
      </div>

      {confirmRevert && (
        <Modal title="Abandonner les modifications" onClose={() => setConfirmRevert(false)}>
          <p className="text-fg">Abandonner les modifications non enregistrées ?</p>
          <p className="mt-1 text-sm text-muted">
            L'overlay revient à sa dernière version enregistrée. L'historique d'annulation est effacé : cette action ne
            peut pas être défaite.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button onClick={() => setConfirmRevert(false)}>Continuer l'édition</Button>
            <Button
              variant="danger"
              onClick={() => {
                revert();
                setConfirmRevert(false);
              }}
            >
              Abandonner
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  title,
  onClick,
  disabled,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg border p-2 transition disabled:cursor-not-allowed disabled:opacity-30 ${
        active ? "border-signal-500 bg-signal-600/20 text-fg" : "border-base-700 text-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
