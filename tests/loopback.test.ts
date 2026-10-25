import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOSTS_FILE_LINE, LOCAL_ALIAS_HOSTNAME, isAllowedLoopbackHost, isAllowedLoopbackOrigin, isLoopbackHttpUrl } from "../electron/shared/loopback";
import { checkLocalAlias } from "../electron/services/local-alias";

const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8");

describe("Host autorisés (anti DNS-rebinding)", () => {
  it("localhost et 127.0.0.1, sur le bon port uniquement", () => {
    expect(isAllowedLoopbackHost("localhost:3000", 3000)).toBe(true);
    expect(isAllowedLoopbackHost("127.0.0.1:3000", 3000)).toBe(true);
    expect(isAllowedLoopbackHost("LOCALHOST:3000", 3000)).toBe(true);
    expect(isAllowedLoopbackHost("localhost:3001", 3000)).toBe(false);
    expect(isAllowedLoopbackHost("localhost", 3000)).toBe(false);
    expect(isAllowedLoopbackHost("evil.example:3000", 3000)).toBe(false);
    expect(isAllowedLoopbackHost("localhost.evil.example:3000", 3000)).toBe(false);
    expect(isAllowedLoopbackHost("0.0.0.0:3000", 3000)).toBe(false);
    expect(isAllowedLoopbackHost("[::1]:3000", 3000)).toBe(false); // le serveur n'écoute pas en IPv6
    expect(isAllowedLoopbackHost(undefined, 3000)).toBe(false);
  });
  it("nom local batlay.test (TikTok LIVE Studio) accepté ; aucun autre nom, aucun sous-domaine", () => {
    expect(isAllowedLoopbackHost("batlay.test:3000", 3000)).toBe(true);
    expect(isAllowedLoopbackHost("BATLAY.TEST:4000", 4000)).toBe(true);
    expect(isAllowedLoopbackHost("batlay.test:3000", 4000)).toBe(false);
    for (const host of ["batlay.test", "x.batlay.test:3000", "batlay.test.evil.example:3000", "autre.test:3000", "batlay.local:3000"]) {
      expect(isAllowedLoopbackHost(host, 3000), host).toBe(false);
    }
    expect(isAllowedLoopbackOrigin("http://batlay.test:3000", 3000)).toBe(true);
    expect(isAllowedLoopbackOrigin("https://batlay.test:3000", 3000)).toBe(false);
    expect(HOSTS_FILE_LINE).toBe("127.0.0.1 batlay.test");
    // .test est réservé (RFC 6761) : jamais un vrai domaine public.
    expect(LOCAL_ALIAS_HOSTNAME.endsWith(".test")).toBe(true);
  });
});

describe("Origin autorisées (WebSocket)", () => {
  it("la page servie par ce serveur ; absence d'Origin tolérée sauf si exigée", () => {
    expect(isAllowedLoopbackOrigin("http://localhost:3000", 3000)).toBe(true);
    expect(isAllowedLoopbackOrigin("http://127.0.0.1:3000", 3000)).toBe(true);
    expect(isAllowedLoopbackOrigin(undefined, 3000)).toBe(true);
    expect(isAllowedLoopbackOrigin(undefined, 3000, true)).toBe(false);
  });
  it("refuse les autres origines, y compris l'autre serveur de Batlay et « null »", () => {
    for (const origin of ["https://evil.example", "http://localhost:4000", "https://localhost:3000", "null", "file://", "http://localhost:3000.evil.example"]) {
      expect(isAllowedLoopbackOrigin(origin, 3000), origin).toBe(false);
    }
  });
});

describe("URL locales", () => {
  it("http + localhost/127.0.0.1 + port explicite, sans identifiants", () => {
    expect(isLoopbackHttpUrl("http://localhost:3000/overlay/a")).toBe(true);
    expect(isLoopbackHttpUrl("http://127.0.0.1:4000/overlay/chat?size=30")).toBe(true);
    expect(isLoopbackHttpUrl("https://localhost:3000/overlay/a")).toBe(false);
    expect(isLoopbackHttpUrl("http://localhost/overlay/a")).toBe(false);
    expect(isLoopbackHttpUrl("http://a:b@localhost:3000/")).toBe(false);
    expect(isLoopbackHttpUrl("http://10.0.0.2:3000/")).toBe(false);
    expect(isLoopbackHttpUrl("::")).toBe(false);
  });
});

describe("vérification de batlay.test (fichier hosts, lecture seule)", () => {
  const err = (code: string) => Object.assign(new Error(code), { code });
  it("pointe vers 127.0.0.1 → ok", async () => {
    expect(await checkLocalAlias(async () => [{ address: "127.0.0.1", family: 4 }])).toEqual({ state: "ok", hostname: "batlay.test" });
    expect((await checkLocalAlias(async () => [{ address: "::1", family: 6 }, { address: "127.0.0.1", family: 4 }])).state).toBe("ok");
  });
  it("absent du fichier hosts → missing", async () => {
    for (const code of ["ENOTFOUND", "EAI_NONAME", "ENODATA"]) {
      expect((await checkLocalAlias(async () => { throw err(code); })).state, code).toBe("missing");
    }
  });
  it("mauvaise adresse (::1 seul, ou autre machine) → signalée", async () => {
    expect(await checkLocalAlias(async () => [{ address: "::1", family: 6 }])).toEqual({ state: "wrong-address", hostname: "batlay.test", addresses: ["::1"] });
    expect((await checkLocalAlias(async () => [{ address: "192.168.1.20", family: 4 }])).state).toBe("wrong-address");
  });
  it("résolveur bloqué : délai borné, jamais d'attente infinie", async () => {
    const r = await checkLocalAlias(() => new Promise(() => undefined), 50);
    expect(r).toMatchObject({ state: "error" });
  });
  it("la vérification ne fait que lire ; seul hosts-alias.ts écrit (scripts fixes, après autorisation Windows)", () => {
    for (const f of ["electron/services/local-alias.ts", "electron/main/index.ts"]) {
      expect(read(f), f).not.toMatch(/writeFile|appendFile|AppendAllText|WriteAllLines|drivers[\\/]etc/);
    }
  });
});

describe("garde-fous de sécurité dans le code (non-régression)", () => {
  it("les serveurs n'écoutent que sur 127.0.0.1, jamais sur 0.0.0.0 ni sur toutes les interfaces", () => {
    for (const f of ["electron/services/overlay-server.ts", "electron/services/twitch/twitch-server.ts"]) {
      const src = read(f);
      expect(src, f).toMatch(/\.listen\(this\.port, "127\.0\.0\.1"/);
      expect(src, f).not.toMatch(/0\.0\.0\.0|"::"/);
    }
  });
  it("le serveur d'overlay musical contrôle Host et Origin", () => {
    const src = read("electron/services/overlay-server.ts");
    expect(src).toMatch(/isAllowedLoopbackHost\(req\.headers\.host, this\.port\)/);
    expect(src).toMatch(/isAllowedLoopbackOrigin\(req\.headers\.origin, this\.port\)/);
  });
  it("shell.openExternal n'est appelé qu'avec des adresses choisies par le process principal", () => {
    const main = read("electron/main/index.ts");
    const calls = main.match(/shell\.openExternal\([^;]*;/g) ?? [];
    expect(calls).toEqual(["shell.openExternal(releasesUrl());", "shell.openExternal(url);"]);
    expect(main).toMatch(/const url = resolvePlatformDocsUrl\(platformId\);\s*if \(!url\) return false;/);
  });
  it("Electron : aucune protection désactivée", () => {
    const main = read("electron/main/index.ts");
    expect(main).toMatch(/contextIsolation: true/);
    expect(main).toMatch(/nodeIntegration: false/);
    expect(main).toMatch(/sandbox: true/);
    expect(main).not.toMatch(/webSecurity: false|allowRunningInsecureContent/);
  });
  it("aucune page d'overlay ne reçoit de jeton Twitch ou Spotify", () => {
    for (const f of ["overlay/OverlayApp.tsx", "twitch-overlay/TwitchChatOverlay.tsx", "src/integrations/urls.ts", "src/pages/Integrations.tsx"]) {
      expect(read(f), f).not.toMatch(/access_?token|refresh_?token|safeStorage|spotify\./i);
    }
  });
});
