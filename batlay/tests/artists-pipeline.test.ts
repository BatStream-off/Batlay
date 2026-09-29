import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OverlayServer } from "../electron/services/overlay-server";
import { normalizeCurrentlyPlaying } from "../electron/services/spotify-response";
import type { PlaybackState } from "@/types/track";

/**
 * Pipeline COMPLET, sans mock intermédiaire :
 *   réponse Spotify brute -> normalisation (process principal)
 *     -> SpotifyProvider -> useMusicStore -> IPC (broadcastState)
 *     -> OverlayServer -> vrai WebSocket -> message reçu par l'overlay.
 * Vérifie qu'aucun maillon ne réduit la liste à un seul artiste.
 */

const PORT = 39_400 + Math.floor(Math.random() * 500);
let server: OverlayServer;
const staticDir = mkdtempSync(join(tmpdir(), "batlay-static-"));

beforeAll(async () => {
  server = new OverlayServer(PORT, staticDir);
  await server.start();
});
afterAll(async () => {
  await server.stop();
});

function nextStateMessage(ws: WebSocket, predicate: (s: PlaybackState) => boolean): Promise<{ payload: PlaybackState; sentAt: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("aucun état correspondant reçu")), 4000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString("utf8"));
      if (msg.type === "state" && predicate(msg.payload)) {
        clearTimeout(timer);
        resolve(msg);
      }
    });
  });
}

describe("pipeline Spotify -> overlay : tous les artistes arrivent jusqu'à l'affichage", () => {
  it.each([
    ["3 artistes", ["Artiste 1", "Artiste 2", "Artiste 3"], "Artiste 1, Artiste 2, Artiste 3"],
    ["accents et Ø", ["Angèle", "Stromae", "MØ"], "Angèle, Stromae, MØ"],
    ["nom avec virgule", ["Tyler, The Creator", "Kali Uchis"], "Tyler, The Creator, Kali Uchis"],
  ])("%s", async (_label, names, expected) => {
    const raw = {
      is_playing: true,
      progress_ms: 42_000,
      item: {
        id: "trk",
        name: "Titre é è à ç",
        duration_ms: 180_000,
        artists: names.map((name) => ({ name })),
        album: { name: "Album", images: [{ url: "https://i.scdn.co/a.jpg" }] },
      },
    };

    (globalThis as unknown as { window: unknown }).window = {
      batlay: {
        overlay: { broadcastState: (s: PlaybackState) => server.broadcastState(s) },
        spotify: {
          isConfigured: vi.fn().mockResolvedValue(true),
          connect: vi.fn().mockResolvedValue(true),
          disconnect: vi.fn().mockResolvedValue(true),
          isSessionRestorable: vi.fn().mockResolvedValue(false),
          getCurrentlyPlaying: vi.fn().mockImplementation(async () => {
            const t0 = Date.now();
            return normalizeCurrentlyPlaying(raw, t0, t0 + 20);
          }),
        },
      },
    };
    vi.resetModules();
    const { useMusicStore } = await import("@/stores/useMusicStore");

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/overlay-test`);
    await new Promise((resolve) => ws.once("open", resolve));
    const received = nextStateMessage(ws, (s) => s.track?.id === "trk");

    await useMusicStore.getState().connectSpotify();
    const message = await received;

    // Store (état React) ET message WebSocket reçu par la page OBS
    expect(useMusicStore.getState().playbackState.track?.artist).toBe(expected);
    expect(message.payload.track?.artist).toBe(expected);
    expect(message.payload.track?.artists).toEqual(names);
    expect(message.payload.track?.title).toBe("Titre é è à ç"); // UTF-8 intact sur le fil
    expect(typeof message.sentAt).toBe("number");

    await useMusicStore.getState().disconnect();
    ws.close();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("la déconnexion diffuse « plus de morceau » : OBS ne garde pas l'ancien morceau à l'écran", async () => {
    (globalThis as unknown as { window: unknown }).window = {
      batlay: { overlay: { broadcastState: (s: PlaybackState) => server.broadcastState(s) } },
    };
    vi.resetModules();
    const { useMusicStore } = await import("@/stores/useMusicStore");
    await useMusicStore.getState().connectDemo();

    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/overlay-test`);
    await new Promise((resolve) => ws.once("open", resolve));
    const cleared = nextStateMessage(ws, (s) => s.track === null);
    await useMusicStore.getState().disconnect();
    expect((await cleared).payload.track).toBeNull();
    ws.close();
    delete (globalThis as unknown as { window?: unknown }).window;
  });
});
