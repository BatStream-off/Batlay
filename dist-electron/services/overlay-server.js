import express from "express";
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
/**
 * Le Batlay Overlay Server sert :
 *   - GET /overlay/:overlayId   -> la page d'overlay (statique, buildée par Vite)
 *   - WS  /ws/:overlayId        -> flux temps réel de l'état de lecture
 *
 * Il démarre automatiquement avec Batlay (voir electron/main/index.ts) —
 * l'utilisateur n'a jamais à lancer une commande manuellement.
 */
export class OverlayServer {
    app;
    httpServer;
    wss;
    port;
    lastState = { track: null, isPlaying: false, updatedAt: Date.now() };
    clientsByOverlay = new Map();
    // Alimenté par le process principal à chaque changement (voir main/index.ts).
    // C'est ainsi que la page overlay (servie statiquement, sans accès direct
    // au config-store d'Electron) récupère la configuration à afficher.
    overlayConfigs = new Map();
    constructor(port, staticDir) {
        this.port = port;
        this.app = express();
        // La page overlay.html buildée par Vite est servie ici. Aucun
        // dashboard, menu ou fond opaque n'est exposé sur cette route.
        this.app.use(express.static(staticDir));
        this.app.get("/overlay/:overlayId", (_req, res) => {
            res.sendFile(path.join(staticDir, "overlay.html"));
        });
        this.app.get("/api/overlays/:overlayId", (req, res) => {
            const config = this.overlayConfigs.get(req.params.overlayId);
            if (!config) {
                res.status(404).json({ error: "Overlay introuvable" });
                return;
            }
            res.json(config);
        });
        this.app.get("/health", (_req, res) => res.json({ status: "ok" }));
        this.httpServer = createServer(this.app);
        this.wss = new WebSocketServer({ server: this.httpServer, path: undefined });
        this.wss.on("connection", (ws, req) => {
            const overlayId = this.extractOverlayId(req.url);
            if (!overlayId) {
                ws.close(1008, "overlayId manquant");
                return;
            }
            this.registerClient(overlayId, ws);
            // Envoi immédiat de l'état actuel pour éviter un overlay vide au chargement
            ws.send(JSON.stringify({ type: "state", payload: this.lastState }));
            ws.on("close", () => this.clientsByOverlay.get(overlayId)?.delete(ws));
        });
    }
    extractOverlayId(url) {
        if (!url)
            return null;
        const match = url.match(/^\/ws\/([^/?]+)/);
        return match ? match[1] : null;
    }
    registerClient(overlayId, ws) {
        if (!this.clientsByOverlay.has(overlayId)) {
            this.clientsByOverlay.set(overlayId, new Set());
        }
        this.clientsByOverlay.get(overlayId).add(ws);
    }
    /** Diffuse le nouvel état de lecture à tous les overlays connectés. */
    broadcastState(state) {
        this.lastState = state;
        const message = JSON.stringify({ type: "state", payload: state });
        for (const clients of this.clientsByOverlay.values()) {
            for (const ws of clients) {
                if (ws.readyState === WebSocket.OPEN)
                    ws.send(message);
            }
        }
    }
    getOverlayUrl(overlayId) {
        return `http://localhost:${this.port}/overlay/${overlayId}`;
    }
    /** Met à jour la liste des overlays disponibles pour la route /api/overlays/:id. */
    setOverlayConfigs(overlays) {
        this.overlayConfigs = new Map(overlays.map((o) => [o.id, o]));
    }
    start() {
        return new Promise((resolve, reject) => {
            this.httpServer.once("error", reject);
            this.httpServer.listen(this.port, "127.0.0.1", () => resolve());
        });
    }
    stop() {
        return new Promise((resolve) => {
            this.wss.clients.forEach((c) => c.close());
            this.httpServer.close(() => resolve());
        });
    }
    isRunning() {
        return this.httpServer.listening;
    }
}
//# sourceMappingURL=overlay-server.js.map