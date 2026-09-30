import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Batlay expose deux points d'entrée web :
//  - index.html      -> le dashboard (Electron renderer)
//  - overlay.html     -> la page d'overlay servie par le Batlay Overlay Server
//                         et chargée par OBS Browser Source
//  - twitch-overlay.html -> le chat Twitch, servi par le serveur Twitch (port 4000)
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
      "@overlay": resolve(__dirname, "overlay"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "overlay.html"),
        // Chat Twitch : page OBS servie par le serveur Twitch (port 4000), indépendante de l'overlay musical.
        twitchOverlay: resolve(__dirname, "twitch-overlay.html"),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
