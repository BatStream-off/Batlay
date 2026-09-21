import { createHash } from "node:crypto";
import type { PlaybackState } from "../shared/types.js";

/**
 * Sort les pochettes "data:" du flux WebSocket.
 *
 * La Lecture système fournit la pochette en data URI base64 (souvent
 * 100 à 500 Ko). L'ancien code la renvoyait à chaque message — c'est-à-dire
 * toutes les 0,4 à 2 s, à chaque overlay — ce qui obligeait à sérialiser,
 * transférer et re-parser plusieurs centaines de Ko pour faire avancer une
 * barre de progression. Désormais l'image est stockée une fois et le
 * message ne contient plus qu'une URL courte (`/api/artwork/<id>`) que le
 * navigateur d'OBS télécharge et met en cache une seule fois.
 *
 * Sans import Electron : testé directement (tests/artwork-store.test.ts).
 */

export interface StoredArtwork {
  mime: string;
  data: Buffer;
}

const DATA_URI = /^data:([^;,]+)((?:;[^;,]+)*?)(;base64)?,([\s\S]*)$/;

export class ArtworkStore {
  private byId = new Map<string, StoredArtwork>();
  /** Dernière data URI traitée -> id : évite de re-hacher la même image à chaque message. */
  private lastSource: string | null = null;
  private lastId: string | null = null;

  constructor(private readonly capacity = 8) {}

  get(id: string): StoredArtwork | undefined {
    return this.byId.get(id);
  }

  get size(): number {
    return this.byId.size;
  }

  /**
   * Retourne un état dont la pochette "data:" est remplacée par une URL
   * relative. Les URLs http(s) (Spotify, iTunes, Deezer) et l'absence de
   * pochette ne sont pas modifiées. L'objet d'entrée n'est jamais muté.
   */
  externalize(state: PlaybackState): PlaybackState {
    const artwork = state.track?.artwork;
    if (!state.track || !artwork || !artwork.startsWith("data:")) return state;

    let id: string | null = artwork === this.lastSource ? this.lastId : null;
    if (!id || !this.byId.has(id)) {
      const parsed = this.store(artwork);
      if (!parsed) {
        // Data URI illisible : mieux vaut pas de pochette qu'une image cassée.
        return { ...state, track: { ...state.track, artwork: undefined } };
      }
      id = parsed;
      this.lastSource = artwork;
      this.lastId = id;
    }
    return { ...state, track: { ...state.track, artwork: `/api/artwork/${id}` } };
  }

  private store(dataUri: string): string | null {
    const match = DATA_URI.exec(dataUri);
    if (!match) return null;
    const [, mime, , base64Flag, payload] = match;
    let data: Buffer;
    try {
      data = base64Flag ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
    } catch {
      return null;
    }
    if (data.length === 0) return null;

    const id = createHash("sha1").update(data).digest("hex").slice(0, 16);
    if (!this.byId.has(id)) {
      this.byId.set(id, { mime, data });
      // Éviction FIFO : on ne garde que les dernières pochettes.
      while (this.byId.size > this.capacity) {
        const oldest = this.byId.keys().next().value as string;
        this.byId.delete(oldest);
      }
    }
    return id;
  }
}
