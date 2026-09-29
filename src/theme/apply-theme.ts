import {
  DEFAULT_THEME_PREFERENCE,
  normalizeThemePreference,
  resolveTheme,
  themeCssVariables,
  type ResolvedTheme,
  type ThemePreference,
} from "../../electron/shared/theme";

/**
 * Application du thème dans le renderer (Dashboard uniquement).
 *
 * Les valeurs viennent de electron/shared/theme.ts ; ce fichier ne fait que
 * les poser sur <html>. La page overlay d'OBS n'importe rien d'ici : elle ne
 * doit jamais être thématisée (fond transparent, voir overlay.html).
 */

/** Sous-ensemble de HTMLElement utilisé ici (permet de tester sans DOM). */
export interface ThemeRoot {
  classList: { add(token: string): void; remove(token: string): void };
  style: { setProperty(name: string, value: string): void };
  dataset: Record<string, string | undefined>;
}

/**
 * Pose les variables CSS d'un thème résolu sur la racine :
 *  - variables RGB des tokens (lues par les couleurs Tailwind) ;
 *  - `color-scheme`, pour que les contrôles natifs (<select>, cases, barres
 *    de défilement) suivent le thème ;
 *  - `data-theme` et la classe `dark` (variante Tailwind `darkMode: "class"`).
 */
export function applyResolvedTheme(root: ThemeRoot, resolved: ResolvedTheme): void {
  for (const [name, value] of Object.entries(themeCssVariables(resolved))) {
    root.style.setProperty(name, value);
  }
  root.style.setProperty("color-scheme", resolved);
  root.dataset.theme = resolved;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

/** Résout puis applique une préférence ; renvoie le thème effectivement posé. */
export function applyThemePreference(
  root: ThemeRoot,
  preference: ThemePreference,
  systemPrefersDark: boolean
): ResolvedTheme {
  const resolved = resolveTheme(normalizeThemePreference(preference), systemPrefersDark);
  applyResolvedTheme(root, resolved);
  return resolved;
}

/** Mode clair/sombre de Windows tel que le voit Chromium (aligné sur nativeTheme). */
export function systemPrefersDark(): boolean {
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true;
  } catch {
    return true;
  }
}

/**
 * Démarrage : à appeler AVANT ReactDOM.createRoot. Le process principal
 * répond de façon synchrone (theme:get-initial) avec le thème déjà résolu, si
 * bien que la première image est déjà dans le bon thème — pas de flash. Il
 * pilote aussi la couleur de fond de la fenêtre native (WINDOW_BACKGROUND).
 *
 * S'abonne ensuite aux changements poussés par le process principal (bascule
 * de Windows quand le réglage est « system »).
 */
export function initTheme(root: ThemeRoot = document.documentElement, bridge = globalThis.window?.batlay?.theme): ResolvedTheme {
  let resolved: ResolvedTheme = resolveTheme(DEFAULT_THEME_PREFERENCE, true);
  try {
    const initial = bridge?.getInitial();
    if (initial && (initial.resolved === "dark" || initial.resolved === "light")) resolved = initial.resolved;
  } catch {
    // Pas de pont (navigateur hors Electron) : thème sombre historique.
  }
  applyResolvedTheme(root, resolved);
  bridge?.onChange(({ resolved: next }) => applyResolvedTheme(root, next));
  return resolved;
}
