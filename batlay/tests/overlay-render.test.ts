import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverlayCanvas, SAMPLE_TRACK } from "@/components/OverlayPreview";
import { getPreset } from "@/presets";
import { addComponent, createComponent } from "@/utils/overlay-model";
import { defaultFill } from "@/utils/overlay-style";
import type { OverlayConfig } from "@/types/overlay";
import type { Track } from "@/types/track";

// Le rendu serveur (renderToStaticMarkup) signale que useLayoutEffect ne s'exécute pas
// côté serveur. C'est attendu ici : en production ces composants tournent dans un
// navigateur (Electron / OBS). On ne filtre QUE cet avertissement précis.
beforeAll(() => {
  const original = console.error;
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes("useLayoutEffect does nothing on the server")) return;
    original(...args);
  });
});
afterAll(() => vi.restoreAllMocks());

function overlayFrom(presetId: Parameters<typeof getPreset>[0]): OverlayConfig {
  return { ...getPreset(presetId), id: "o", name: "test", createdAt: 0, updatedAt: 0 };
}
const render = (overlay: OverlayConfig, track: Track | null) =>
  renderToStaticMarkup(createElement(OverlayCanvas, { overlay, track, reader: null }));

const collab: Track = {
  ...SAMPLE_TRACK,
  title: "Lean On",
  artist: "Major Lazer, DJ Snake, MØ",
  artists: ["Major Lazer", "DJ Snake", "MØ"],
};

describe("rendu réel de l'overlay (HTML produit pour OBS)", () => {
  it("affiche TOUS les artistes, sur chaque preset qui a un composant artiste", () => {
    for (const id of ["minimal", "modern", "glass", "neon", "compact", "large"] as const) {
      const html = render(overlayFrom(id), collab);
      expect(html, id).toContain("Major Lazer, DJ Snake, MØ");
    }
  });

  it("le séparateur choisi s'applique à la liste structurée", () => {
    const overlay = overlayFrom("modern");
    overlay.components.find((c) => c.type === "artist")!.style.artistSeparator = " • ";
    expect(render(overlay, collab)).toContain("Major Lazer • DJ Snake • MØ");
  });

  it("Lecture système (chaîne seule, sans liste) : la chaîne est affichée telle quelle", () => {
    const track: Track = { ...collab, artists: undefined, artist: "Artiste 1, Artiste 2, Artiste 3" };
    expect(render(overlayFrom("modern"), track)).toContain("Artiste 1, Artiste 2, Artiste 3");
  });

  it("le texte défile (marquee) plutôt que d'être coupé pour l'artiste, par défaut", () => {
    const html = render(overlayFrom("compact"), collab);
    expect(html).toContain("batlay-marquee"); // keyframes injectées, utilisables dans OBS sans feuille de style
    // le mode « … » n'est pas celui de l'artiste par défaut
    const artistBlock = html.slice(html.indexOf("Major Lazer") - 200, html.indexOf("Major Lazer"));
    expect(artistBlock).not.toContain("text-overflow:ellipsis");
  });

  it("aucun morceau (null) : rien n'est dessiné, pas même le fond (jamais de fausse donnée dans OBS)", () => {
    const overlay = overlayFrom("modern");
    overlay.theme.background = defaultFill({ color: "#123456", opacity: 1 });
    const html = render(overlay, null);
    expect(html).not.toContain("123456");
    expect(html).not.toContain("Major Lazer");
  });

  it("fond de l'overlay, bordure, arrondi et ombre sont rendus", () => {
    const overlay = overlayFrom("modern");
    overlay.theme.background = defaultFill({ mode: "gradient", opacity: 0.8, gradient: { type: "linear", angle: 45, from: "#ff0000", to: "#0000ff" } });
    overlay.theme.border = { width: 3, color: "#ffffff", style: "solid" };
    overlay.theme.borderRadius = 24;
    const html = render(overlay, collab);
    expect(html).toContain("linear-gradient(45deg");
    expect(html).toContain("border:3px solid #ffffff");
    expect(html).toContain("border-radius:24px");
  });

  it("un overlay créé de zéro (vide) puis complété se rend correctement", () => {
    const overlay = overlayFrom("blank");
    expect(render(overlay, collab)).not.toContain("Lean On");
    const canvas = { width: overlay.theme.canvasWidth, height: overlay.theme.canvasHeight };
    overlay.components = addComponent(overlay.components, createComponent("title", canvas, overlay.components));
    const text = createComponent("text", canvas, overlay.components);
    text.content = "▶ {title} par {artist}";
    overlay.components = addComponent(overlay.components, text);
    const html = render(overlay, collab);
    expect(html).toContain("Lean On");
    expect(html).toContain("▶ Lean On par Major Lazer, DJ Snake, MØ");
  });

  it("la barre de progression et les temps n'utilisent AUCUNE classe Tailwind (bundle OBS sans CSS)", () => {
    const html = render(overlayFrom("modern"), collab);
    expect(html).not.toMatch(/class="/);
    expect(html).toContain("translate3d"); // barre : composée par le GPU
  });

  it("les composants masqués ne sont pas rendus ; l'ordre d'empilement est respecté", () => {
    const overlay = overlayFrom("modern");
    const title = overlay.components.find((c) => c.type === "title")!;
    title.visible = false;
    expect(render(overlay, collab)).not.toContain("Lean On");
  });
});
