import { useEffect, useState, type ReactNode } from "react";
import { Keyboard } from "lucide-react";
import { Kbd } from "@/components/ui";

/**
 * Liste des raccourcis de l'éditeur. Elle vit à part de la gestion des touches
 * (Editor.tsx) mais la reflète : quand un raccourci est ajouté là-bas, il doit
 * l'être ici, sinon personne ne le découvre.
 */
const SHORTCUTS: { keys: ReactNode; action: string }[] = [
  { keys: <><Kbd>Ctrl</Kbd> + <Kbd>S</Kbd></>, action: "Enregistrer" },
  { keys: <><Kbd>Ctrl</Kbd> + <Kbd>Z</Kbd> / <Kbd>Y</Kbd></>, action: "Annuler / rétablir" },
  { keys: <><Kbd>Ctrl</Kbd> + <Kbd>D</Kbd></>, action: "Dupliquer le calque" },
  { keys: <Kbd>Suppr</Kbd>, action: "Supprimer le calque" },
  { keys: <><Kbd>←</Kbd><Kbd>↑</Kbd><Kbd>→</Kbd><Kbd>↓</Kbd></>, action: "Déplacer de 1 px (Maj : 10 px)" },
  { keys: <><Kbd>Ctrl</Kbd> + <Kbd>↑</Kbd> / <Kbd>↓</Kbd></>, action: "Monter / descendre d'un cran (aussi Ctrl + ] / [)" },
  { keys: <Kbd>Échap</Kbd>, action: "Désélectionner" },
  { keys: <><Kbd>Maj</Kbd> en glissant</>, action: "Axe droit / garder les proportions" },
  { keys: <><Kbd>Alt</Kbd> en glissant</>, action: "Sans magnétisme / depuis le centre" },
  { keys: <><Kbd>Ctrl</Kbd> + <Kbd>0</Kbd></>, action: "Ajuster le zoom à la fenêtre" },
  { keys: <><Kbd>Ctrl</Kbd> + <Kbd>+</Kbd> / <Kbd>-</Kbd></>, action: "Zoomer / dézoomer" },
  { keys: <><Kbd>Ctrl</Kbd> + molette</>, action: "Zoom à la molette" },
];

export function ShortcutsHelp() {
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
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title="Raccourcis clavier"
        aria-label="Raccourcis clavier"
        className={`rounded-lg border p-2 transition ${
          open ? "border-signal-500 bg-signal-600/20 text-fg" : "border-base-700 text-muted hover:text-fg"
        }`}
      >
        <Keyboard size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-base-700 bg-base-900 p-4 shadow-glow">
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted">Raccourcis clavier</p>
            <ul className="space-y-2">
              {SHORTCUTS.map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-muted">{s.action}</span>
                  <span className="flex shrink-0 items-center gap-1 text-muted">{s.keys}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
