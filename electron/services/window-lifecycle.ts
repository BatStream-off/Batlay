/**
 * Cycle de vie de la fenêtre principale : affichage au démarrage, retour au
 * premier plan quand on relance l'app, démarrage avec Windows.
 *
 * Ce fichier n'importe volontairement RIEN d'Electron : il travaille sur des
 * interfaces minimales (WindowLike, LoginItemApp) que BrowserWindow / app
 * satisfont structurellement. C'est ce qui permet de tester chaque règle avec
 * de simples doubles (voir tests/window-lifecycle.test.ts) sans lancer
 * Electron ni Windows.
 */

/**
 * Filet de sécurité : si ni `ready-to-show` ni `did-fail-load` n'ont affiché
 * la fenêtre au bout de ce délai, on l'affiche quand même. Une fenêtre
 * invisible est pire qu'une fenêtre affichée un peu tôt : l'utilisateur ne
 * peut plus atteindre l'app, et le processus continue de tenir le port de
 * l'overlay.
 */
export const REVEAL_SAFETY_DELAY_MS = 5000;

/** Sous-ensemble de BrowserWindow dont ce module a besoin. */
export interface WindowLike {
  show(): void;
  minimize(): void;
  restore(): void;
  focus(): void;
  isMinimized(): boolean;
  isDestroyed(): boolean;
  // `any` volontaire : BrowserWindow / WebContents déclarent une surcharge par
  // événement ('ready-to-show', 'did-fail-load'...). Un type plus précis ici
  // ne serait pas assignable depuis ces surcharges pour un gain nul.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  once(event: any, listener: any): unknown;
  webContents: {
    on(event: any, listener: any): unknown;
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

export interface InitialWindowState {
  /**
   * TOUJOURS true. La fenêtre est créée avec `show: false` (pour éviter un
   * flash blanc avant le premier rendu), mais elle doit ensuite être
   * affichée dans tous les cas : c'est l'invariant qui manquait quand
   * « Start minimized » la laissait invisible pour toujours.
   */
  readonly show: true;
  /** Réduire dans la barre des tâches juste après l'avoir affichée. */
  readonly minimize: boolean;
}

/**
 * « Start minimized » signifie « démarrer RÉDUIT dans la barre des tâches »,
 * jamais « démarrer invisible » : sans icône de zone de notification, une
 * fenêtre masquée est inatteignable. Seul `true` strict réduit la fenêtre,
 * pour qu'une valeur absente ou corrompue dans le fichier de config retombe
 * sur le comportement le plus sûr (fenêtre normale).
 */
export function getInitialWindowState(settings: { startMinimized?: unknown }): InitialWindowState {
  return { show: true, minimize: settings?.startMinimized === true };
}

export interface RevealOptions {
  state: InitialWindowState;
  safetyDelayMs?: number;
  /** Injectables pour les tests (évite les faux timers globaux). */
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  log?: (message: string) => void;
}

/**
 * Branche l'affichage de la fenêtre et renvoie la fonction `reveal`.
 *
 * À appeler AVANT `loadURL` / `loadFile` : `ready-to-show` peut partir avant
 * même que la promesse de chargement soit résolue, et un `once()` posé après
 * l'`await` rate alors l'événement — la fenêtre ne s'affiche jamais.
 *
 * Trois déclencheurs, un seul affichage (reveal est idempotent) :
 *   1. `ready-to-show`     : cas nominal, premier rendu prêt ;
 *   2. `did-fail-load`     : le chargement de la page principale a échoué ;
 *      on montre quand même la fenêtre pour que l'utilisateur voie l'erreur
 *      au lieu d'un processus fantôme ;
 *   3. le délai de sécurité, pour tout cas que les deux autres manqueraient.
 */
export function attachWindowReveal(win: WindowLike, options: RevealOptions): () => void {
  const {
    state,
    safetyDelayMs = REVEAL_SAFETY_DELAY_MS,
    setTimer = (cb, ms) => setTimeout(cb, ms),
    clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    log = () => {},
  } = options;

  let revealed = false;
  let timer: unknown = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const reveal = (reason: string) => {
    if (revealed) return;
    revealed = true;
    cancelTimer();
    if (win.isDestroyed()) return;
    log(`fenêtre affichée (${reason})`);
    win.show();
    // Réduire APRÈS show() : la fenêtre existe dans la barre des tâches, on
    // peut la rouvrir. Le renderer, lui, continue de tourner (voir
    // backgroundThrottling dans main/index.ts), donc le polling musical et le
    // WebSocket vers OBS restent actifs.
    if (state.minimize) win.minimize();
  };

  win.once("ready-to-show", () => reveal("ready-to-show"));

  win.webContents.on(
    "did-fail-load",
    (_event: unknown, _code: number, description: string, _url: string, isMainFrame?: boolean) => {
      // Un échec de sous-frame ne doit pas déclencher l'affichage prématuré.
      if (isMainFrame === false) return;
      reveal(`did-fail-load: ${description}`);
    }
  );

  win.once("closed", cancelTimer);
  timer = setTimer(() => {
    timer = null;
    reveal("délai de sécurité");
  }, safetyDelayMs);

  return () => reveal("manuel");
}

/**
 * Relance de l'app (événement `second-instance`) : on ramène la fenêtre
 * EXISTANTE au premier plan. `restore()` seulement si elle est réduite : sur
 * Windows il défait aussi une fenêtre maximisée, ce qu'on ne veut pas.
 * Renvoie false s'il n'y a rien à ramener (fenêtre absente ou détruite).
 */
export function focusExistingWindow(win: WindowLike | null | undefined): boolean {
  if (!win || win.isDestroyed()) return false;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  return true;
}

/** Sous-ensemble de `app` pour le démarrage automatique. */
export interface LoginItemApp {
  isPackaged: boolean;
  getLoginItemSettings(): { openAtLogin: boolean };
  setLoginItemSettings(settings: { openAtLogin: boolean }): void;
}

/**
 * Applique « Launch on startup » au système. Sans cet appel le réglage était
 * enregistré mais ne faisait rien.
 *
 * - Seulement en version packagée : en développement, `process.execPath` est
 *   l'exécutable d'Electron lui-même, qu'on ne veut pas inscrire au démarrage
 *   de Windows.
 * - On ne réécrit pas si l'état demandé est déjà en place : évite de toucher
 *   au registre à chaque lancement, et respecte une désactivation faite par
 *   l'utilisateur dans le Gestionnaire des tâches quand le réglage est actif.
 *
 * Renvoie true si le système a effectivement été modifié.
 */
export function applyLaunchOnStartup(app: LoginItemApp, enabled: boolean): boolean {
  if (!app.isPackaged) return false;
  const wanted = enabled === true;
  if (app.getLoginItemSettings().openAtLogin === wanted) return false;
  app.setLoginItemSettings({ openAtLogin: wanted });
  return true;
}
