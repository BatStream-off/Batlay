import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_THEME_PREFERENCE,
  TAILWIND_TOKEN_NAMES,
  THEME_TOKENS,
  THEME_TOKEN_NAMES,
  WINDOW_BACKGROUND,
  hexToRgbTriplet,
  isThemePreference,
  normalizeThemePreference,
  resolveTheme,
  syncNativeTheme,
  themeCssVariables,
  type NativeThemeLike,
  type ResolvedTheme,
  type ThemePreference,
} from "../electron/shared/theme";
import { applyResolvedTheme, applyThemePreference, initTheme } from "@/theme/apply-theme";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

// ---------------------------------------------------------------------------
// Outils WCAG (locaux aux tests : le code livré n'en a pas besoin)
// ---------------------------------------------------------------------------
const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Couleur `fg` à l'opacité `alpha` posée sur `bg` (ex. bg-amber-500/10 sur une surface). */
function over(fg: string, alpha: number, bg: string): string {
  const [f, b] = [channels(fg), channels(bg)];
  return "#" + f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)).toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Résolution
// ---------------------------------------------------------------------------
describe("préférence de thème", () => {
  it('l\'ancien réglage "dark" reste valide, et "light" / "system" sont acceptés', () => {
    for (const value of ["dark", "light", "system"]) expect(isThemePreference(value)).toBe(true);
    expect(normalizeThemePreference("dark")).toBe("dark");
    expect(normalizeThemePreference("light")).toBe("light");
    expect(normalizeThemePreference("system")).toBe("system");
  });

  it("toute autre valeur (config corrompue) retombe sur le défaut sombre", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("dark");
    for (const junk of [undefined, null, "", "Dark", "auto", 1, true, {}, []]) {
      expect(isThemePreference(junk)).toBe(false);
      expect(normalizeThemePreference(junk)).toBe("dark");
    }
  });

  it("dark et light sont imposés ; system suit Windows", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("syncNativeTheme — résolution « system » avec un nativeTheme simulé", () => {
  /** nativeTheme factice qui se comporte comme le vrai : imposé ou suit l'OS. */
  function createNativeTheme(osDark: boolean) {
    const nt = {
      osDark,
      themeSource: "system" as ThemePreference,
      get shouldUseDarkColors(): boolean {
        return nt.themeSource === "system" ? nt.osDark : nt.themeSource === "dark";
      },
    };
    return nt satisfies NativeThemeLike & { osDark: boolean };
  }

  it("aligne themeSource sur le réglage", () => {
    const nt = createNativeTheme(true);
    for (const pref of ["dark", "light", "system"] as const) {
      syncNativeTheme(nt, pref);
      expect(nt.themeSource).toBe(pref);
    }
  });

  it("system + Windows sombre -> dark ; system + Windows clair -> light", () => {
    expect(syncNativeTheme(createNativeTheme(true), "system")).toBe("dark");
    expect(syncNativeTheme(createNativeTheme(false), "system")).toBe("light");
  });

  it("dark / light ignorent le mode de Windows", () => {
    expect(syncNativeTheme(createNativeTheme(false), "dark")).toBe("dark");
    expect(syncNativeTheme(createNativeTheme(true), "light")).toBe("light");
  });

  it("system suit un changement de Windows en cours de route", () => {
    const nt = createNativeTheme(true);
    expect(syncNativeTheme(nt, "system")).toBe("dark");
    nt.osDark = false; // l'utilisateur passe Windows en mode clair
    expect(nt.shouldUseDarkColors).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------
describe("tokens — source de vérité", () => {
  it("chaque thème définit chaque token, en hexadécimal #RRGGBB", () => {
    for (const theme of ["dark", "light"] as const) {
      for (const name of THEME_TOKEN_NAMES) {
        expect(THEME_TOKENS[theme][name], `${theme}/${name}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
      expect(Object.keys(THEME_TOKENS[theme]).sort()).toEqual([...THEME_TOKEN_NAMES].sort());
    }
  });

  it("DARK = valeurs d'avant le thème clair, à l'identique", () => {
    const d = THEME_TOKENS.dark;
    expect(d["base-950"]).toBe("#0A0A0F");
    expect(d["base-900"]).toBe("#111117");
    expect(d["base-800"]).toBe("#1A1A22");
    expect(d["base-700"]).toBe("#25252F");
    expect(d["base-600"]).toBe("#34343F");
    expect(d.muted).toBe("#8A8A99");
    expect(d.fg).toBe("#FFFFFF"); // text-white
    expect(d.line).toBe("#1A1A22"); // ancien border-base-800
    expect(d.grid).toBe("#1A1A22"); // ancienne grille de l'éditeur
    expect(d.accent).toBe("#B68CFF"); // signal-400
    expect(d.ok).toBe("#37E29A"); // live
    expect(d.danger).toBe("#F87171"); // red-400
    expect(d["danger-soft"]).toBe("#FCA5A5"); // red-300
    expect(d.warn).toBe("#FDE68A"); // amber-200
    expect(d["warn-strong"]).toBe("#FCD34D"); // amber-300
    expect(d["checker-a"]).toBe("#3A3A46");
    expect(d["checker-b"]).toBe("#25252F");
  });

  it("LIGHT = valeurs demandées : app #F6F6F9, cartes #FFF, champs #EEEEF3, bordures #DCDCE4, texte #14141C", () => {
    const l = THEME_TOKENS.light;
    expect(l["base-950"]).toBe("#F6F6F9");
    expect(l["base-900"]).toBe("#FFFFFF");
    expect(l["base-800"]).toBe("#EEEEF3");
    expect(l.line).toBe("#DCDCE4");
    expect(l["base-700"]).toBe("#DCDCE4");
    expect(l.fg).toBe("#14141C");
  });

  it("fond de la fenêtre native = base-950 du thème (pas de flash au démarrage)", () => {
    expect(WINDOW_BACKGROUND.dark).toBe(THEME_TOKENS.dark["base-950"]);
    expect(WINDOW_BACKGROUND.light).toBe(THEME_TOKENS.light["base-950"]);
  });

  it("variables CSS en triplets RGB (compatibles avec /alpha)", () => {
    expect(hexToRgbTriplet("#0A0A0F")).toBe("10 10 15");
    expect(hexToRgbTriplet("#ffffff")).toBe("255 255 255");
    expect(themeCssVariables("dark")["--base-950"]).toBe("10 10 15");
    expect(themeCssVariables("light")["--base-950"]).toBe("246 246 249");
    expect(Object.keys(themeCssVariables("light"))).toHaveLength(THEME_TOKEN_NAMES.length);
    expect(() => hexToRgbTriplet("rouge")).toThrow();
    expect(() => hexToRgbTriplet("#FFF")).toThrow();
  });
});

describe("contraste WCAG AA (≥ 4,5:1) dans les deux thèmes", () => {
  const SURFACES = ["base-950", "base-900", "base-800"] as const;
  const TEXT = ["fg", "muted", "accent", "ok", "danger", "danger-soft", "warn", "warn-strong"] as const;

  for (const theme of ["dark", "light"] as const) {
    describe(theme, () => {
      const tokens = THEME_TOKENS[theme];
      for (const text of TEXT) {
        for (const surface of SURFACES) {
          it(`${text} sur ${surface}`, () => {
            expect(contrast(tokens[text], tokens[surface])).toBeGreaterThanOrEqual(4.5);
          });
        }
      }

      it("texte d'avertissement sur les encarts ambrés (amber-500/10 et /15 sur les surfaces)", () => {
        for (const surface of ["base-950", "base-900"] as const) {
          expect(contrast(tokens.warn, over("#F59E0B", 0.1, tokens[surface]))).toBeGreaterThanOrEqual(4.5);
          expect(contrast(tokens["warn-strong"], over("#F59E0B", 0.15, tokens[surface]))).toBeGreaterThanOrEqual(4.5);
        }
      });

      it("texte d'erreur sur les encarts rouges (red-500/10 sur les surfaces)", () => {
        for (const surface of ["base-950", "base-900"] as const) {
          expect(contrast(tokens["danger-soft"], over("#EF4444", 0.1, tokens[surface]))).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }

  it("clair : muted reste ≥ 4,5:1 même sur base-700 (survols)", () => {
    expect(contrast(THEME_TOKENS.light.muted, THEME_TOKENS.light["base-700"])).toBeGreaterThanOrEqual(4.5);
  });

  it("clair : les indices (faint) restent ≥ 3:1 sur les surfaces", () => {
    for (const surface of SURFACES) {
      expect(contrast(THEME_TOKENS.light.faint, THEME_TOKENS.light[surface])).toBeGreaterThanOrEqual(3);
    }
  });

  it("texte blanc sur les boutons colorés (identiques dans les deux thèmes)", () => {
    expect(contrast("#FFFFFF", "#7C4DFF")).toBeGreaterThanOrEqual(4.5); // bg-signal-600
    expect(contrast("#FFFFFF", "#DC2626")).toBeGreaterThanOrEqual(4.5); // bg-red-600
  });
});

// ---------------------------------------------------------------------------
// Tailwind <-> tokens
// ---------------------------------------------------------------------------
describe("tailwind.config.js reste synchronisé avec les tokens", () => {
  it("chaque token Tailwind pointe vers sa variable CSS, avec le format /alpha", async () => {
    const config = (await import("../tailwind.config.js")).default as {
      theme: { extend: { colors: Record<string, string | Record<string, string>> } };
    };
    const colors = config.theme.extend.colors;
    const expected = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

    for (const name of TAILWIND_TOKEN_NAMES) {
      if (name.startsWith("base-")) {
        const step = name.slice("base-".length);
        expect((colors.base as Record<string, string>)[step], name).toBe(expected(name));
      } else {
        expect(colors[name], name).toBe(expected(name));
      }
    }
  });

  it("aucune couleur de token n'est restée figée en hexadécimal dans la config", async () => {
    const config = (await import("../tailwind.config.js")).default as {
      theme: { extend: { colors: Record<string, string | Record<string, string>> } };
    };
    const colors = config.theme.extend.colors;
    for (const step of Object.values(colors.base as Record<string, string>)) expect(step).toContain("var(--");
    expect(colors.muted).toContain("var(--");
    expect(colors.fg).toContain("var(--");
  });

  it("les accents de marque (boutons) restent indépendants du thème clair/sombre, mais personnalisables via Settings > Apparence ; la scène ne l'est jamais", async () => {
    const config = (await import("../tailwind.config.js")).default as {
      theme: { extend: { colors: Record<string, unknown> } };
    };
    const colors = config.theme.extend.colors as Record<string, any>;
    const expected = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
    expect(colors.signal).toEqual({
      400: expected("signal-400"),
      500: expected("signal-500"),
      600: expected("signal-600"),
    });
    expect(colors.live).toBe("#37E29A");
    expect(colors.stage).toBe("#0A0A0F");
  });

  it("les tokens « CSS seulement » sont bien consommés (grille, damier, barre de défilement)", () => {
    expect(read("src", "pages", "Editor.tsx")).toContain("rgb(var(--grid))");
    expect(read("src", "components", "editor", "StyleEditors.tsx")).toContain("var(--checker-a)");
    expect(read("src", "components", "editor", "StyleEditors.tsx")).toContain("var(--checker-b)");
    expect(read("src", "styles", "globals.css")).toContain("var(--scrollbar)");
  });
});

// ---------------------------------------------------------------------------
// Application sur <html>
// ---------------------------------------------------------------------------
function createFakeRoot() {
  const classes = new Set<string>(["dark"]);
  const props = new Map<string, string>();
  return {
    classes,
    props,
    dataset: {} as Record<string, string | undefined>,
    classList: { add: (t: string) => void classes.add(t), remove: (t: string) => void classes.delete(t) },
    style: { setProperty: (name: string, value: string) => void props.set(name, value) },
  };
}

describe("applyResolvedTheme — <html>", () => {
  it("light : variables, color-scheme, data-theme, classe dark retirée", () => {
    const root = createFakeRoot();
    applyResolvedTheme(root, "light");
    expect(root.dataset.theme).toBe("light");
    expect(root.props.get("color-scheme")).toBe("light");
    expect(root.props.get("--base-950")).toBe("246 246 249");
    expect(root.props.get("--fg")).toBe("20 20 28");
    expect(root.classes.has("dark")).toBe(false);
  });

  it("dark : variables historiques, classe dark posée", () => {
    const root = createFakeRoot();
    root.classes.clear();
    applyResolvedTheme(root, "dark");
    expect(root.dataset.theme).toBe("dark");
    expect(root.props.get("color-scheme")).toBe("dark");
    expect(root.props.get("--base-950")).toBe("10 10 15");
    expect(root.classes.has("dark")).toBe(true);
  });

  it("pose TOUS les tokens, aucun n'est oublié en passant d'un thème à l'autre", () => {
    const root = createFakeRoot();
    applyResolvedTheme(root, "light");
    applyResolvedTheme(root, "dark");
    for (const name of THEME_TOKEN_NAMES) expect(root.props.has(`--${name}`), name).toBe(true);
    expect(root.props.get("--base-900")).toBe("17 17 23");
  });

  it("applyThemePreference : system suit le mode de Windows fourni", () => {
    const root = createFakeRoot();
    expect(applyThemePreference(root, "system", false)).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(applyThemePreference(root, "system", true)).toBe("dark");
    expect(root.dataset.theme).toBe("dark");
  });

  it("applyThemePreference : une préférence invalide retombe sur dark", () => {
    const root = createFakeRoot();
    expect(applyThemePreference(root, "n'importe quoi" as ThemePreference, false)).toBe("dark");
  });
});

describe("initTheme — avant le premier rendu, sans flash", () => {
  const noopUnsub = () => {};

  it("applique le thème résolu fourni SYNCHRONEMENT par le process principal", () => {
    const root = createFakeRoot();
    const bridge = { getInitial: vi.fn(() => ({ preference: "system" as const, resolved: "light" as const })), onChange: vi.fn(() => noopUnsub) };
    expect(initTheme(root, bridge)).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.props.get("--base-950")).toBe("246 246 249");
  });

  it("réagit ensuite aux changements poussés par le process principal (Windows bascule)", () => {
    const root = createFakeRoot();
    let push: (p: { preference: ThemePreference; resolved: ResolvedTheme }) => void = () => {};
    const bridge = {
      getInitial: () => ({ preference: "system" as const, resolved: "dark" as const }),
      onChange: vi.fn((cb: typeof push) => {
        push = cb;
        return noopUnsub;
      }),
    };
    initTheme(root, bridge);
    expect(root.dataset.theme).toBe("dark");
    push({ preference: "system", resolved: "light" });
    expect(root.dataset.theme).toBe("light");
    expect(root.props.get("--base-950")).toBe("246 246 249");
    push({ preference: "system", resolved: "dark" });
    expect(root.dataset.theme).toBe("dark");
  });

  it("sans pont (hors Electron) ou pont défaillant : thème sombre historique, sans exception", () => {
    const a = createFakeRoot();
    expect(initTheme(a, undefined)).toBe("dark");
    expect(a.dataset.theme).toBe("dark");

    const b = createFakeRoot();
    const broken = {
      getInitial: () => {
        throw new Error("ipc indisponible");
      },
      onChange: () => noopUnsub,
    };
    expect(initTheme(b, broken)).toBe("dark");
  });

  it("réponse invalide du process principal : thème sombre", () => {
    const root = createFakeRoot();
    const bridge = { getInitial: () => ({ preference: "system", resolved: "sepia" }) as never, onChange: () => noopUnsub };
    expect(initTheme(root, bridge)).toBe("dark");
  });

  it("main.tsx appelle initTheme() AVANT ReactDOM.createRoot", () => {
    const main = read("src", "main.tsx");
    expect(main.indexOf("initTheme();")).toBeGreaterThanOrEqual(0);
    expect(main.indexOf("initTheme();")).toBeLessThan(main.indexOf("ReactDOM.createRoot"));
  });
});

// ---------------------------------------------------------------------------
// Settings -> <html> + persistance
// ---------------------------------------------------------------------------
describe("Settings > Appearance -> <html> et persistance", () => {
  let root: ReturnType<typeof createFakeRoot>;
  let setSettings: ReturnType<typeof vi.fn>;
  let stored: Record<string, unknown>;

  beforeEach(() => {
    root = createFakeRoot();
    stored = { launchOnStartup: false, startMinimized: false, theme: "dark", language: "fr", overlayServerPort: 3000, preferredSystemMediaAppId: null };
    setSettings = vi.fn(async (patch: Record<string, unknown>) => {
      stored = { ...stored, ...patch };
      return stored;
    });
    vi.stubGlobal("document", { documentElement: root });
    vi.stubGlobal("window", { batlay: { config: { setSettings } } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("choisir Light : persiste via config:set-settings ET bascule <html> immédiatement", async () => {
    const { useSettingsStore } = await import("@/stores/useSettingsStore");
    await useSettingsStore.getState().update({ theme: "light" });
    expect(setSettings).toHaveBeenCalledWith({ theme: "light" });
    expect(useSettingsStore.getState().settings?.theme).toBe("light");
    expect(root.dataset.theme).toBe("light");
    expect(root.props.get("--base-950")).toBe("246 246 249");
    expect(root.classes.has("dark")).toBe(false);
  });

  it("choisir Dark ramène les valeurs historiques", async () => {
    const { useSettingsStore } = await import("@/stores/useSettingsStore");
    await useSettingsStore.getState().update({ theme: "light" });
    await useSettingsStore.getState().update({ theme: "dark" });
    expect(setSettings).toHaveBeenLastCalledWith({ theme: "dark" });
    expect(root.dataset.theme).toBe("dark");
    expect(root.props.get("--base-950")).toBe("10 10 15");
  });

  it("choisir System : persiste « system » et suit le mode de Windows (matchMedia)", async () => {
    const { useSettingsStore } = await import("@/stores/useSettingsStore");
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    await useSettingsStore.getState().update({ theme: "system" });
    expect(setSettings).toHaveBeenCalledWith({ theme: "system" });
    expect(stored.theme).toBe("system");
    expect(root.dataset.theme).toBe("light");

    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    await useSettingsStore.getState().update({ theme: "system" });
    expect(root.dataset.theme).toBe("dark");
  });

  it("modifier un AUTRE réglage ne touche pas au thème affiché", async () => {
    const { useSettingsStore } = await import("@/stores/useSettingsStore");
    await useSettingsStore.getState().update({ theme: "light" });
    const before = root.dataset.theme;
    await useSettingsStore.getState().update({ startMinimized: true });
    expect(root.dataset.theme).toBe(before);
    expect(setSettings).toHaveBeenLastCalledWith({ startMinimized: true });
  });

  it("la page Settings propose Sombre / Clair / Système et passe par update({ theme })", () => {
    const page = read("src", "pages", "Settings.tsx");
    expect(page).toContain("Apparence");
    for (const label of ['"Sombre"', '"Clair"', '"Système"']) expect(page).toContain(label);
    expect(page).toMatch(/update\(\{\s*theme:\s*option\.value\s*\}\)/);
  });
});

// ---------------------------------------------------------------------------
// Ce qui NE doit PAS être thématisé + migration des classes
// ---------------------------------------------------------------------------
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("périmètre du thème", () => {
  const NOT_THEMED = [
    ...walk(join(process.cwd(), "overlay")),
    join(process.cwd(), "overlay.html"),
    join(process.cwd(), "src", "components", "OverlayPreview.tsx"),
    join(process.cwd(), "src", "components", "LiveProgress.tsx"),
    join(process.cwd(), "src", "components", "editor", "EditorCanvas.tsx"),
  ];

  it("OBS (overlay/, overlay.html), OverlayPreview et les fonds d'aperçu de l'éditeur n'utilisent aucun token de thème", () => {
    for (const file of NOT_THEMED) {
      const source = readFileSync(file, "utf8");
      // Variables de TOKENS de thème uniquement : OverlayPreview a ses propres variables (--batlay-marquee-distance).
      expect(source, file).not.toMatch(new RegExp(`var\\(--(?:${THEME_TOKEN_NAMES.join("|")})\\)`));
      expect(source, file).not.toMatch(/\b(?:bg|text|border)-(?:base-\d+|fg|muted|faint|line|accent|ok|danger|warn)\b/);
    }
  });

  it("les fonds d'aperçu de l'éditeur restent des couleurs fixes", () => {
    const canvas = read("src", "components", "editor", "EditorCanvas.tsx");
    for (const fixed of ["#2a2a34", "#0b0b10", "#e9e9ee", "#14a04a"]) expect(canvas).toContain(fixed);
  });

  it("les miniatures d'overlay posent sur un fond de scène fixe, pas sur le fond de l'interface", () => {
    const overlays = read("src", "pages", "Overlays.tsx");
    expect(overlays).not.toContain("bg-base-950");
    expect(overlays.match(/bg-stage/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("la page overlay d'OBS ne charge aucune feuille de style de l'interface", () => {
    expect(read("overlay.html")).not.toMatch(/<link[^>]+stylesheet/i);
    expect(read("overlay", "main.tsx")).not.toMatch(/\.css["']/);
  });
});

describe("migration des classes de l'interface", () => {
  const THEMED = [
    ...walk(join(process.cwd(), "src", "pages")),
    join(process.cwd(), "src", "components", "ToastHost.tsx"),
    join(process.cwd(), "src", "layouts", "Sidebar.tsx"),
    ...walk(join(process.cwd(), "src", "components", "editor")).filter((f) => !f.endsWith("EditorCanvas.tsx")),
  ];

  it("text-white ne subsiste que sur des fonds colorés pleins (signal-600 / red-600)", () => {
    const offenders: string[] = [];
    for (const file of THEMED) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (/(?<![:\w-])text-white\b/.test(line) && !/bg-(?:signal-600|red-600)(?![/\d-])/.test(line)) {
            offenders.push(`${file}:${i + 1}: ${line.trim()}`);
          }
        });
    }
    expect(offenders).toEqual([]);
  });

  it("plus de hover:text-white, ni de border-base-800 / text-base-600 / couleurs de statut figées dans l'UI thématisée", () => {
    for (const file of THEMED) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("hover:text-white");
      expect(source, file).not.toContain("border-base-800");
      expect(source, file).not.toMatch(/(?<![:\w-])text-base-600\b/);
      expect(source, file).not.toMatch(/(?<![:\w-])text-(?:red-[34]00|amber-[23]00|signal-400)\b/);
    }
  });

  it("le corps de la page utilise text-fg (et non plus text-white)", () => {
    const html = read("index.html");
    expect(html).toContain("text-fg");
    expect(html).not.toContain("text-white");
    expect(html).toContain('name="color-scheme"');
  });
});
