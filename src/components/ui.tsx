import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * Briques d'interface partagées par toutes les pages. Elles n'existent que
 * dans le Dashboard (Electron) : jamais importées par la page OBS, donc les
 * classes Tailwind y sont sans risque.
 */

// ---------------------------------------------------------------------------
// Bouton
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-signal-600 text-white hover:bg-signal-500",
  secondary: "border border-base-700 bg-base-800 text-fg hover:bg-base-700",
  ghost: "text-muted hover:bg-base-800 hover:text-fg",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// En-tête de page
// ---------------------------------------------------------------------------

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold text-fg">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pastille d'état
// ---------------------------------------------------------------------------

const PILL_TONES = {
  ok: "bg-live/15 text-ok",
  warn: "bg-amber-500/15 text-warn-strong",
  neutral: "bg-base-800 text-muted",
} as const;

export function StatusPill({ tone = "neutral", children }: { tone?: keyof typeof PILL_TONES; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${PILL_TONES[tone]}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Touche de clavier
// ---------------------------------------------------------------------------

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-base-700 bg-base-800 px-1.5 py-0.5 font-mono text-[10px] text-fg">{children}</kbd>
  );
}

// ---------------------------------------------------------------------------
// Fenêtre modale (Échap et clic à l'extérieur la ferment)
// ---------------------------------------------------------------------------

export function Modal({
  title,
  onClose,
  children,
  widthClass = "w-[420px]",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  widthClass?: string;
}) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-full max-w-full overflow-y-auto rounded-xl2 border border-line bg-base-900 p-6 ${widthClass}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Menu « … »
// ---------------------------------------------------------------------------

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export function DropdownMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <div className="relative">
      <Button
        size="sm"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={14} />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          {/* S'ouvre vers le haut : la rangée d'actions est en bas de carte, le menu ne sort donc jamais de l'écran. */}
          <div
            role="menu"
            className="absolute bottom-full right-0 z-30 mb-1 min-w-[200px] rounded-xl border border-base-700 bg-base-900 p-1 shadow-glow"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm hover:bg-base-800 ${
                  item.danger ? "text-danger" : "text-fg"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
