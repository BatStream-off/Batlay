import type { BorderConfig, FillConfig, ShadowConfig } from "@/types/overlay";
import { defaultBorder, defaultFill, defaultShadow, fillToCss } from "@/utils/overlay-style";
import { ColorField, NumberField, SegmentedField, SelectField, SliderField, ToggleField } from "./fields";

// Damier de la PASTILLE de couleur (élément d'interface qui montre la
// transparence) : il suit le thème via des variables CSS. Les fonds d'aperçu de
// l'overlay (EditorCanvas) restent, eux, fixes.
const CHECKER =
  "conic-gradient(rgb(var(--checker-a)) 25%, rgb(var(--checker-b)) 0 50%, rgb(var(--checker-a)) 0 75%, rgb(var(--checker-b)) 0) 0 0 / 12px 12px";

const pct = (v: number) => `${Math.round(v * 100)} %`;

/**
 * Fond : aucun / uni / dégradé, avec transparence. `value` absent = « aucun ».
 * La pastille d'aperçu est posée sur un damier pour VOIR la transparence.
 */
export function FillEditor({
  value,
  onChange,
}: {
  value: FillConfig | undefined;
  onChange: (next: FillConfig) => void;
}) {
  const fill = value ?? defaultFill({ mode: "none" });
  const set = (patch: Partial<FillConfig>) => onChange({ ...fill, ...patch });
  const css = fillToCss(fill);

  return (
    <div className="space-y-3">
      <SegmentedField
        value={fill.mode}
        onChange={(mode) => set({ mode })}
        options={[
          { label: "Aucun", value: "none" },
          { label: "Uni", value: "solid" },
          { label: "Dégradé", value: "gradient" },
        ]}
      />

      {fill.mode !== "none" && (
        <>
          <div className="h-8 rounded-md border border-base-700" style={{ background: CHECKER }}>
            <div className="h-full w-full rounded-md" style={{ background: css }} />
          </div>

          {fill.mode === "solid" && <ColorField label="Couleur" value={fill.color} onChange={(color) => set({ color })} />}

          {fill.mode === "gradient" && (
            <>
              <SegmentedField
                value={fill.gradient.type}
                onChange={(type) => set({ gradient: { ...fill.gradient, type } })}
                options={[
                  { label: "Linéaire", value: "linear" },
                  { label: "Radial", value: "radial" },
                ]}
              />
              <ColorField label="Début" value={fill.gradient.from} onChange={(from) => set({ gradient: { ...fill.gradient, from } })} />
              <ColorField label="Fin" value={fill.gradient.to} onChange={(to) => set({ gradient: { ...fill.gradient, to } })} />
              {fill.gradient.type === "linear" && (
                <SliderField
                  label="Angle"
                  value={fill.gradient.angle}
                  min={0}
                  max={360}
                  step={5}
                  format={(v) => `${v}°`}
                  onChange={(angle) => set({ gradient: { ...fill.gradient, angle } })}
                />
              )}
            </>
          )}

          <SliderField
            label="Opacité (transparence)"
            value={fill.opacity}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(opacity) => set({ opacity })}
          />
        </>
      )}
    </div>
  );
}

/** Bordure : épaisseur 0 = aucune. */
export function BorderEditor({
  value,
  onChange,
}: {
  value: BorderConfig | undefined;
  onChange: (next: BorderConfig) => void;
}) {
  const border = value ?? defaultBorder({ width: 0 });
  const set = (patch: Partial<BorderConfig>) => onChange({ ...border, ...patch });
  return (
    <div className="space-y-3">
      <NumberField label="Épaisseur" value={border.width} min={0} max={64} suffix="px" onChange={(width) => set({ width })} />
      {border.width > 0 && (
        <>
          <ColorField label="Couleur" value={border.color} onChange={(color) => set({ color })} />
          <SelectField
            label="Style"
            value={border.style}
            onChange={(style) => set({ style })}
            options={[
              { label: "Continu", value: "solid" },
              { label: "Tirets", value: "dashed" },
              { label: "Pointillés", value: "dotted" },
            ]}
          />
        </>
      )}
    </div>
  );
}

/** Ombre portée (bloc) ou lueur (texte, sans « étalement »). */
export function ShadowEditor({
  value,
  onChange,
  isText = false,
}: {
  value: ShadowConfig | undefined;
  onChange: (next: ShadowConfig) => void;
  isText?: boolean;
}) {
  const shadow = value ?? defaultShadow({ enabled: false });
  const set = (patch: Partial<ShadowConfig>) => onChange({ ...shadow, ...patch });
  return (
    <div className="space-y-3">
      <ToggleField label="Activée" checked={shadow.enabled} onChange={(enabled) => set({ enabled })} />
      {shadow.enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Décalage X" value={shadow.x} suffix="px" onChange={(x) => set({ x })} />
            <NumberField label="Décalage Y" value={shadow.y} suffix="px" onChange={(y) => set({ y })} />
            <NumberField label="Flou" value={shadow.blur} min={0} suffix="px" onChange={(blur) => set({ blur })} />
            {!isText && <NumberField label="Étalement" value={shadow.spread} suffix="px" onChange={(spread) => set({ spread })} />}
          </div>
          <ColorField label="Couleur" value={shadow.color} onChange={(color) => set({ color })} />
          <SliderField label="Opacité" value={shadow.opacity} min={0} max={1} step={0.01} format={pct} onChange={(opacity) => set({ opacity })} />
        </>
      )}
    </div>
  );
}
