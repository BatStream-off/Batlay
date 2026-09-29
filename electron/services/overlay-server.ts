import express, { type Express } from "express";
import { createServer, type Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import type { PlaybackState } from "../shared/types.js";
import { ArtworkStore } from "./artwork-store.js";

/**
 * Le Batlay Overlay Server sert :
 *   - GET /overlay/:overlayId   -> la page d'overlay (statique, buildée par Vite)
 *   - WS  /ws/:overlayId        -> flux temps réel de l'état de lecture
 *
 * Il démarre automatiquement avec Batlay (voir electron/main/index.ts) —
 * l'utilisateur n'a jamais à lancer une commande manuellement.
 */
export class OverlayServer {
  private app: Express;
  private httpServer: HttpServer;
  private wss: WebSocketServer;
  private port: number;
  private lastState: PlaybackState = { track: null, isPlaying: false, updatedAt: Date.now() };
  private clientsByOverlay = new Map<string, Set<WebSocket>>();
  // Alimenté par le process principal à chaque changement (voir main/index.ts).
  // C'est ainsi que la page overlay (servie statiquement, sans accès direct
  // au config-store d'Electron) récupère la configuration à afficher.
  private overlayConfigs = new Map<string, unknown>();
  /** JSON sérialisé de chaque config : détecte ce qui a réellement changé à la sauvegarde. */
  private overlayConfigJson = new Map<string, string>();
  private artworkStore = new ArtworkStore();

  constructor(port: number, staticDir: string) {
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
    // Pochettes "data:" (Lecture système) servies une fois et mises en cache
    // par le navigateur, au lieu d'être ré-envoyées dans chaque message WebSocket.
    this.app.get("/api/artwork/:id", (req, res) => {
      const artwork = this.artworkStore.get(req.params.id);
      if (!artwork) {
        res.status(404).end();
        return;
      }
      // L'id est un hash du contenu : l'image ne change jamais pour une même URL.
      res.set("Cache-Control", "public, max-age=31536000, immutable");
      res.type(artwork.mime).send(artwork.data);
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
      // Sans ce refus, une source OBS dont le lien a été régénéré (ou dont
      // l'overlay a été supprimé) se reconnecterait toutes les 2 s (voir
      // overlay/OverlayApp.tsx) et continuerait de recevoir l'état de lecture.
      if (!this.overlayConfigs.has(overlayId)) {
        ws.close(1008, "Overlay inconnu ou lien OBS révoqué");
        return;
      }
      this.registerClient(overlayId, ws);
      // Envoi immédiat de l'état actuel pour éviter un overlay vide au chargement
      ws.send(this.buildStateMessage(this.lastState));

      ws.on("close", () => this.clientsByOverlay.get(overlayId)?.delete(ws));
    });
  }

  private extractOverlayId(url?: string): string | null {
    if (!url) return null;
    const match = url.match(/^\/ws\/([^/?]+)/);
    return match ? match[1] : null;
  }

  private registerClient(overlayId: string, ws: WebSocket): void {
    if (!this.clientsByOverlay.has(overlayId)) {
      this.clientsByOverlay.set(overlayId, new Set());
    }
    this.clientsByOverlay.get(overlayId)!.add(ws);
  }

  /**
   * Message "state". `sentAt` est l'horloge de CE process au moment de
   * l'envoi : combiné à `payload.updatedAt` (même horloge, instant de la
   * mesure), il donne à l'overlay l'âge exact de la mesure sans dépendre de
   * la synchronisation entre l'horloge d'OBS et celle de Batlay.
   */
  private buildStateMessage(state: PlaybackState): string {
    return JSON.stringify({
      type: "state",
      payload: this.artworkStore.externalize(state),
      sentAt: Date.now(),
    });
  }

  /** Diffuse le nouvel état de lecture à tous les overlays connectés. */
  broadcastState(state: PlaybackState): void {
    this.lastState = state;
    const message = this.buildStateMessage(state);
    for (const clients of this.clientsByOverlay.values()) {
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    }
  }

  getOverlayUrl(overlayId: string): string {
    return `http://localhost:${this.port}/overlay/${overlayId}`;
  }

  /**
   * Met à jour la liste des overlays disponibles pour la route
   * /api/overlays/:id, et POUSSE aux overlays déjà ouverts dans OBS ceux dont
   * la configuration a changé : un "Save" dans l'éditeur se voit
   * immédiatement à l'antenne, sans recharger la Browser Source.
   *
   * Un id qui disparaît de la liste (overlay supprimé, lien OBS régénéré) est
   * révoqué : ses sources OBS sont déconnectées, et ne pourront pas revenir
   * (voir le refus dans le handler "connection").
   */
  setOverlayConfigs(overlays: { id: string }[]): void {
    const previousJson = this.overlayConfigJson;
    this.overlayConfigs = new Map(overlays.map((o) => [o.id, o]));
    this.overlayConfigJson = new Map(overlays.map((o) => [o.id, JSON.stringify(o)]));

    for (const overlay of overlays) {
      const before = previousJson.get(overlay.id);
      if (before === undefined || before === this.overlayConfigJson.get(overlay.id)) continue;
      const message = JSON.stringify({ type: "config", payload: overlay });
      for (const ws of this.clientsByOverlay.get(overlay.id) ?? []) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    }

    // Supprimer pendant l'itération d'une Map est sans danger en JavaScript.
    for (const [overlayId, clients] of this.clientsByOverlay) {
      if (this.overlayConfigs.has(overlayId)) continue;
      for (const ws of clients) ws.close(1008, "Lien OBS révoqué");
      this.clientsByOverlay.delete(overlayId);
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(this.port, "127.0.0.1", () => resolve());
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.wss.clients.forEach((c) => c.close());
      this.httpServer.close(() => resolve());
    });
  }

  isRunning(): boolean {
    return this.httpServer.listening;
  }
}
