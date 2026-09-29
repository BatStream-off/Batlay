import { app, BrowserWindow, ipcMain, Menu } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OverlayServer } from "../services/overlay-server.js";
import { store } from "../services/config-store.js";
import * as spotifyAuth from "../services/spotify-auth.js";
import * as systemMedia from "../services/system-media.js";
import { lookupArtwork } from "../services/artwork-lookup.js";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === "development";
let mainWindow = null;
let overlayServer = null;
async function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 700,
        backgroundColor: "#0A0A0F",
        title: "Batlay",
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
        const isToggleDevTools = input.type === "keyDown" &&
            ((input.control && input.shift && input.key.toLowerCase() === "i") || input.key === "F12");
        if (isToggleDevTools) {
            mainWindow?.webContents.toggleDevTools();
        }
    });
    if (isDev) {
        await mainWindow.loadURL("http://localhost:5173/index.html");
        mainWindow.webContents.openDevTools({ mode: "detach" });
    }
    else {
        await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
    }
    mainWindow.once("ready-to-show", () => {
        const startMinimized = store.get("settings").startMinimized;
        if (!startMinimized)
            mainWindow?.show();
    });
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
}
async function startOverlayServer() {
    const port = store.get("settings").overlayServerPort;
    const staticDir = isDev
        ? path.join(__dirname, "../../dist") // en dev, l'overlay pointe vers le build le plus récent
        : path.join(__dirname, "../../dist");
    overlayServer = new OverlayServer(port, staticDir);
    overlayServer.setOverlayConfigs(store.get("overlays"));
    try {
        await overlayServer.start();
    }
    catch (err) {
        // Un port déjà utilisé est une erreur attendue et gérable : Batlay ne
        // doit jamais crasher silencieusement dessus (voir section Gestion des erreurs).
        console.error(`[Batlay] Échec du démarrage du serveur d'overlay sur le port ${port}:`, err);
        mainWindow?.webContents.send("overlay-server:error", {
            message: `Le port ${port} est déjà utilisé par une autre application. Changez le port dans Settings > Overlay Server.`,
        });
    }
}
function registerIpcHandlers() {
    // --- Config / Settings ---
    ipcMain.handle("config:get", () => store.store);
    ipcMain.handle("config:set-settings", (_e, settings) => {
        store.set("settings", { ...store.get("settings"), ...settings });
        return store.get("settings");
    });
    ipcMain.handle("config:get-overlays", () => store.get("overlays"));
    ipcMain.handle("config:save-overlays", (_e, overlays) => {
        store.set("overlays", overlays);
        overlayServer?.setOverlayConfigs(overlays);
        return true;
    });
    ipcMain.handle("config:get-active-overlay-id", () => store.get("activeOverlayId"));
    ipcMain.handle("config:set-active-overlay-id", (_e, id) => {
        store.set("activeOverlayId", id);
        return true;
    });
    // --- Overlay server ---
    ipcMain.handle("overlay:get-url", (_e, overlayId) => {
        if (!overlayServer || !overlayServer.isRunning()) {
            throw new Error("Le serveur d'overlay n'est pas démarré (port déjà utilisé ?). Vérifiez Settings > Overlay Server.");
        }
        return overlayServer.getOverlayUrl(overlayId);
    });
    ipcMain.handle("overlay:is-running", () => overlayServer?.isRunning() ?? false);
    ipcMain.on("overlay:broadcast-state", (_e, state) => {
        overlayServer?.broadcastState(state);
    });
    // --- Spotify ---
    ipcMain.handle("spotify:is-configured", () => spotifyAuth.isConfigured());
    ipcMain.handle("spotify:set-client-id", (_e, clientId) => {
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
    ipcMain.handle("system-media:get-current", (_e, options) => systemMedia.getCurrentSystemMedia(options));
    // --- Pochette de secours (artiste + titre -> URL), quand le lecteur
    // n'expose aucune vignette au système. Voir electron/services/artwork-lookup.ts ---
    ipcMain.handle("artwork:lookup", (_e, payload) => lookupArtwork(payload?.artist ?? "", payload?.title ?? ""));
}
app.whenReady().then(async () => {
    registerIpcHandlers();
    await startOverlayServer();
    await createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin")
        app.quit();
});
let isQuitting = false;
app.on("before-quit", (event) => {
    if (isQuitting || !overlayServer)
        return;
    // Electron n'attend pas les handlers async : sans preventDefault + quit
    // différé, l'app peut se fermer avant que le serveur ait libéré son
    // port, risquant un "port déjà utilisé" au prochain lancement.
    event.preventDefault();
    isQuitting = true;
    overlayServer.stop().finally(() => app.quit());
});
//# sourceMappingURL=index.js.map