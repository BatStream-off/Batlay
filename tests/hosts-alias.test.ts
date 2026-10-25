import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADD_SCRIPT, HOSTS_ENTRY, REMOVE_SCRIPT, addHostsAlias, elevatedArgs, encodeCommand, removeHostsAlias } from "../electron/services/hosts-alias";
import type { AliasStatus } from "../electron/services/local-alias";

const ok: AliasStatus = { state: "ok", hostname: "batlay.test" };
const missing: AliasStatus = { state: "missing", hostname: "batlay.test" };

/** Faux système : un résolveur qui change d'état si le script « réussit », un lanceur qui renvoie un code. */
function fakeSystem(initial: AliasStatus, { code, effective }: { code: number; effective: boolean }) {
  let status = initial;
  const calls: string[][] = [];
  return {
    calls,
    deps: {
      platform: "win32" as const,
      check: async () => status,
      run: async (_file: string, args: string[]) => {
        calls.push(args);
        if (effective) status = status.state === "ok" ? missing : ok;
        return { code };
      },
    },
  };
}

describe("fichier hosts : contenu des scripts (constantes, aucune donnée extérieure)", () => {
  it("n'écrit que 127.0.0.1 batlay.test, en ASCII", () => {
    expect(HOSTS_ENTRY.startsWith("127.0.0.1 batlay.test #")).toBe(true);
    expect(/^[\x20-\x7e]+$/.test(HOSTS_ENTRY)).toBe(true);
    expect(ADD_SCRIPT).toContain(`'${HOSTS_ENTRY}'`);
    expect(ADD_SCRIPT).toContain("[Text.Encoding]::ASCII");
    // Ajout seulement si absent : aucun doublon.
    expect(ADD_SCRIPT).toMatch(/-notmatch '\(\?m\)\^\\s\*127\\\.0\\\.0\\\.1\\s\+batlay\\\.test\(\\s\|\$\)'/);
  });
  it("le retrait ne supprime que cette ligne", () => {
    expect(REMOVE_SCRIPT).toContain("Where-Object { $_ -notmatch '^\\s*127\\.0\\.0\\.1\\s+batlay\\.test(\\s|$)' }");
    expect(REMOVE_SCRIPT).not.toMatch(/Remove-Item|Clear-Content|Set-Content/);
  });
  it("les deux scripts ne visent que le fichier hosts de Windows", () => {
    for (const s of [ADD_SCRIPT, REMOVE_SCRIPT]) {
      expect(s).toContain("Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'");
      expect(s.match(/\[IO\.File\]::\w+\(/g)?.every((m) => /ReadAllText|ReadAllLines|AppendAllText|WriteAllLines/.test(m))).toBe(true);
    }
  });
  it("élévation : commande encodée (UTF-16LE + Base64), sans aucun guillemet injectable", () => {
    const args = elevatedArgs(ADD_SCRIPT);
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    expect(args[3]).toContain("Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru");
    const encoded = args[3].match(/'-EncodedCommand','([^']+)'/)![1];
    expect(encoded).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(Buffer.from(encoded, "base64").toString("utf16le")).toBe(ADD_SCRIPT);
    expect(encodeCommand("é")).toBe(Buffer.from("é", "utf16le").toString("base64"));
  });
  it("aucun autre module n'écrit le fichier hosts", () => {
    const main = readFileSync(join(process.cwd(), "electron/main/index.ts"), "utf8");
    // Le process principal n'appelle que addHostsAlias / removeHostsAlias, sans aucun paramètre venant du renderer.
    expect(main).toMatch(/ipcMain\.handle\("integrations:setup-local-alias", \(\) => runAliasChange\("add"\)\)/);
    expect(main).toMatch(/ipcMain\.handle\("integrations:remove-local-alias", \(\) => runAliasChange\("remove"\)\)/);
  });
});

describe("fichier hosts : déroulé de l'ajout et du retrait", () => {
  it("ajout réussi après autorisation", async () => {
    const sys = fakeSystem(missing, { code: 0, effective: true });
    const r = await addHostsAlias(sys.deps);
    expect(r.result).toBe("done");
    expect(r.status.state).toBe("ok");
    expect(sys.calls).toHaveLength(1);
  });
  it("déjà configuré : aucune demande d'autorisation", async () => {
    const sys = fakeSystem(ok, { code: 0, effective: true });
    expect((await addHostsAlias(sys.deps)).result).toBe("already");
    expect(sys.calls).toHaveLength(0);
  });
  it("autorisation refusée dans la fenêtre de Windows : rien de modifié", async () => {
    const sys = fakeSystem(missing, { code: 1, effective: false });
    const r = await addHostsAlias(sys.deps);
    expect(r).toMatchObject({ result: "cancelled", status: { state: "missing" } });
  });
  it("écriture refusée (antivirus, fichier verrouillé) : message explicite", async () => {
    const sys = fakeSystem(missing, { code: 2, effective: false });
    const r = await addHostsAlias(sys.deps);
    expect(r.result).toBe("failed");
    expect(r.result === "failed" && r.message).toMatch(/antivirus|verrouillé/);
  });
  it("le résultat est jugé sur l'état réel, pas sur le code de sortie", async () => {
    const sys = fakeSystem(missing, { code: 0, effective: false });
    expect((await addHostsAlias(sys.deps)).result).toBe("failed");
  });
  it("retrait", async () => {
    const sys = fakeSystem(ok, { code: 0, effective: true });
    expect((await removeHostsAlias(sys.deps)).result).toBe("done");
    expect((await removeHostsAlias(fakeSystem(missing, { code: 0, effective: true }).deps)).result).toBe("already");
  });
  it("hors Windows : rien n'est lancé", async () => {
    const sys = fakeSystem(missing, { code: 0, effective: true });
    expect((await addHostsAlias({ ...sys.deps, platform: "linux" })).result).toBe("unsupported");
    expect(sys.calls).toHaveLength(0);
  });
});
