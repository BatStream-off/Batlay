import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { parseColor } from "@/utils/overlay-style";

/**
 * Champs de formulaire de l'éditeur. Ce fichier n'est rendu que dans le
 * Dashboard (Electron), jamais dans la page OBS : les classes Tailwind y
 * sont donc sans risque.
 */

const inputClass =
  "w-full rounded-md border border-base-700 bg-base-800 px-2 py-1.5 text-sm text-fg outline-none focus:border-signal-500";

export function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-line py-3 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between text-xs font-medium uppercase tracking-wide text-muted hover:text-fg"
      >
        {title}
        <ChevronDown size={13} className={`transition ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && <div className="mt-3 space-y-3">{children}</div>}
    </section>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step = 1,
  min,
  max,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  // Texte local : permet de vider le champ ou de taper "-" sans que la valeur
  // numérique ne le réécrive à chaque frappe.
  const [text, setText] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(String(value));
  }, [value]);

  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <div className="relative">
        <input
          type="number"
          step={step}
          min={min}
          max={max}
          value={text}
          onFocus={() => (focused.current = true)}
          onBlur={() => {
            focused.current = false;
            setText(String(value));
          }}
          onChange={(e) => {
            setText(e.target.value);
            const n = parseFloat(e.target.value);
            if (Number.isFinite(n)) {
              const lo = min ?? -Infinity;
              const hi = max ?? Infinity;
              onChange(Math.min(hi, Math.max(lo, n)));
            }
          }}
          className={suffix ? `${inputClass} pr-7` : inputClass}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

export function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] text-muted">
        {label}
        <span className="tabular-nums text-fg">{format ? format(value) : value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-signal-500"
      />
    </label>
  );
}

/** rgb()/rgba()/#hex -> "#rrggbb" pour <input type="color"> (la transparence en est retirée). */
function toHex(color: string): string {
  const parsed = parseColor(color);
  if (!parsed) return "#000000";
  const [r, g, b] = parsed;
  return "#" + [r, g, b].map((n) => Math.round(n).toString(16).padStart(2, "0")).join("");
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
      <span className="shrink-0">{label}</span>
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className="w-[104px] rounded-md border border-base-700 bg-base-800 px-2 py-1 font-mono text-[11px] text-fg outline-none focus:border-signal-500"
        />
        <input
          type="color"
          value={toHex(value)}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-7 w-9 cursor-pointer rounded border border-base-700 bg-transparent p-0.5"
        />
      </div>
    </div>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { label: string; value: T }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) onChange(match.value);
        }}
        className={inputClass}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={2}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={`${inputClass} resize-none`}
        />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      )}
      {hint && <span className="mt-1 block text-[10px] text-faint">{hint}</span>}
    </label>
  );
}

export function ToggleField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-[11px] text-muted">
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-signal-500" />
    </label>
  );
}

export function SegmentedField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label?: string;
  value: T;
  onChange: (v: T) => void;
  options: { label: ReactNode; value: T; title?: string }[];
}) {
  return (
    <div>
      {label && <span className="mb-1 block text-[11px] text-muted">{label}</span>}
      <div className="grid auto-cols-fr grid-flow-col gap-1 rounded-lg border border-base-700 bg-base-800 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.title}
            onClick={() => onChange(o.value)}
            className={`flex items-center justify-center rounded-md px-2 py-1 text-[11px] transition ${
              value === o.value ? "bg-signal-600 text-white" : "text-muted hover:text-fg"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
