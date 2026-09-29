"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// electron/preload/index.ts
var preload_exports = {};
module.exports = __toCommonJS(preload_exports);
var import_electron = require("electron");
var batlayApi = {
  config: {
    get: () => import_electron.ipcRenderer.invoke("config:get"),
    setSettings: (settings) => import_electron.ipcRenderer.invoke("config:set-settings", settings),
    getOverlays: () => import_electron.ipcRenderer.invoke("config:get-overlays"),
    saveOverlays: (overlays) => import_electron.ipcRenderer.invoke("config:save-overlays", overlays),
    getActiveOverlayId: () => import_electron.ipcRenderer.invoke("config:get-active-overlay-id"),
    setActiveOverlayId: (id) => import_electron.ipcRenderer.invoke("config:set-active-overlay-id", id)
  },
  overlay: {
    getUrl: (overlayId) => import_electron.ipcRenderer.invoke("overlay:get-url", overlayId),
    isRunning: () => import_electron.ipcRenderer.invoke("overlay:is-running"),
    broadcastState: (state) => import_electron.ipcRenderer.send("overlay:broadcast-state", state),
    onServerError: (callback) => {
      const listener = (_e, payload) => callback(payload);
      import_electron.ipcRenderer.on("overlay-server:error", listener);
      return () => import_electron.ipcRenderer.removeListener("overlay-server:error", listener);
    }
  },
  spotify: {
    isConfigured: () => import_electron.ipcRenderer.invoke("spotify:is-configured"),
    setClientId: (clientId) => import_electron.ipcRenderer.invoke("spotify:set-client-id", clientId),
    connect: () => import_electron.ipcRenderer.invoke("spotify:connect"),
    disconnect: () => import_electron.ipcRenderer.invoke("spotify:disconnect"),
    isSessionRestorable: () => import_electron.ipcRenderer.invoke("spotify:is-session-restorable"),
    restoreSession: () => import_electron.ipcRenderer.invoke("spotify:restore-session"),
    getCurrentlyPlaying: () => import_electron.ipcRenderer.invoke("spotify:get-currently-playing")
  },
  artwork: {
    lookup: (artist, title) => import_electron.ipcRenderer.invoke("artwork:lookup", { artist, title })
  },
  systemMedia: {
    isSupported: () => import_electron.ipcRenderer.invoke("system-media:is-supported"),
    listSessions: () => import_electron.ipcRenderer.invoke("system-media:list-sessions"),
    getCurrent: (options) => import_electron.ipcRenderer.invoke("system-media:get-current", options)
  }
};
import_electron.contextBridge.exposeInMainWorld("batlay", batlayApi);
