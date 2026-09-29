import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
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
  primary: "btn-primary",
  secondary: "btn-secondary text-fg",
  ghost: "text-muted hover:bg-base-800 hover:text-fg",
  danger: "btn-danger",
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
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
        <h1 className="text-gradient font-display text-3xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Titre de section
// ---------------------------------------------------------------------------

/**
 * Titre d'un bloc de page. En casse normale et à taille lisible : les anciens
 * intitulés en petites capitales grises se confondaient avec le texte
 * secondaire et n'aidaient pas à se repérer dans une page longue.
 */
export function SectionTitle({
  children,
  hint,
  actions,
  className = "",
}: {
  children: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-fg">
          <span className="h-4 w-1 shrink-0 rounded-full bg-gradient-to-b from-signal-400 to-signal-600" aria-hidden="true" />
          {children}
        </h2>
        {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pastille d'état
// ---------------------------------------------------------------------------

const PILL_TONES = {
  ok: "bg-live/15 text-ok ring-1 ring-inset ring-live/25",
  warn: "bg-amber-500/15 text-warn-strong ring-1 ring-inset ring-amber-500/25",
  neutral: "bg-base-800 text-muted ring-1 ring-inset ring-base-700",
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
    <kbd className="rounded-md border border-base-700 border-b-2 bg-base-800 px-1.5 py-0.5 font-mono text-[10px] text-fg shadow-sm">{children}</kbd>
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
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Clavier : le focus entre dans la fenêtre à l'ouverture (sauf si un champ
  // a déjà pris le focus via autoFocus) et revient sur le bouton d'origine à la
  // fermeture, au lieu de repartir du haut de la page.
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    return () => previous?.focus();
  }, []);

  // Tab boucle dans la fenêtre : sans ça, le focus s'échappait vers la page masquée derrière.
  function trapTab(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab" || !dialogRef.current) return;
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    ).filter((el) => !el.hasAttribute("disabled"));
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="modal-backdrop fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={`modal-panel max-h-full max-w-full overflow-y-auto rounded-xl2 border border-base-700 bg-base-900 p-6 shadow-pop outline-none ${widthClass}`}
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
            className="menu-pop absolute bottom-full right-0 z-30 mb-1 min-w-[200px] rounded-xl border border-base-700 bg-base-900 p-1 shadow-pop"
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
