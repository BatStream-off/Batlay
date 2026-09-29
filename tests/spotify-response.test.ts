import { describe, it, expect } from "vitest";
import { normalizeCurrentlyPlaying } from "../electron/services/spotify-response";

describe("normalizeCurrentlyPlaying (process principal)", () => {
  const raw = {
    is_playing: true,
    progress_ms: 61_000,
    item: {
      id: "x",
      name: "Titre",
      duration_ms: 200_000,
      artists: [{ name: "Artiste 1" }, { name: "Artiste 2" }, { name: "Artiste 3" }],
      album: { name: "Album", images: [{ url: "u" }] },
    },
  };

  it("transmet la liste COMPLÈTE des artistes, sans rien tronquer", () => {
    const out = normalizeCurrentlyPlaying(raw, 1000, 1200);
    expect(out.item?.artists?.map((a) => a?.name)).toEqual(["Artiste 1", "Artiste 2", "Artiste 3"]);
  });

  it("convertit snake_case -> camelCase", () => {
    const out = normalizeCurrentlyPlaying(raw, 1000, 1200);
    expect(out.isPlaying).toBe(true);
    expect(out.progressMs).toBe(61_000);
  });

  it("date la mesure au MILIEU de l'aller-retour, pas à l'arrivée de la réponse", () => {
    expect(normalizeCurrentlyPlaying(raw, 1000, 1400).sampledAt).toBe(1200);
  });

  it("supporte progress_ms null et item absent", () => {
    const out = normalizeCurrentlyPlaying({ is_playing: false, progress_ms: null }, 5, 5);
    expect(out).toMatchObject({ isPlaying: false, progressMs: 0, item: null });
  });
});
