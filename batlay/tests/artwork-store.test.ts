import { describe, it, expect } from "vitest";
import { ArtworkStore } from "../electron/services/artwork-store";
import type { PlaybackState } from "@/types/track";

const stateWith = (artwork?: string): PlaybackState => ({
  track: { id: "t", title: "T", artist: "A", duration: 1, progress: 0, isPlaying: true, artwork },
  isPlaying: true,
  updatedAt: 1,
});
const uri = (n: number) => `data:image/png;base64,${Buffer.from(`img-${n}`).toString("base64")}`;

describe("ArtworkStore", () => {
  it("remplace une data URI par une URL stable (même image -> même URL)", () => {
    const store = new ArtworkStore();
    const a = store.externalize(stateWith(uri(1))).track!.artwork;
    const b = store.externalize(stateWith(uri(1))).track!.artwork;
    expect(a).toMatch(/^\/api\/artwork\/[0-9a-f]{16}$/);
    expect(b).toBe(a);
    expect(store.size).toBe(1);
  });

  it("ne mute jamais l'état d'entrée", () => {
    const store = new ArtworkStore();
    const input = stateWith(uri(1));
    store.externalize(input);
    expect(input.track!.artwork).toBe(uri(1));
  });

  it("ne touche pas aux URLs distantes, ni à l'absence de pochette ni à un état sans morceau", () => {
    const store = new ArtworkStore();
    const remote = stateWith("https://x/y.jpg");
    expect(store.externalize(remote)).toBe(remote);
    const none = stateWith(undefined);
    expect(store.externalize(none)).toBe(none);
    const empty: PlaybackState = { track: null, isPlaying: false, updatedAt: 0 };
    expect(store.externalize(empty)).toBe(empty);
  });

  it("supprime la pochette plutôt que d'envoyer une image cassée si la data URI est illisible", () => {
    const store = new ArtworkStore();
    expect(store.externalize(stateWith("data:image/png;base64,")).track!.artwork).toBeUndefined();
    expect(store.externalize(stateWith("data:pas-une-uri")).track!.artwork).toBeUndefined();
  });

  it("borne la mémoire : n'garde que les dernières pochettes", () => {
    const store = new ArtworkStore(3);
    const urls = [1, 2, 3, 4, 5].map((n) => store.externalize(stateWith(uri(n))).track!.artwork!);
    expect(store.size).toBe(3);
    expect(store.get(urls[0].split("/").pop()!)).toBeUndefined(); // la plus ancienne est évincée
    expect(store.get(urls[4].split("/").pop()!)).toBeDefined();
  });
});
