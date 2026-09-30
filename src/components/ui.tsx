import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, MoreHorizontal } from "lucide-react";
import { computeMenuPlacement } from "@/utils/ui-helpers";

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

// ---------------------------------------------------------------------------
// Liste déroulante à hauteur limitée
// ---------------------------------------------------------------------------

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectPlacement {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
  openUp: boolean;
}

/**
 * Remplace un <select> natif quand les libellés peuvent être longs et nombreux
 * (sources multimédia Windows) : la liste native prend la hauteur et la largeur
 * de son contenu et ne se contrôle pas en CSS. Ici la liste est plafonnée
 * (`SELECT_MENU_MAX_HEIGHT`), défile au-delà, et chaque libellé est tronqué
 * avec le texte complet en info-bulle.
 *
 * La liste est rendue dans <body> en position fixe : les cartes (`.card`) ont un
 * `backdrop-filter`, donc leur propre contexte d'empilement, et la carte
 * suivante recouvrirait une liste qui déborde.
 *
 * Clavier : focus sur le bouton, ↑/↓/Début/Fin pour naviguer, Entrée/Espace pour
 * choisir, Échap pour fermer (motif « combobox » avec aria-activedescendant).
 */
export function SelectMenu({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [placement, setPlacement] = useState<SelectPlacement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Même comportement qu'un <select> : une valeur inconnue retombe sur la première option.
  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));
  const listId = `${id}-list`;

  function openMenu() {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const { openUp, maxHeight } = computeMenuPlacement(rect.top, rect.bottom, window.innerHeight);
    setPlacement({
      left: rect.left,
      width: rect.width,
      maxHeight,
      openUp,
      ...(openUp ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
    setActive(selectedIndex);
    setOpen(true);
  }

  function closeMenu(refocus: boolean) {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    closeMenu(true);
  }

  // Fermeture au clic à l'extérieur, au redimensionnement et au défilement de
  // la page (la liste est en position fixe : elle resterait à l'ancienne place).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onScrollOrResize(e: Event) {
      // Le défilement de la liste elle-même ne doit pas la fermer.
      if (e.target instanceof Node && listRef.current?.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onScrollOrResize);
    window.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open]);

  // L'option active (clavier) reste visible dans la liste défilante.
  useEffect(() => {
    if (!open) return;
    (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function onKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case "Enter":
      case " ":
        // Sans preventDefault, le clic natif du bouton rouvrirait aussitôt la liste.
        e.preventDefault();
        choose(active);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        closeMenu(true);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-opt-${active}` : undefined}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => {
          if (e.key === " ") e.preventDefault();
        }}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border bg-base-800 px-3 py-2 text-left text-sm text-fg transition-colors hover:border-base-600 focus-visible:outline-none focus-visible:border-signal-500 focus-visible:ring-[3px] focus-visible:ring-signal-500/20 ${
          open ? "border-signal-500" : "border-base-700"
        }`}
      >
        <span className="min-w-0 flex-1 truncate">{options[selectedIndex]?.label ?? ""}</span>
        <ChevronDown size={14} className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open &&
        placement &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="menu-pop fixed z-50 overflow-y-auto rounded-xl border border-base-700 bg-base-900 p-1 shadow-pop"
            style={{
              left: placement.left,
              width: placement.width,
              top: placement.top,
              bottom: placement.bottom,
              maxHeight: placement.maxHeight,
              transformOrigin: placement.openUp ? "bottom center" : "top center",
            }}
          >
            {options.map((option, index) => (
              <li
                key={index}
                id={`${id}-opt-${index}`}
                role="option"
                aria-selected={index === selectedIndex}
                title={option.label}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-fg transition-colors ${
                  index === active ? "bg-base-800" : ""
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {index === selectedIndex && <Check size={14} className="shrink-0 text-accent" />}
              </li>
            ))}
          </ul>,
          document.body
        )}
    </>
  );
}
