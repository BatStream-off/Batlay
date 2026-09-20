import { describe, it, expect, vi } from "vitest";
import {
  REVEAL_SAFETY_DELAY_MS,
  applyLaunchOnStartup,
  attachWindowReveal,
  focusExistingWindow,
  getInitialWindowState,
} from "../electron/services/window-lifecycle";

/** Double minimal de BrowserWindow : journalise les appels dans l'ordre. */
function createFakeWindow(init: { destroyed?: boolean; minimized?: boolean } = {}) {
  const calls: string[] = [];
  const onceHandlers = new Map<string, (...args: unknown[]) => void>();
  const webContentsHandlers = new Map<string, (...args: unknown[]) => void>();
  const state = { destroyed: init.destroyed ?? false, minimized: init.minimized ?? false };
  const win = {
    calls,
    state,
    show: vi.fn(() => void calls.push("show")),
    minimize: vi.fn(() => void calls.push("minimize")),
    restore: vi.fn(() => void calls.push("restore")),
    focus: vi.fn(() => void calls.push("focus")),
    isMinimized: () => state.minimized,
    isDestroyed: () => state.destroyed,
    once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      onceHandlers.set(event, listener);
    }),
    webContents: {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        webContentsHandlers.set(event, listener);
      }),
    },
    emit: (event: string, ...args: unknown[]) => onceHandlers.get(event)?.(...args),
    emitWebContents: (event: string, ...args: unknown[]) => webContentsHandlers.get(event)?.(...args),
  };
  return win;
}

function createFakeTimers() {
  const scheduled: { callback: () => void; ms: number }[] = [];
  return {
    scheduled,
    setTimer: vi.fn((callback: () => void, ms: number) => {
      scheduled.push({ callback, ms });
      return `timer-${scheduled.length}`;
    }),
    clearTimer: vi.fn(),
  };
}

describe("getInitialWindowState — « Start minimized » ne rend jamais la fenêtre invisible", () => {
  it("affiche la fenêtre dans les deux modes", () => {
    expect(getInitialWindowState({ startMinimized: false }).show).toBe(true);
    expect(getInitialWindowState({ startMinimized: true }).show).toBe(true);
  });

  it("ne réduit que si startMinimized vaut exactement true", () => {
    expect(getInitialWindowState({ startMinimized: true }).minimize).toBe(true);
    expect(getInitialWindowState({ startMinimized: false }).minimize).toBe(false);
  });

  it("valeur absente ou corrompue : fenêtre normale, jamais réduite par accident", () => {
    expect(getInitialWindowState({}).minimize).toBe(false);
    expect(getInitialWindowState({ startMinimized: "true" }).minimize).toBe(false);
    expect(getInitialWindowState({ startMinimized: 1 }).minimize).toBe(false);
    expect(getInitialWindowState({ startMinimized: null }).minimize).toBe(false);
  });
});

describe("attachWindowReveal — affichage de la fenêtre", () => {
  it("enregistre ready-to-show et le filet de sécurité dès l'appel (donc avant tout loadFile)", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });

    expect(win.once).toHaveBeenCalled();
    expect(win.webContents.on).toHaveBeenCalled();
    expect(timers.scheduled).toHaveLength(1);
    // Rien n'est encore affiché : on attend l'événement.
    expect(win.calls).toEqual([]);
  });

  it("filet de sécurité : ~5 s par défaut", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });
    expect(timers.scheduled[0].ms).toBe(REVEAL_SAFETY_DELAY_MS);
    expect(REVEAL_SAFETY_DELAY_MS).toBeGreaterThanOrEqual(4000);
    expect(REVEAL_SAFETY_DELAY_MS).toBeLessThanOrEqual(6000);
  });

  it("mode normal : show() sans minimize()", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });
    win.emit("ready-to-show");
    expect(win.calls).toEqual(["show"]);
    expect(win.minimize).not.toHaveBeenCalled();
  });

  it("mode réduit : show() PUIS minimize() — la fenêtre existe dans la barre des tâches", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: true }), ...timers });
    win.emit("ready-to-show");
    expect(win.calls).toEqual(["show", "minimize"]);
  });

  it("annule le filet de sécurité une fois la fenêtre affichée", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });
    win.emit("ready-to-show");
    expect(timers.clearTimer).toHaveBeenCalledWith("timer-1");
  });

  it("filet de sécurité : affiche la fenêtre si ready-to-show n'arrive jamais", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: true }), ...timers });
    timers.scheduled[0].callback();
    expect(win.calls).toEqual(["show", "minimize"]);
  });

  it("did-fail-load sur la page principale : affiche quand même la fenêtre", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });
    win.emitWebContents("did-fail-load", {}, -6, "ERR_FILE_NOT_FOUND", "file:///index.html", true);
    expect(win.calls).toEqual(["show"]);
  });

  it("did-fail-load d'un sous-frame : n'affiche rien", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });
    win.emitWebContents("did-fail-load", {}, -3, "ERR_ABORTED", "https://x", false);
    expect(win.calls).toEqual([]);
  });

  it("idempotent : ready-to-show + did-fail-load + délai = un seul affichage", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: true }), ...timers });
    win.emit("ready-to-show");
    win.emitWebContents("did-fail-load", {}, -6, "x", "y", true);
    timers.scheduled[0].callback();
    expect(win.calls).toEqual(["show", "minimize"]);
  });

  it("fenêtre détruite entre-temps : aucun appel, aucune exception", () => {
    const win = createFakeWindow({ destroyed: true });
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: true }), ...timers });
    expect(() => win.emit("ready-to-show")).not.toThrow();
    expect(win.calls).toEqual([]);
  });

  it("fermeture de la fenêtre : le filet de sécurité est annulé", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });
    win.emit("closed");
    expect(timers.clearTimer).toHaveBeenCalledWith("timer-1");
  });

  it("renvoie une fonction d'affichage manuel, elle aussi idempotente", () => {
    const win = createFakeWindow();
    const timers = createFakeTimers();
    const reveal = attachWindowReveal(win, { state: getInitialWindowState({ startMinimized: false }), ...timers });
    reveal();
    reveal();
    expect(win.calls).toEqual(["show"]);
  });
});

describe("focusExistingWindow — second lancement (second-instance)", () => {
  it("fenêtre réduite : restore(), show(), focus() dans cet ordre", () => {
    const win = createFakeWindow({ minimized: true });
    expect(focusExistingWindow(win)).toBe(true);
    expect(win.calls).toEqual(["restore", "show", "focus"]);
  });

  it("fenêtre déjà normale (ou maximisée) : pas de restore(), qui la dé-maximiserait sous Windows", () => {
    const win = createFakeWindow({ minimized: false });
    expect(focusExistingWindow(win)).toBe(true);
    expect(win.calls).toEqual(["show", "focus"]);
    expect(win.restore).not.toHaveBeenCalled();
  });

  it("pas de fenêtre (ou détruite) : rien à ramener, aucune exception", () => {
    expect(focusExistingWindow(null)).toBe(false);
    expect(focusExistingWindow(undefined)).toBe(false);
    const dead = createFakeWindow({ destroyed: true });
    expect(focusExistingWindow(dead)).toBe(false);
    expect(dead.calls).toEqual([]);
  });
});

describe("scénario : un ancien startMinimized:true redevient accessible", () => {
  it("au lancement suivant la fenêtre est affichée (réduite dans la barre des tâches), puis restaurée par un second lancement", () => {
    // Ancien fichier de config : startMinimized à true (fenêtre jamais affichée avant le correctif).
    const legacySettings = { startMinimized: true };
    const win = createFakeWindow();
    const timers = createFakeTimers();

    attachWindowReveal(win, { state: getInitialWindowState(legacySettings), ...timers });
    win.emit("ready-to-show");
    expect(win.calls).toEqual(["show", "minimize"]);

    // L'utilisateur relance Batlay : le processus existant se ramène au premier plan.
    win.state.minimized = true;
    focusExistingWindow(win);
    expect(win.calls.slice(2)).toEqual(["restore", "show", "focus"]);
  });
});

describe("applyLaunchOnStartup — « Launch on startup » appliqué au système", () => {
  function createFakeApp(init: { isPackaged: boolean; openAtLogin: boolean }) {
    return {
      isPackaged: init.isPackaged,
      getLoginItemSettings: vi.fn(() => ({ openAtLogin: init.openAtLogin })),
      setLoginItemSettings: vi.fn(),
    };
  }

  it("version packagée : active l'ouverture à la session", () => {
    const app = createFakeApp({ isPackaged: true, openAtLogin: false });
    expect(applyLaunchOnStartup(app, true)).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: true });
  });

  it("version packagée : la désactivation est appliquée aussi", () => {
    const app = createFakeApp({ isPackaged: true, openAtLogin: true });
    expect(applyLaunchOnStartup(app, false)).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });

  it("développement (non packagé) : n'inscrit jamais Electron au démarrage de Windows", () => {
    const app = createFakeApp({ isPackaged: false, openAtLogin: false });
    expect(applyLaunchOnStartup(app, true)).toBe(false);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
    expect(app.getLoginItemSettings).not.toHaveBeenCalled();
  });

  it("état déjà conforme : ne réécrit pas (et respecte le Gestionnaire des tâches)", () => {
    const app = createFakeApp({ isPackaged: true, openAtLogin: true });
    expect(applyLaunchOnStartup(app, true)).toBe(false);
    expect(app.setLoginItemSettings).not.toHaveBeenCalled();
  });

  it("valeur non booléenne dans la config : traitée comme désactivée", () => {
    const app = createFakeApp({ isPackaged: true, openAtLogin: true });
    expect(applyLaunchOnStartup(app, "yes" as unknown as boolean)).toBe(true);
    expect(app.setLoginItemSettings).toHaveBeenCalledWith({ openAtLogin: false });
  });
});
