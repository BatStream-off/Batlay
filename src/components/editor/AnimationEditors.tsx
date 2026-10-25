import { Play } from "lucide-react";
import type { AnimationConfig, ComponentAnimation, OverlayComponentConfig } from "@/types/overlay";
import {
  EASINGS,
  LIMITS,
  MOTION_PRESETS,
  applyMotionPreset,
  easingLabel,
  matchMotionPreset,
  normalizeComponentAnimation,
  normalizeEasing,
  normalizeOverlayAnimation,
  type EnterEffectId,
  type ExitEffectId,
  type LoopEffectId,
} from "@/animation/config";
import { enterEffectOptions, exitEffectOptions, getEnterEffect, loopEffectOptions } from "@/animation/effects";
import { Section, SegmentedField, SelectField, SliderField, ToggleField } from "./fields";

/**
 * Réglages « Animations et transitions » de l'éditeur : l'overlay entier (aucun
 * composant sélectionné) et un composant (onglet « Animation »). Uniquement des
 * listes, curseurs et interrupteurs : jamais de CSS à écrire. Les réglages
 * avancés (délai, décalage, amplitude, accélération) sont repliés par défaut.
 */

const ms = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 2)} s` : `${v} ms`);
const pct = (v: number) => `${Math.round(v * 100)} %`;

const easingOptions = (current: string) => {
  const list: { label: string; value: string }[] = EASINGS.map((e) => ({ label: e.label, value: normalizeEasing(e.css) }));
  const n = normalizeEasing(current);
  return list.some((o) => o.value === n) ? list : [...list, { label: easingLabel(n), value: n }];
};

function PreviewButton({ onPreview, disabled }: { onPreview: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onPreview}
      disabled={disabled}
      title="Change le morceau d'exemple de l'aperçu pour voir la transition"
      className="flex w-full items-center justify-center gap-1.5 rounded-md border border-base-700 px-2 py-1.5 text-[11px] text-fg transition hover:border-signal-500 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Play size={12} className="text-accent" /> Tester la transition
    </button>
  );
}

// ---------------------------------------------------------------------------
// Overlay entier
// ---------------------------------------------------------------------------

export function OverlayAnimationSection({
  value,
  onChange,
  onPreview,
}: {
  value: AnimationConfig;
  onChange: (next: AnimationConfig, key: string) => void;
  onPreview: () => void;
}) {
  const a = normalizeOverlayAnimation(value);
  const preset = matchMotionPreset(a);
  const set = (patch: Partial<AnimationConfig>, key: string) => onChange(normalizeOverlayAnimation({ ...a, ...patch }), `anim:${key}`);
  return (
    <Section title="Animations et transitions">
      <div>
        <span className="mb-1 block text-[11px] text-muted">Style</span>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="Combinaisons prêtes à l'emploi">
          {MOTION_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              title={p.description}
              aria-pressed={preset === p.id}
              onClick={() => onChange(applyMotionPreset(a, p.id), "anim:preset")}
              className={`rounded-md border px-1.5 py-1 text-[11px] transition ${
                preset === p.id ? "border-signal-500 bg-signal-600/20 text-fg" : "border-base-700 text-muted hover:text-fg"
              } ${p.id === "none" ? "col-span-2" : ""}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-faint">{preset ? MOTION_PRESETS.find((p) => p.id === preset)?.description : "Réglages personnalisés."}</p>
      </div>

      <ToggleField label="Animer les changements de morceau" checked={a.enabled} onChange={(enabled) => set({ enabled }, "enabled")} />
      {a.enabled && (
        <>
          <SelectField<string> label="Entrée" value={a.enter} options={enterEffectOptions()} onChange={(enter) => set({ enter: enter as EnterEffectId }, "enter")} />
          <SelectField<string> label="Sortie" value={a.exit} options={exitEffectOptions()} onChange={(exit) => set({ exit: exit as ExitEffectId }, "exit")} />
          <SliderField label="Durée" value={a.durationMs} min={LIMITS.durationMs.min} max={1500} step={10} format={ms} onChange={(durationMs) => set({ durationMs }, "duration")} />
          <details className="group rounded-md border border-base-700 px-2 py-1.5">
            <summary className="cursor-pointer text-[11px] text-muted hover:text-fg">Réglages avancés</summary>
            <div className="mt-2 space-y-3">
              <SliderField label="Délai avant l'entrée" value={a.delayMs} min={0} max={2000} step={10} format={ms} onChange={(delayMs) => set({ delayMs }, "delay")} />
              <SliderField
                label="Décalage entre éléments"
                value={a.staggerMs}
                min={0}
                max={LIMITS.staggerMs.max}
                step={10}
                format={ms}
                onChange={(staggerMs) => set({ staggerMs }, "stagger")}
              />
              <SliderField label="Amplitude" value={a.intensity} min={0} max={1} step={0.05} format={pct} onChange={(intensity) => set({ intensity }, "intensity")} />
              <SelectField<string> label="Accélération" value={normalizeEasing(a.easing)} options={easingOptions(a.easing)} onChange={(easing) => set({ easing }, "easing")} />
              <ToggleField
                label="Respecter « réduire les animations » de Windows"
                checked={a.respectReducedMotion}
                onChange={(respectReducedMotion) => set({ respectReducedMotion }, "reduced")}
              />
            </div>
          </details>
        </>
      )}
      <PreviewButton onPreview={onPreview} disabled={!a.enabled} />
      <p className="text-[10px] text-faint">
        Appliqué en direct dans OBS à l'enregistrement, sans recharger la source. Chaque composant peut avoir ses propres réglages (onglet
        « Animation »).
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Un composant
// ---------------------------------------------------------------------------

/** Effets décoratifs pertinents selon le type (la rotation n'a de sens que pour une pochette). */
function loopOptionsFor(type: OverlayComponentConfig["type"]) {
  return loopEffectOptions().filter((o) => o.value !== "rotate" || type === "artwork");
}

const TEXT_TYPES = new Set(["title", "artist", "album", "source", "text"]);

export function ComponentAnimationPanel({
  component,
  overlayAnimations,
  onChange,
  onPreview,
}: {
  component: OverlayComponentConfig;
  overlayAnimations: AnimationConfig;
  onChange: (next: ComponentAnimation | undefined, key: string) => void;
  onPreview: () => void;
}) {
  const overlay = normalizeOverlayAnimation(overlayAnimations);
  const c = normalizeComponentAnimation(component.animation, overlay);
  const raw = component.animation ?? {};
  const set = (patch: Partial<ComponentAnimation>, key: string) => onChange({ ...raw, ...patch }, `canim:${component.id}:${key}`);
  const setLoop = (patch: Partial<ComponentAnimation["loop"] & object>, key: string) => set({ loop: { ...c.loop, ...patch } }, `loop:${key}`);
  const isText = TEXT_TYPES.has(component.type);
  const enterOptions = enterEffectOptions().filter((o) => isText || !getEnterEffect(o.value)?.textOriented);

  return (
    <>
      <Section title="Transition">
        <SegmentedField
          value={c.mode}
          onChange={(mode) => set({ mode }, "mode")}
          options={[
            { label: "Comme l'overlay", value: "inherit", title: "Reprend les réglages de l'overlay (aucun composant sélectionné)" },
            { label: "Personnalisée", value: "custom" },
            { label: "Aucune", value: "none", title: "Ce composant change instantanément" },
          ]}
        />
        {!overlay.enabled && c.mode !== "none" && (
          <p className="text-[10px] text-warn">Les animations de l'overlay sont désactivées : ce composant n'est pas animé.</p>
        )}
        {c.mode === "inherit" && (
          <SliderField
            label="Délai supplémentaire"
            value={c.delayMs}
            min={0}
            max={2000}
            step={10}
            format={ms}
            onChange={(delayMs) => set({ delayMs }, "delay")}
          />
        )}
        {c.mode === "custom" && (
          <>
            <SelectField<string> label="Entrée" value={c.enter} options={enterOptions} onChange={(enter) => set({ enter: enter as EnterEffectId }, "enter")} />
            <SelectField<string> label="Sortie" value={c.exit} options={exitEffectOptions()} onChange={(exit) => set({ exit: exit as ExitEffectId }, "exit")} />
            <SliderField label="Durée" value={c.durationMs} min={LIMITS.durationMs.min} max={1500} step={10} format={ms} onChange={(durationMs) => set({ durationMs }, "duration")} />
            <details className="rounded-md border border-base-700 px-2 py-1.5">
              <summary className="cursor-pointer text-[11px] text-muted hover:text-fg">Réglages avancés</summary>
              <div className="mt-2 space-y-3">
                <SliderField label="Délai" value={c.delayMs} min={0} max={2000} step={10} format={ms} onChange={(delayMs) => set({ delayMs }, "delay")} />
                <SliderField label="Amplitude" value={c.intensity} min={0} max={1} step={0.05} format={pct} onChange={(intensity) => set({ intensity }, "intensity")} />
                <SelectField<string> label="Accélération" value={normalizeEasing(c.easing)} options={easingOptions(c.easing)} onChange={(easing) => set({ easing }, "easing")} />
              </div>
            </details>
          </>
        )}
        <PreviewButton onPreview={onPreview} />
      </Section>

      <Section title="Effet décoratif" defaultOpen={c.loop.effect !== "none"}>
        <SelectField<string>
          label="Effet"
          value={c.loop.effect}
          options={loopOptionsFor(component.type)}
          onChange={(effect) => setLoop({ effect: effect as LoopEffectId }, "effect")}
        />
        {c.loop.effect !== "none" && (
          <>
            <SegmentedField
              value={c.loop.trigger}
              onChange={(trigger) => setLoop({ trigger }, "trigger")}
              options={[
                { label: "À chaque morceau", value: "change", title: "Quelques cycles après chaque changement, puis arrêt" },
                { label: "En continu", value: "always", title: "Tant que la musique joue (en pause sinon)" },
              ]}
            />
            {c.loop.trigger === "change" && (
              <SliderField label="Répétitions" value={c.loop.repeat} min={LIMITS.loopRepeat.min} max={LIMITS.loopRepeat.max} onChange={(repeat) => setLoop({ repeat }, "repeat")} />
            )}
            <SliderField
              label="Durée d'un cycle"
              value={c.loop.periodMs}
              min={LIMITS.loopPeriodMs.min}
              max={c.loop.effect === "rotate" ? LIMITS.loopPeriodMs.max : 6000}
              step={100}
              format={ms}
              onChange={(periodMs) => setLoop({ periodMs }, "period")}
            />
            <SliderField label="Intensité" value={c.loop.intensity} min={0} max={1} step={0.05} format={pct} onChange={(intensity) => setLoop({ intensity }, "intensity")} />
            {c.loop.trigger === "always" && (
              <p className="text-[10px] text-faint">En continu, l'effet est mis en pause quand la musique s'arrête.</p>
            )}
          </>
        )}
        <p className="text-[10px] text-faint">Les titres trop longs défilent déjà automatiquement (onglet « Texte », débordement « Défilement »).</p>
      </Section>
    </>
  );
}
