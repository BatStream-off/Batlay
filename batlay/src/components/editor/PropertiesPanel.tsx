import {
  AlignCenterHorizontal,
  AlignEndHorizontal,
  AlignStartHorizontal,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  Copy,
} from "lucide-react";
import type {
  BorderConfig,
  ComponentStyle,
  ComponentTransform,
  FillConfig,
  OverlayComponentConfig,
  OverlayConfig,
  OverlayTheme,
  ShadowConfig,
} from "@/types/overlay";
import { FONT_OPTIONS, resolveBorder, resolveBoxShadow, resolveFill } from "@/utils/overlay-style";
import { COMPONENT_LABELS, type AlignKind } from "@/utils/overlay-model";
import { BorderEditor, FillEditor, ShadowEditor } from "./StyleEditors";
import { ColorField, NumberField, Section, SegmentedField, SelectField, SliderField, TextField, ToggleField } from "./fields";

const TEXT_TYPES = new Set(["title", "artist", "album", "source", "elapsedTime", "remainingTime", "duration", "text"]);
const OVERFLOW_TYPES = new Set(["title", "artist", "album", "source", "text"]);
const pct = (v: number) => `${Math.round(v * 100)} %`;

const CANVAS_SIZES = [
  { label: "Compact 420 × 96", w: 420, h: 96 },
  { label: "Standard 780 × 220", w: 780, h: 220 },
  { label: "Large 960 × 300", w: 960, h: 300 },
  { label: "Plein écran 1920 × 1080", w: 1920, h: 1080 },
];

const SEPARATORS = [
  { label: "Virgule  ,", value: ", " },
  { label: "Point médian  ·", value: " · " },
  { label: "Puce  •", value: " • " },
  { label: "Esperluette  &", value: " & " },
  { label: "Barre oblique  /", value: " / " },
  { label: "Tiret  –", value: " – " },
];

interface PropertiesPanelProps {
  overlay: OverlayConfig;
  selected: OverlayComponentConfig | null;
  obsUrl: string | null;
  onCopyUrl: () => void;
  onPatchComponent: (id: string, patch: Partial<OverlayComponentConfig>, key?: string) => void;
  onPatchTransform: (id: string, patch: Partial<ComponentTransform>, key?: string) => void;
  onPatchStyle: (id: string, patch: Partial<ComponentStyle>, key?: string) => void;
  onAlign: (id: string, kind: AlignKind) => void;
  onPatchTheme: (patch: Partial<OverlayTheme>, key?: string) => void;
  onRenameOverlay: (name: string) => void;
}

export function PropertiesPanel(props: PropertiesPanelProps) {
  const { selected } = props;
  return (
    <div className="px-4 pb-6">
      {selected ? <ComponentProperties {...props} component={selected} /> : <OverlayProperties {...props} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Composant sélectionné
// ---------------------------------------------------------------------------

function ComponentProperties(props: PropertiesPanelProps & { component: OverlayComponentConfig }) {
  const { component: c, onPatchComponent, onPatchTransform, onPatchStyle, onAlign } = props;
  const s = c.style;
  const style = (patch: Partial<ComponentStyle>, key?: string) => onPatchStyle(c.id, patch, key ?? `style:${c.id}:${Object.keys(patch).join(",")}`);
  const transform = (patch: Partial<ComponentTransform>) => onPatchTransform(c.id, patch, `tf:${c.id}:${Object.keys(patch).join(",")}`);
  const isText = TEXT_TYPES.has(c.type);

  const border = resolveBorder(s);
  const hasShadow = resolveBoxShadow(s) !== undefined;

  return (
    <>
      <div className="border-b border-line py-3">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-accent">{COMPONENT_LABELS[c.type]}</p>
        <TextField
          label="Nom du calque"
          value={c.name ?? ""}
          placeholder={COMPONENT_LABELS[c.type]}
          onChange={(name) => onPatchComponent(c.id, { name }, `name:${c.id}`)}
        />
      </div>

      <Section title="Position et taille">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={c.transform.x} suffix="px" onChange={(x) => transform({ x })} />
          <NumberField label="Y" value={c.transform.y} suffix="px" onChange={(y) => transform({ y })} />
          <NumberField label="Largeur" value={c.transform.width} min={1} suffix="px" onChange={(width) => transform({ width })} />
          <NumberField label="Hauteur" value={c.transform.height} min={1} suffix="px" onChange={(height) => transform({ height })} />
        </div>
        <div>
          <span className="mb-1 block text-[11px] text-muted">Aligner sur le canvas</span>
          <div className="flex gap-1">
            {(
              [
                ["left", AlignHorizontalJustifyStart, "À gauche"],
                ["centerH", AlignHorizontalJustifyCenter, "Centrer horizontalement"],
                ["right", AlignHorizontalJustifyEnd, "À droite"],
                ["top", AlignStartHorizontal, "En haut"],
                ["middleV", AlignCenterHorizontal, "Centrer verticalement"],
                ["bottom", AlignEndHorizontal, "En bas"],
              ] as [AlignKind, typeof Copy, string][]
            ).map(([kind, Icon, title]) => (
              <button
                key={kind}
                title={title}
                onClick={() => onAlign(c.id, kind)}
                className="flex-1 rounded-md border border-base-700 bg-base-800 py-1.5 text-muted hover:text-fg"
              >
                <Icon size={14} className="mx-auto" />
              </button>
            ))}
          </div>
        </div>
        <ToggleField label="Verrouillé (ni déplacé ni redimensionné à la souris)" checked={!!c.locked} onChange={(locked) => onPatchComponent(c.id, { locked })} />
        <p className="text-[10px] text-faint">
          Astuces : Maj = proportions / axe droit · Alt = depuis le centre / sans magnétisme · flèches = 1 px (Maj : 10 px).
        </p>
      </Section>

      {c.type === "text" && (
        <Section title="Contenu">
          <TextField
            label="Texte"
            multiline
            value={c.content ?? ""}
            onChange={(content) => onPatchComponent(c.id, { content }, `content:${c.id}`)}
            hint="Variables : {title} {artist} {album} {source}"
          />
        </Section>
      )}

      {isText && (
        <Section title="Texte">
          <SelectField
            label="Police (installée sur le PC d'OBS)"
            value={FONT_OPTIONS.find((f) => f.value === s.fontFamily)?.value ?? FONT_OPTIONS[0].value}
            onChange={(fontFamily) => style({ fontFamily })}
            options={FONT_OPTIONS}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Taille" value={s.fontSize ?? 16} min={6} max={400} suffix="px" onChange={(fontSize) => style({ fontSize })} />
            <SelectField
              label="Graisse"
              value={s.fontWeight ?? 400}
              onChange={(fontWeight) => style({ fontWeight })}
              options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ label: String(w), value: w }))}
            />
          </div>
          <ColorField label="Couleur" value={s.color ?? "#FFFFFF"} onChange={(color) => style({ color })} />
          <SegmentedField
            label="Alignement horizontal"
            value={s.textAlign ?? "left"}
            onChange={(textAlign) => style({ textAlign })}
            options={[
              { label: "Gauche", value: "left" },
              { label: "Centre", value: "center" },
              { label: "Droite", value: "right" },
            ]}
          />
          <SegmentedField
            label="Alignement vertical"
            value={s.verticalAlign ?? "top"}
            onChange={(verticalAlign) => style({ verticalAlign })}
            options={[
              { label: "Haut", value: "top" },
              { label: "Milieu", value: "middle" },
              { label: "Bas", value: "bottom" },
            ]}
          />
          <SelectField
            label="Casse"
            value={s.textTransform ?? "none"}
            onChange={(textTransform) => style({ textTransform })}
            options={[
              { label: "Normale", value: "none" },
              { label: "MAJUSCULES", value: "uppercase" },
              { label: "minuscules", value: "lowercase" },
              { label: "Initiales En Majuscule", value: "capitalize" },
            ]}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Espacement lettres" value={s.letterSpacing ?? 0} step={0.5} suffix="px" onChange={(letterSpacing) => style({ letterSpacing })} />
            <NumberField label="Interligne" value={s.lineHeight ?? 0} step={0.1} min={0} max={4} onChange={(lineHeight) => style({ lineHeight })} />
          </div>
          <ToggleField label="Italique" checked={!!s.italic} onChange={(italic) => style({ italic })} />

          {OVERFLOW_TYPES.has(c.type) && (
            <>
              <SelectField
                label="Si le texte est trop long"
                value={s.overflow ?? (c.type === "artist" ? "marquee" : "ellipsis")}
                onChange={(overflow) => style({ overflow })}
                options={[
                  { label: "Défiler (si trop long)", value: "marquee" },
                  { label: "Couper avec …", value: "ellipsis" },
                  { label: "Passer à la ligne", value: "wrap" },
                ]}
              />
              {(s.overflow ?? (c.type === "artist" ? "marquee" : "ellipsis")) === "marquee" && (
                <SliderField label="Vitesse de défilement" value={s.marqueeSpeed ?? 40} min={10} max={200} step={5} format={(v) => `${v} px/s`} onChange={(marqueeSpeed) => style({ marqueeSpeed })} />
              )}
            </>
          )}
          {(c.type === "artist" || c.type === "text") && (
            <SelectField
              label="Séparateur des artistes"
              value={s.artistSeparator ?? ", "}
              onChange={(artistSeparator) => style({ artistSeparator })}
              options={SEPARATORS}
            />
          )}
        </Section>
      )}

      {isText && (
        <Section title="Ombre du texte" defaultOpen={false}>
          <ShadowEditor isText value={s.textShadow} onChange={(textShadow: ShadowConfig) => style({ textShadow }, `style:${c.id}:textShadow`)} />
        </Section>
      )}

      {c.type === "artwork" && (
        <Section title="Pochette">
          <SegmentedField
            label="Forme"
            value={s.shape ?? "square"}
            onChange={(shape) => style({ shape })}
            options={[
              { label: "Carrée", value: "square" },
              { label: "Ronde", value: "circle" },
            ]}
          />
          <SegmentedField
            label="Ajustement de l'image"
            value={s.objectFit ?? "cover"}
            onChange={(objectFit) => style({ objectFit })}
            options={[
              { label: "Remplir", value: "cover" },
              { label: "Contenir", value: "contain" },
            ]}
          />
        </Section>
      )}

      {c.type === "progressBar" && (
        <Section title="Barre de progression">
          <ColorField label="Remplissage" value={s.fillColor ?? "#FFFFFF"} onChange={(fillColor) => style({ fillColor })} />
          <ColorField label="Piste" value={s.trackColor ?? "rgba(255,255,255,0.15)"} onChange={(trackColor) => style({ trackColor })} />
        </Section>
      )}

      <Section title="Fond">
        <FillEditor
          value={resolveFill(s)}
          onChange={(background: FillConfig) => style({ background, backgroundColor: undefined, backgroundOpacity: undefined }, `style:${c.id}:bg`)}
        />
        {isText || c.type === "shape" ? (
          <NumberField label="Marge intérieure" value={s.padding ?? 0} min={0} suffix="px" onChange={(padding) => style({ padding })} />
        ) : null}
      </Section>

      <Section title="Bordure et arrondi">
        <BorderEditor
          value={border}
          onChange={(b: BorderConfig) => style({ border: b, borderWidth: undefined, borderColor: undefined }, `style:${c.id}:border`)}
        />
        {c.type !== "artwork" || s.shape !== "circle" ? (
          <NumberField label="Rayon des coins" value={s.borderRadius ?? 0} min={0} suffix="px" onChange={(borderRadius) => style({ borderRadius })} />
        ) : (
          <p className="text-[10px] text-faint">Forme ronde : le rayon est ignoré.</p>
        )}
      </Section>

      <Section title="Ombre" defaultOpen={hasShadow}>
        <ShadowEditor
          value={s.boxShadow ?? (hasShadow ? { enabled: true, x: 0, y: 8, blur: 24, spread: -6, color: "#000000", opacity: 0.5 } : undefined)}
          onChange={(boxShadow: ShadowConfig) => style({ boxShadow, shadow: undefined }, `style:${c.id}:shadow`)}
        />
      </Section>

      <Section title="Opacité globale" defaultOpen={false}>
        <SliderField label="Opacité du composant" value={s.opacity ?? 1} min={0} max={1} step={0.01} format={pct} onChange={(opacity) => style({ opacity })} />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Overlay entier (aucune sélection)
// ---------------------------------------------------------------------------

function OverlayProperties({ overlay, obsUrl, onCopyUrl, onPatchTheme, onRenameOverlay }: PropertiesPanelProps) {
  const t = overlay.theme;
  const theme = (patch: Partial<OverlayTheme>, key?: string) => onPatchTheme(patch, key ?? `theme:${Object.keys(patch).join(",")}`);
  return (
    <>
      <div className="border-b border-line py-3">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-accent">Overlay</p>
        <TextField label="Nom" value={overlay.name} onChange={onRenameOverlay} />
        <p className="mt-2 text-[11px] text-muted">Sélectionnez un composant pour le modifier.</p>
      </div>

      <Section title="Taille du canvas">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Largeur" value={t.canvasWidth} min={20} max={7680} suffix="px" onChange={(canvasWidth) => theme({ canvasWidth })} />
          <NumberField label="Hauteur" value={t.canvasHeight} min={20} max={4320} suffix="px" onChange={(canvasHeight) => theme({ canvasHeight })} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CANVAS_SIZES.map((sz) => (
            <button
              key={sz.label}
              onClick={() => theme({ canvasWidth: sz.w, canvasHeight: sz.h }, `theme:size`)}
              className="rounded-md border border-base-700 px-2 py-1 text-[11px] text-muted hover:text-fg"
            >
              {sz.label}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-faint">
          C'est la taille à saisir dans la Browser Source d'OBS. Une ombre qui dépasse du canvas est coupée : laissez une marge.
        </p>
      </Section>

      <Section title="Fond de l'overlay">
        <FillEditor value={t.background} onChange={(background) => theme({ background }, "theme:bg")} />
      </Section>

      <Section title="Bordure et arrondi">
        <BorderEditor value={t.border} onChange={(border) => theme({ border }, "theme:border")} />
        <NumberField label="Rayon des coins" value={t.borderRadius ?? 0} min={0} suffix="px" onChange={(borderRadius) => theme({ borderRadius })} />
      </Section>

      <Section title="Ombre" defaultOpen={false}>
        <ShadowEditor value={t.boxShadow} onChange={(boxShadow) => theme({ boxShadow }, "theme:shadow")} />
      </Section>

      {obsUrl && (
        <div className="mt-2 border-t border-line pt-4">
          <p className="mb-1.5 text-xs font-medium uppercase text-muted">OBS Browser Source</p>
          <p className="mb-1 text-[11px] text-muted">Overlay URL</p>
          <div className="flex items-center gap-1.5 rounded-lg border border-base-700 bg-base-800 px-2 py-1.5">
            <code className="flex-1 truncate text-[11px] text-muted">{obsUrl}</code>
            <button onClick={onCopyUrl} className="text-muted hover:text-fg" title="Copier">
              <Copy size={13} />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-muted">
            Taille recommandée : {t.canvasWidth} × {t.canvasHeight}
          </p>
          <p className="mt-1 text-[10px] text-faint">
            « Enregistrer » applique les changements en direct dans OBS, sans recharger la source.
          </p>
        </div>
      )}
    </>
  );
}
