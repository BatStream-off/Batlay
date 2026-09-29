import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OverlayServer } from "../services/overlay-server.js";
import { store, type BatlayConfigSchema } from "../services/config-store.js";
import * as spotifyAuth from "../services/spotify-auth.js";
import * as systemMedia from "../services/system-media.js";
import { lookupArtwork } from "../services/artwork-lookup.js";
import type { PlaybackState } from "../shared/types.js";
import {
  applyLaunchOnStartup,
  attachWindowReveal,
  focusExistingWindow,
  getInitialWindowState,
} from "../services/window-lifecycle.js";
import {
  normalizeThemePreference,
  syncNativeTheme,
  WINDOW_BACKGROUND,
  type ResolvedTheme,
  type ThemePreference,
} from "../shared/theme.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";

let mainWindow: BrowserWindow | null = null;
let overlayServer: OverlayServer | null = null;

interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

/** Thème courant, tel que nativeTheme le résout (suit Windows quand le réglage est « system »). */
function getThemeState(): ThemeState {
  return {
    preference: normalizeThemePreference(store.get("settings").theme),
    resolved: nativeTheme.shouldUseDarkColors ? "dark" : "light",
  };
}

/** Fond natif + notification du renderer. Ne touche PAS à themeSource (évite toute boucle avec « updated »). */
function pushThemeState(): void {
  const state = getThemeState();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setBackgroundColor(WINDOW_BACKGROUND[state.resolved]);
  mainWindow.webContents.send("theme:changed", state);
}

/** Aligne nativeTheme sur le réglage enregistré, puis diffuse le résultat. */
function applyThemeFromSettings(): void {
  syncNativeTheme(nativeTheme, normalizeThemePreference(store.get("settings").theme));
  pushThemeState();
}

async function createWindow(): Promise<void> {
  const initialWindowState = getInitialWindowState(store.get("settings"));

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    // Fond natif = fond de l'app dans le thème actif : aucun flash entre
    // l'ouverture de la fenêtre et le premier rendu du renderer.
    backgroundColor: WINDOW_BACKGROUND[getThemeState().resolved],
    title: "Batlay",
    // La fenêtre est créée masquée pour éviter un flash avant le premier
    // rendu, mais attachWindowReveal (ci-dessous) l'affiche TOUJOURS.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Le polling musical (setInterval de 2s) et la diffusion WebSocket
      // vivent dans le renderer. Par défaut, Chromium ralentit fortement
      // les timers d'une fenêtre masquée/minimisée — or un streamer
      // minimise Batlay pendant son live. Sans ça, l'état envoyé à OBS se
      // fige dès que la fenêtre est réduite.
      backgroundThrottling: false,
    },
  });

  Menu.setApplicationMenu(null);

  // Menu.setApplicationMenu(null) supprime aussi les raccourcis clavier
  // par défaut d'Electron habituellement portés par le menu (dont
  // Ctrl+Shift+I / F12 pour les DevTools). On les réenregistre
  // explicitement : sans ça, il est impossible d'ouvrir la Console pour
  // diagnostiquer quoi que ce soit une fois l'app packagée (hors mode dev).
  mainWindow.webContents.on("before-input-event", (_event, input) => {
    const isToggleDevTools =
      input.type === "keyDown" &&
      ((input.control && input.shift && input.key.toLowerCase() === "i") || input.key === "F12");
    if (isToggleDevTools) {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // AVANT le chargement : `ready-to-show` peut partir avant la fin de
  // `loadFile`, et un écouteur posé après l'`await` ratait l'événement (la
  // fenêtre restait alors invisible). Avec « Start minimized » elle n'était
  // de toute façon jamais affichée : voir getInitialWindowState.
  attachWindowReveal(mainWindow, {
    state: initialWindowState,
    log: (message) => console.log(`[Batlay] ${message}`),
  });

  try {
    if (isDev) {
      await mainWindow.loadURL("http://localhost:5173/index.html");
      mainWindow.webContents.openDevTools({ mode: "detach" });
    } else {
      await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
    }
  } catch (err) {
    // did-fail-load affiche déjà la fenêtre (attachWindowReveal) ; on ne
    // laisse pas la promesse rejetée sans traitement dans whenReady().
    console.error("[Batlay] Échec du chargement de la fenêtre principale :", err);
  }
}

async function startOverlayServer(): Promise<void> {
  const port = store.get("settings").overlayServerPort;
  const staticDir = isDev
    ? path.join(__dirname, "../../dist") // en dev, l'overlay pointe vers le build le plus récent
    : path.join(__dirname, "../../dist");

  overlayServer = new OverlayServer(port, staticDir);
  overlayServer.setOverlayConfigs(store.get("overlays") as { id: string }[]);
  try {
    await overlayServer.start();
  } catch (err) {
    // Un port déjà utilisé est une erreur attendue et gérable : Batlay ne
    // doit jamais crasher silencieusement dessus (voir section Gestion des erreurs).
    console.error(`[Batlay] Échec du démarrage du serveur d'overlay sur le port ${port}:`, err);
    mainWindow?.webContents.send("overlay-server:error", {
      message: `Le port ${port} est déjà utilisé par une autre application. Changez le port dans Settings > Overlay Server.`,
    });
  }
}

function registerIpcHandlers(): void {
  // --- Config / Settings ---
  ipcMain.handle("config:get", () => store.store);
  ipcMain.handle("config:set-settings", (_e, patch: Partial<BatlayConfigSchema["settings"]>) => {
    const previous = store.get("settings");
    const next = { ...previous, ...patch };
    // Le renderer est de confiance limitée : une valeur de thème inconnue ne
    // doit jamais être persistée (elle casserait la résolution au démarrage).
    next.theme = normalizeThemePreference(next.theme);
    store.set("settings", next);

    if (next.theme !== previous.theme) applyThemeFromSettings();
    if (next.launchOnStartup !== previous.launchOnStartup) applyLaunchOnStartup(app, next.launchOnStartup);
    return store.get("settings");
  });

  // Lecture SYNCHRONE (sendSync côté preload) : le renderer applique le thème
  // avant son premier rendu. Renvoie le thème déjà résolu par nativeTheme.
  ipcMain.on("theme:get-initial", (event) => {
    event.returnValue = getThemeState();
  });
  ipcMain.handle("config:get-overlays", () => store.get("overlays"));
  ipcMain.handle("config:save-overlays", (_e, overlays) => {
    store.set("overlays", overlays);
    overlayServer?.setOverlayConfigs(overlays);
    return true;
  });
  ipcMain.handle("config:get-active-overlay-id", () => store.get("activeOverlayId"));
  ipcMain.handle("config:set-active-overlay-id", (_e, id: string | null) => {
    store.set("activeOverlayId", id);
    return true;
  });

  // --- Overlay server ---
  ipcMain.handle("overlay:get-url", (_e, overlayId: string) => {
    if (!overlayServer || !overlayServer.isRunning()) {
      throw new Error(
        "Le serveur d'overlay n'est pas démarré (port déjà utilisé ?). Vérifiez Settings > Overlay Server."
      );
    }
    return overlayServer.getOverlayUrl(overlayId);
  });
  ipcMain.handle("overlay:is-running", () => overlayServer?.isRunning() ?? false);
  ipcMain.on("overlay:broadcast-state", (_e, state: PlaybackState) => {
    overlayServer?.broadcastState(state);
  });

  // --- Spotify ---
  ipcMain.handle("spotify:is-configured", () => spotifyAuth.isConfigured());
  ipcMain.handle("spotify:set-client-id", (_e, clientId: string) => {
    spotifyAuth.setClientId(clientId);
    return true;
  });
  ipcMain.handle("spotify:connect", async () => {
    await spotifyAuth.connectSpotify();
    return true;
  });
  ipcMain.handle("spotify:disconnect", () => {
    spotifyAuth.disconnectSpotify();
    return true;
  });
  ipcMain.handle("spotify:is-session-restorable", () => spotifyAuth.isSessionRestorable());
  ipcMain.handle("spotify:restore-session", () => spotifyAuth.restoreSession());
  ipcMain.handle("spotify:get-currently-playing", () => spotifyAuth.fetchCurrentlyPlaying());

  // --- Lecture système (Windows SMTC) : alternative à Spotify qui ne
  // requiert ni compte Premium ni Client ID, voir electron/services/system-media.ts ---
  ipcMain.handle("system-media:is-supported", () => systemMedia.isPlatformSupported());
  ipcMain.handle("system-media:list-sessions", () => systemMedia.listSystemMediaSessions());
  ipcMain.handle("system-media:get-current", (_e, options?: systemMedia.GetCurrentOptions) =>
    systemMedia.getCurrentSystemMedia(options)
  );

  // --- Pochette de secours (artiste + titre -> URL), quand le lecteur
  // n'expose aucune vignette au système. Voir electron/services/artwork-lookup.ts ---
  ipcMain.handle("artwork:lookup", (_e, payload: { artist: string; title: string }) =>
    lookupArtwork(payload?.artist ?? "", payload?.title ?? "")
  );
}

// Instance unique, demandée AVANT whenReady. Sans elle, un second lancement
// démarrait un second processus : il n'obtenait pas le port de l'overlay
// (EADDRINUSE, port 3000 déjà pris par le premier) et, avec « Start
// minimized », l'utilisateur relançait Batlay sans jamais voir de fenêtre.
const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  // Une instance tourne déjà : elle reçoit `second-instance` et se ramène au
  // premier plan. Ce processus-ci n'a rien d'autre à faire que se terminer.
  app.quit();
} else {
  app.on("second-instance", () => {
    focusExistingWindow(mainWindow);
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();

    // Réglage « Launch on startup » : enregistré par l'UI, mais jamais
    // appliqué au système avant ce correctif. Version packagée uniquement.
    applyLaunchOnStartup(app, store.get("settings").launchOnStartup);

    // Thème : nativeTheme AVANT la création de la fenêtre (fond natif correct),
    // puis suivi des changements de Windows pour le réglage « system ».
    applyThemeFromSettings();
    nativeTheme.on("updated", pushThemeState);

    await startOverlayServer();
    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting || !overlayServer) return;
  // Electron n'attend pas les handlers async : sans preventDefault + quit
  // différé, l'app peut se fermer avant que le serveur ait libéré son
  // port, risquant un "port déjà utilisé" au prochain lancement.
  event.preventDefault();
  isQuitting = true;
  overlayServer.stop().finally(() => app.quit());
});
