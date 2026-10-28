import { describe, it, expect } from "vitest";
import { COMPONENT_TYPES, MUSIC_INDEPENDENT_TYPES, createImageComponent, fitImageSize } from "@/utils/overlay-model";
import { CUSTOM_TEMPLATES, getCustomTemplate } from "@/presets/custom-templates";
import { parseOverlayImport } from "@/utils/overlay-import";
import { componentContentKey } from "@/utils/overlay-motion";
import { formatClock } from "@/components/OverlayMedia";
import type { OverlayComponentConfig } from "@/types/overlay";

const track = { id: "t", title: "Starboy", artist: "The Weeknd", artists: ["The Weeknd"], album: "", source: "", duration: 1, progress: 0, isPlaying: true };

describe("images", () => {
  it("garde les proportions, au plus 40 % du canvas, jamais agrandie", () => {
    expect(fitImageSize({ width: 4000, height: 2000 }, { width: 1920, height: 1080 })).toEqual({ width: 768, height: 384 });
    expect(fitImageSize({ width: 200, height: 100 }, { width: 1920, height: 1080 })).toEqual({ width: 200, height: 100 });
    expect(fitImageSize({ width: 1000, height: 3000 }, { width: 1920, height: 1080 })).toEqual({ width: 144, height: 432 });
  });
  it("composant centré sur le point de dépôt, sans sortir du canvas, au-dessus des autres", () => {
    const existing = [{ id: "a", order: 4 } as OverlayComponentConfig];
    const c = createImageComponent("0123456789abcdef01234567.png", { width: 200, height: 100 }, { width: 1920, height: 1080 }, existing, { x: 1900, y: 10 });
    expect(c).toMatchObject({ type: "image", mediaId: "0123456789abcdef01234567.png", order: 5, transform: { x: 1720, y: 0, width: 200, height: 100 } });
    const centered = createImageComponent("0123456789abcdef01234567.png", { width: 200, height: 100 }, { width: 1000, height: 500 }, []);
    expect(centered.transform).toMatchObject({ x: 400, y: 200 });
  });
  it("nouveaux types : connus du modèle, indépendants de la musique dans un overlay personnalisé", () => {
    expect(COMPONENT_TYPES).toEqual(expect.arrayContaining(["image", "clock"]));
    for (const t of ["image", "clock", "shape", "text"] as const) expect(MUSIC_INDEPENDENT_TYPES.has(t)).toBe(true);
    expect(MUSIC_INDEPENDENT_TYPES.has("artwork")).toBe(false);
  });
  it("transitions : nouvelle image = nouvelle transition ; l'heure qui passe n'en rejoue pas", () => {
    expect(componentContentKey({ type: "image", style: {}, mediaId: "a.png" }, track)).toBe("image:a.png");
    expect(componentContentKey({ type: "clock", style: { clockFormat: "date" } }, track)).toBe("clock:date");
  });
});

describe("horloge", () => {
  const d = new Date(2026, 9, 28, 21, 5, 42);
  it("formats en français", () => {
    expect(formatClock(d, "time")).toBe("21:05");
    expect(formatClock(d, "timeSeconds")).toBe("21:05:42");
    expect(formatClock(d, "date")).toMatch(/^Mercredi 28 octobre$/);
    expect(formatClock(d, "dateTime")).toContain("21:05");
  });
});

describe("modèles d'overlays personnalisés", () => {
  it("chaque modèle est un overlay personnalisé valide, composants dans le canvas, identifiants uniques", () => {
    for (const t of CUSTOM_TEMPLATES) {
      const o = t.build();
      expect(o.kind, t.id).toBe("custom");
      const ids = o.components.map((c) => c.id);
      expect(new Set(ids).size, t.id).toBe(ids.length);
      for (const c of o.components) {
        expect(COMPONENT_TYPES, `${t.id}/${c.type}`).toContain(c.type);
        expect(c.transform.width, `${t.id}/${c.name}`).toBeGreaterThan(0);
        // Rien ne dépasse du canvas (OBS le couperait, et l'éditeur afficherait un avertissement).
        expect(c.transform.x, `${t.id}/${c.name}`).toBeGreaterThanOrEqual(0);
        expect(c.transform.y, `${t.id}/${c.name}`).toBeGreaterThanOrEqual(0);
        expect(c.transform.x + c.transform.width, `${t.id}/${c.name}`).toBeLessThanOrEqual(o.theme.canvasWidth);
        expect(c.transform.y + c.transform.height, `${t.id}/${c.name}`).toBeLessThanOrEqual(o.theme.canvasHeight);
      }
      // Export puis import : le modèle reste valide et reste « personnalisé ».
      const r = parseOverlayImport(JSON.stringify({ ...o, name: t.label }), [], () => "x");
      expect(r.ok, t.id).toBe(true);
      if (r.ok) expect(r.overlay.kind).toBe("custom");
    }
  });
  it("deux constructions donnent des identifiants différents ; modèle inconnu → toile vide", () => {
    const a = getCustomTemplate("starting").build().components.map((c) => c.id);
    const b = getCustomTemplate("starting").build().components.map((c) => c.id);
    expect(a.some((id, i) => id !== b[i])).toBe(true);
    expect(getCustomTemplate("nope" as never).id).toBe("blank");
  });
  it("l'écran vertical garde le texte hors du tiers bas (interface de TikTok)", () => {
    const v = getCustomTemplate("vertical").build();
    for (const c of v.components) expect(c.transform.y + c.transform.height, c.name).toBeLessThan(1920 * 0.66);
  });
  it("import : une image invalide est refusée", () => {
    const bad = { theme: { canvasWidth: 500, canvasHeight: 500 }, components: [{ id: "a", type: "image", transform: { x: 0, y: 0, width: 10, height: 10 }, style: {}, mediaId: "../../secret.txt" }] };
    expect(parseOverlayImport(JSON.stringify(bad), [], () => "x").ok).toBe(false);
  });
});

describe("compte à rebours et objectif", async () => {
  const { formatCountdown, goalProgress } = await import("@/utils/overlay-model");
  it("compte à rebours lisible, jamais négatif", () => {
    expect(formatCountdown(299_001)).toBe("05:00");
    expect(formatCountdown(59_000)).toBe("00:59");
    expect(formatCountdown(3_723_000)).toBe("1:02:03");
    expect(formatCountdown(-5)).toBe("00:00");
  });
  it("avancement borné entre 0 et 1", () => {
    expect(goalProgress(5, 20)).toBe(0.25);
    expect(goalProgress(40, 20)).toBe(1);
    expect(goalProgress(3, 0)).toBe(0);
    expect(goalProgress(3, undefined)).toBe(0);
  });
});

describe("variables du live dans les textes", async () => {
  const { renderTemplate } = await import("@/utils/overlay-style");
  const { liveTemplateVars, liveStatsFrom, updateLastNames, normalizeLiveStats, emptyCounters, countAlert, SAMPLE_LIVE_STATS } = await import("../electron/shared/live");
  const music = { title: "Starboy", artist: "The Weeknd", album: "", source: "" };
  it("remplace musique et live ; une variable inconnue reste telle quelle", () => {
    const live = liveTemplateVars(SAMPLE_LIVE_STATS);
    expect(renderTemplate("{title} · {lastFollower} · {followers} · {inconnu}", music, live)).toBe("Starboy · Nyx_Live · 12 · {inconnu}");
    expect(renderTemplate("{lastFollower}", music)).toBe("{lastFollower}");
  });
  it("derniers spectateurs : vrais événements seulement ; totaux Twitch + TikTok", () => {
    let last = { lastFollower: "", lastSub: "", lastGift: "" };
    last = updateLastNames(last, { kind: "follow", source: "tiktok", user: "Lina" });
    last = updateLastNames(last, { kind: "resub", source: "twitch", user: "Kaya" });
    last = updateLastNames(last, { kind: "tiktokGift", source: "tiktok", user: "Rémi", amount: 5, gift: "Rose" });
    expect(updateLastNames(last, { kind: "follow", source: "test", user: "Test" })).toBe(last);
    expect(last).toEqual({ lastFollower: "Lina", lastSub: "Kaya", lastGift: "Rémi (5 × Rose)" });
    let c = emptyCounters(0);
    c = countAlert(c, { kind: "follow", source: "tiktok" });
    c = countAlert(c, { kind: "follow", source: "twitch" });
    c = countAlert(c, { kind: "gift", source: "twitch", amount: 2 });
    expect(liveStatsFrom(c, last)).toMatchObject({ followers: 2, gifts: 2, subs: 0, lastFollower: "Lina" });
  });
  it("statistiques reçues par la page OBS : revalidées", () => {
    expect(normalizeLiveStats({ followers: -3, subs: "9", gifts: 2.7, lastFollower: "x".repeat(200), evil: 1 })).toEqual({
      followers: 0, subs: 0, gifts: 2, messages: 0, lastFollower: "x".repeat(80), lastSub: "", lastGift: "",
    });
    expect(normalizeLiveStats(null).followers).toBe(0);
  });
  it("un nouveau « dernier follower » rejoue la transition du texte qui l'affiche", () => {
    const comp = { type: "text" as const, style: {}, content: "Dernier : {lastFollower}" };
    expect(componentContentKey(comp, track, { lastFollower: "A" })).not.toBe(componentContentKey(comp, track, { lastFollower: "B" }));
  });
});

describe("Mes images", async () => {
  const { AlertMediaStore } = await import("../electron/services/alerts/alert-media-store");
  const { mkdtempSync, writeFileSync, utimesSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const png = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, n]);
  it("liste les images importées, plus récentes d'abord, sans les sons ni les fichiers étrangers", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "batlay-media-"));
    const store = new AlertMediaStore(dir);
    const a = store.save(png(1), "image");
    const b = store.save(png(2), "image");
    if (!a.ok || !b.ok) throw new Error("import");
    utimesSync(path.join(dir, a.id), new Date(1000), new Date(1000));
    writeFileSync(path.join(dir, "notes.txt"), "x");
    writeFileSync(path.join(dir, "0123456789abcdef01234567.mp3"), "x");
    expect(store.list("image")).toEqual([b.id, a.id]);
    expect(store.list("image", 1)).toEqual([b.id]);
    expect(new AlertMediaStore(path.join(dir, "absent")).list("image")).toEqual([]);
  });
});
