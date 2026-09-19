import { contextBridge, ipcRenderer } from "electron";
import type { PlaybackState } from "../shared/types.js";

/**
 * Surface IPC volontairement restreinte : le renderer ne peut appeler
 * que ces méthodes précises, jamais ipcRenderer directement (nodeIntegration
 * désactivé, contextIsolation activé — voir section Sécurité Electron).
 */
const batlayApi = {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    setSettings: (settings: Record<string, unknown>) => ipcRenderer.invoke("config:set-settings", settings),
    getOverlays: () => ipcRenderer.invoke("config:get-overlays"),
    saveOverlays: (overlays: unknown[]) => ipcRenderer.invoke("config:save-overlays", overlays),
    getActiveOverlayId: () => ipcRenderer.invoke("config:get-active-overlay-id"),
    setActiveOverlayId: (id: string | null) => ipcRenderer.invoke("config:set-active-overlay-id", id),
  },
  overlay: {
    getUrl: (overlayId: string) => ipcRenderer.invoke("overlay:get-url", overlayId),
    isRunning: () => ipcRenderer.invoke("overlay:is-running"),
    broadcastState: (state: PlaybackState) => ipcRenderer.send("overlay:broadcast-state", state),
    onServerError: (callback: (payload: { message: string }) => void) => {
      const listener = (_e: unknown, payload: { message: string }) => callback(payload);
      ipcRenderer.on("overlay-server:error", listener);
      return () => ipcRenderer.removeListener("overlay-server:error", listener);
    },
  },
  spotify: {
    isConfigured: () => ipcRenderer.invoke("spotify:is-configured"),
    setClientId: (clientId: string) => ipcRenderer.invoke("spotify:set-client-id", clientId),
    connect: () => ipcRenderer.invoke("spotify:connect"),
    disconnect: () => ipcRenderer.invoke("spotify:disconnect"),
    isSessionRestorable: () => ipcRenderer.invoke("spotify:is-session-restorable"),
    restoreSession: () => ipcRenderer.invoke("spotify:restore-session"),
    getCurrentlyPlaying: () => ipcRenderer.invoke("spotify:get-currently-playing"),
  },
  artwork: {
    lookup: (artist: string, title: string) =>
      ipcRenderer.invoke("artwork:lookup", { artist, title }),
  },
  systemMedia: {
    isSupported: () => ipcRenderer.invoke("system-media:is-supported"),
    listSessions: () => ipcRenderer.invoke("system-media:list-sessions"),
    getCurrent: (options?: { preferredAppId?: string; includeArtwork?: boolean }) =>
      ipcRenderer.invoke("system-media:get-current", options),
  },
};

contextBridge.exposeInMainWorld("batlay", batlayApi);

export type BatlayApi = typeof batlayApi;
