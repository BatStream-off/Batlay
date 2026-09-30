import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderCallbackPage, callbackPageCsp } from "../electron/services/twitch/twitch-pages";

const ROOT = process.cwd();
const walk = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((name) => {
    const rel = join(dir, name);
    return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : [rel];
  });
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

describe("aucun secret dans le dépôt", () => {
  const files = [...walk("src"), ...walk("electron"), ...walk("twitch-overlay"), ...walk("overlay"), "package.json", "index.html", "twitch-overlay.html", "overlay.html"];
  it("aucun identifiant « client_secret » / clientSecret dans le code, le frontend ou la config", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/client[_-]?secret/i);
  });
  it("aucune variable d'environnement de secret lue par l'app", () => {
    for (const f of files) expect(read(f), f).not.toMatch(/process\.env\.\w*(SECRET|TWITCH)/i);
  });
  it("le .gitignore exclut les fichiers .env", () => {
    expect(read(".gitignore")).toMatch(/^\.env/m);
  });
});

describe("port Twitch fixe et indépendant", () => {
  it("aucun réglage utilisateur ne porte le port Twitch", () => {
    expect(read("electron/services/config-store.ts")).not.toMatch(/twitch/i);
    expect(read("src/stores/useSettingsStore.ts")).not.toMatch(/twitch/i);
    expect(read("src/pages/Settings.tsx")).not.toMatch(/twitch/i);
  });
  it("le serveur d'overlay musical reste sur 3000 par défaut", () => {
    expect(read("electron/services/config-store.ts")).toContain("overlayServerPort: 3000");
  });
  it("le module Twitch n'importe rien de l'overlay musical, ni de Spotify, ni de la config principale", () => {
    for (const f of [...walk("electron/services/twitch"), ...walk("twitch-overlay"), "src/stores/useTwitchStore.ts", "src/pages/Twitch.tsx"]) {
      expect(read(f), f).not.toMatch(/overlay-server|spotify|config-store|OverlayPreview|useOverlayStore|useMusicStore/);
    }
  });
  it("le renderer ne peut transmettre aucun paramètre sensible via le pont Twitch", () => {
    const preload = read("electron/preload/index.ts");
    const code = preload.slice(preload.indexOf("twitch: {"), preload.indexOf("theme: {"))
      .split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("/**")).join("\n");
    const block = code;
    expect(block).not.toMatch(/token|port|clientId|url:/i);
  });
});

describe("page de callback", () => {
  const html = renderCallbackPage("NONCE123");
  it("CSP stricte à nonce, sans ressource externe", () => {
    const csp = callbackPageCsp("NONCE123");
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'nonce-NONCE123'");
    expect(csp).toContain("connect-src 'self'");
    expect(html).not.toMatch(/https?:\/\//);
    expect((html.match(/nonce="NONCE123"/g) ?? []).length).toBe(2);
  });
  it("retire le jeton de l'URL AVANT d'appeler le serveur, et n'utilise jamais innerHTML", () => {
    expect(html.indexOf("history.replaceState")).toBeGreaterThan(-1);
    expect(html.indexOf("history.replaceState")).toBeLessThan(html.indexOf("fetch('/auth/callback'"));
    expect(html).not.toContain("innerHTML");
  });
});
