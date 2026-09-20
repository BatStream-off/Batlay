import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde-fous sur l'ORDRE des opérations dans electron/main/index.ts, qu'on ne
 * peut pas importer en test (il dépend d'Electron). Ils vérifient le texte
 * source : brutal, mais c'est exactement le genre de régression (un `await`
 * déplacé, un `once` posé trop tard) qu'un test de logique ne verrait pas.
 */
const source = readFileSync(join(process.cwd(), "electron", "main", "index.ts"), "utf8");
const at = (needle: string | RegExp): number => {
  const index = typeof needle === "string" ? source.indexOf(needle) : source.search(needle);
  expect(index, `introuvable : ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe("electron/main/index.ts — démarrage", () => {
  it("prend le verrou d'instance unique AVANT app.whenReady()", () => {
    expect(at("requestSingleInstanceLock()")).toBeLessThan(at("app.whenReady()"));
  });

  it("quitte proprement quand le verrou est refusé, et ne démarre alors ni serveur ni fenêtre", () => {
    const lockIndex = at("requestSingleInstanceLock()");
    const quitIndex = source.indexOf("app.quit()", lockIndex);
    const whenReadyIndex = at("app.whenReady()");
    expect(quitIndex).toBeGreaterThan(lockIndex);
    expect(quitIndex).toBeLessThan(whenReadyIndex);
    // whenReady() est dans la branche « verrou obtenu » (else), pas exécuté par l'instance refusée.
    expect(source.slice(lockIndex, whenReadyIndex)).toMatch(/else\s*\{/);
  });

  it("gère second-instance en ramenant la fenêtre existante au premier plan", () => {
    expect(source).toContain('app.on("second-instance"');
    expect(source).toContain("focusExistingWindow(mainWindow)");
  });

  it("branche l'affichage de la fenêtre AVANT loadURL / loadFile (sinon ready-to-show peut être raté)", () => {
    const reveal = at("attachWindowReveal(mainWindow");
    expect(reveal).toBeLessThan(at("mainWindow.loadURL("));
    expect(reveal).toBeLessThan(at("mainWindow.loadFile("));
  });

  it("ne réintroduit plus l'ancien ready-to-show conditionnel posé après le chargement", () => {
    expect(source).not.toMatch(/once\(\s*["']ready-to-show["']/);
    expect(source).not.toContain("if (!startMinimized) mainWindow?.show()");
  });

  it("conserve backgroundThrottling: false (polling musical + WebSocket actifs fenêtre réduite)", () => {
    expect(source).toMatch(/backgroundThrottling:\s*false/);
  });

  it("n'ajoute pas de Tray (aucune icône n'existe dans le projet)", () => {
    expect(source).not.toMatch(/new\s+Tray\s*\(/);
  });

  it("applique « Launch on startup » au démarrage ET quand le réglage change", () => {
    const matches = source.match(/applyLaunchOnStartup\(app,/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    // Jamais d'appel direct : l'exigence « packagé uniquement » vit dans le helper.
    expect(source).not.toContain("app.setLoginItemSettings(");
  });

  it("thème : nativeTheme aligné avant la fenêtre, fond natif issu des tokens, suivi de Windows", () => {
    expect(at("applyThemeFromSettings();")).toBeLessThan(at("await createWindow();"));
    expect(source).toContain("WINDOW_BACKGROUND[");
    expect(source).not.toMatch(/backgroundColor:\s*["']#/); // plus de couleur codée en dur
    expect(source).toContain('nativeTheme.on("updated"');
    expect(source).toContain('"theme:get-initial"');
  });

  it("valide le thème avant de le persister", () => {
    expect(source).toMatch(/next\.theme\s*=\s*normalizeThemePreference\(/);
  });
});
