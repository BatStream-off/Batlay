import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanMetadataText } from "@/utils/text-encoding";
import {
  buildScript,
  decodePowerShellOutput,
  executePowerShell,
  type PowerShellExec,
} from "../electron/services/system-media";

/** Ce que le script PowerShell écrit sur stdout : JSON -> octets UTF-8 -> Base64 (ASCII pur). */
const emit = (obj: unknown): string => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
const asStdout = (text: string): Buffer => Buffer.from(text, "latin1");

describe("decodePowerShellOutput — accents, emoji, CJK", () => {
  const original = {
    supported: true,
    session: {
      title: "Été à Paris — Ça ira 🎵",
      artist: "Angèle, Stromae, MØ, 宇多田ヒカル, Мумий Тролль",
    },
  };

  it("restitue exactement le texte, quelle que soit la page de code de la console", () => {
    const decoded = decodePowerShellOutput(asStdout(emit(original)));
    expect(JSON.parse(decoded)).toEqual(original);
  });

  it("tolère un retour à la ligne final (CRLF) ajouté par la console", () => {
    expect(JSON.parse(decodePowerShellOutput(asStdout(emit(original) + "\r\n")))).toEqual(original);
    expect(JSON.parse(decodePowerShellOutput(asStdout(emit(original) + "\n")))).toEqual(original);
  });

  it("tolère un Base64 replié sur plusieurs lignes (blancs et retours ignorés)", () => {
    const b64 = emit(original);
    const wrapped = b64.match(/.{1,76}/g)!.join("\r\n");
    expect(wrapped).toContain("\r\n");
    expect(JSON.parse(decodePowerShellOutput(asStdout(wrapped)))).toEqual(original);
  });

  it("tolère un BOM UTF-8 devant le Base64", () => {
    const withBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), asStdout(emit(original) + "\r\n")]);
    expect(JSON.parse(decodePowerShellOutput(withBom))).toEqual(original);
  });

  it("retours à la ligne DANS les valeurs : préservés par le JSON (ils voyagent échappés)", () => {
    const multi = { session: { title: "Ligne 1\nLigne 2" } };
    expect(JSON.parse(decodePowerShellOutput(asStdout(emit(multi))))).toEqual(multi);
  });

  it("un simple mot valide en Base64 (« null », « test ») n'est pas pris pour notre sortie", () => {
    expect(decodePowerShellOutput(asStdout("null"))).toBe("null");
    expect(decodePowerShellOutput(asStdout("test"))).toBe("test");
  });

  it("sortie vide -> chaîne vide (l'appelant produit alors une erreur explicite)", () => {
    expect(decodePowerShellOutput(Buffer.alloc(0))).toBe("");
    expect(decodePowerShellOutput(asStdout("\r\n"))).toBe("");
  });

  it("repli JSON en clair avec BOM : BOM retiré, accents intacts", () => {
    const plain = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"artist":"Angèle 🎵"}', "utf8")]);
    expect(decodePowerShellOutput(plain)).toBe('{"artist":"Angèle 🎵"}');
  });
});

describe("executePowerShell — chemin unique d'exécution, testé avec un faux stdout", () => {
  const okExec = (stdout: Buffer): PowerShellExec => vi.fn(async () => ({ stdout }));

  it("impose des octets bruts (encoding: 'buffer') : Node ne décode jamais lui-même la sortie", async () => {
    const exec = okExec(asStdout(emit({ supported: true })));
    await executePowerShell("script", exec);
    const [file, args, options] = (exec as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      string[],
      { encoding: string; maxBuffer: number; timeout: number },
    ];
    expect(file).toBe("powershell.exe");
    expect(options.encoding).toBe("buffer");
    expect(options.maxBuffer).toBeGreaterThanOrEqual(10 * 1024 * 1024);
    expect(args).toContain("-NoProfile");
    expect(args).toContain("-NonInteractive");
    expect(args[args.length - 1]).toBe("script");
  });

  it("Spotify accentué + multi-artistes : arrivent intacts jusqu'à l'objet résultat", async () => {
    const stdout = asStdout(
      emit({
        supported: true,
        session: {
          title: "Dernière danse — été 🎵",
          artist: "Tyler, The Creator, Angèle, 宇多田ヒカル",
          albumArtist: "Tyler, The Creator",
        },
      }) + "\r\n"
    );
    const result = await executePowerShell("script", okExec(stdout));
    expect(result.session?.title).toBe("Dernière danse — été 🎵");
    expect(result.session?.artist).toBe("Tyler, The Creator, Angèle, 宇多田ヒカル");
    expect(result.session?.albumArtist).toBe("Tyler, The Creator");
  });

  it("échec de PowerShell : message explicite", async () => {
    const exec: PowerShellExec = async () => {
      throw new Error("spawn powershell.exe ENOENT");
    };
    await expect(executePowerShell("script", exec)).rejects.toThrow("Impossible d'interroger");
  });

  it("sortie illisible : message explicite plutôt qu'une exception JSON brute", async () => {
    await expect(executePowerShell("script", okExec(asStdout("pas du json")))).rejects.toThrow(
      "Réponse inattendue"
    );
  });
});

describe("garde-fous du script PowerShell", () => {
  const script = buildScript({ includeArtwork: true });

  it("encode le JSON en octets UTF-8 puis en Base64 avant toute écriture", () => {
    expect(script).toContain("[System.Text.Encoding]::UTF8.GetBytes(");
    expect(script).toContain("[Convert]::ToBase64String(");
  });

  it("une seule écriture sur stdout, et c'est la fonction Emit (Base64) qui la fait", () => {
    expect(script.match(/\[Console\]::Out\.Write\(/g) ?? []).toHaveLength(1);
    const emitBody = script.slice(script.indexOf("function Emit"), script.indexOf("function Emit") + 400);
    expect(emitBody).toContain("[Console]::Out.Write(");
    expect(emitBody).toContain("ToBase64String");
  });

  it("aucune autre sortie susceptible d'être décodée avec la page de code OEM", () => {
    for (const forbidden of [/Write-Output/i, /Write-Host/i, /Out-String/i, /Out-Host/i, /\[Console\]::Write\(/, /\[Console\]::WriteLine/]) {
      expect(script).not.toMatch(forbidden);
    }
  });

  it("lit AlbumArtist en plus d'Artist (diagnostic seulement)", () => {
    expect(script).toContain("$props.Artist");
    expect(script).toContain("$props.AlbumArtist");
  });

  it("échappe le guillemet simple d'un identifiant d'application dans $__params", () => {
    expect(buildScript({ preferredAppId: "O'Brien.exe" })).toContain("O''Brien.exe");
  });

  it("execFile n'est appelé qu'à un seul endroit (chemin unique) et impose toujours encoding: buffer", () => {
    const source = readFileSync(join(process.cwd(), "electron", "services", "system-media.ts"), "utf8");
    expect(source.match(/execFileAsync\(/g) ?? []).toHaveLength(1);
    expect(source.match(/encoding:\s*"buffer"/g)?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(source).not.toMatch(/encoding:\s*["']utf-?8["']/i);
  });
});

describe("cleanMetadataText — nettoyage sans jamais réécrire un nom", () => {
  const PROTECTED = [
    "Tyler, The Creator",
    "Simon & Garfunkel",
    "AC/DC",
    "Earth, Wind & Fire",
    "Mötley Crüe",
    "!!!",
    "Tyler, The Creator, Frank Ocean & Kali Uchis",
    "Sigur Rós",
    "MØ",
    "宇多田ヒカル",
  ];
  it.each(PROTECTED)("« %s » ressort tel quel", (name) => {
    expect(cleanMetadataText(name)).toBe(name);
  });

  it("ne découpe pas une liste d'artistes : virgules et « & » conservés", () => {
    expect(cleanMetadataText("Artiste 1, Artiste 2, Artiste 3")).toBe("Artiste 1, Artiste 2, Artiste 3");
  });

  it("supprime BOM et caractères de largeur nulle", () => {
    expect(cleanMetadataText("\uFEFFTitre")).toBe("Titre");
    expect(cleanMetadataText("Ti\u200Btre")).toBe("Titre");
    expect(cleanMetadataText("Ti\u2060tre")).toBe("Titre");
    expect(cleanMetadataText("\u200B\u200B")).toBe("");
  });

  it("supprime les caractères de contrôle et les NUL de fin de tag", () => {
    expect(cleanMetadataText("Titre\u0000\u0000")).toBe("Titre");
    expect(cleanMetadataText("A\u0007B\u001fC\u007fD\u0085E")).toBe("ABCDE");
  });

  it("ramène espaces multiples, tabulations, retours à la ligne et insécables à un seul espace", () => {
    expect(cleanMetadataText("  Daft   Punk  ")).toBe("Daft Punk");
    expect(cleanMetadataText("Titre\t\tlong\r\nsuite")).toBe("Titre long suite");
    expect(cleanMetadataText("A\u00A0\u00A0B")).toBe("A B");
    expect(cleanMetadataText("A\u3000B")).toBe("A B");
  });

  it("ZWJ / ZWNJ à l'intérieur d'un texte sont conservés (emoji composés, persan) ; en bordure ils sont retirés", () => {
    const family = "👨\u200D👩\u200D👧";
    expect(cleanMetadataText(family)).toBe(family);
    const persian = "می\u200Cخواهم";
    expect(cleanMetadataText(persian)).toBe(persian);
    expect(cleanMetadataText("\u200DTitre\u200C")).toBe("Titre");
  });

  it("NFC : « é » décomposé -> « é » simple", () => {
    expect(cleanMetadataText("Cafe\u0301")).toBe("Café");
    expect(cleanMetadataText("Ange\u0300le")).toBe("Angèle");
  });

  it("vide / null / undefined -> chaîne vide", () => {
    expect(cleanMetadataText("")).toBe("");
    expect(cleanMetadataText(null)).toBe("");
    expect(cleanMetadataText(undefined)).toBe("");
  });

  it("idempotente : nettoyer deux fois = nettoyer une fois", () => {
    for (const value of [...PROTECTED, "  \uFEFFAngè\u200Ble \t 🎵\u0000 ", "CafÃ©", "SÃO PAULO"]) {
      const once = cleanMetadataText(value);
      expect(cleanMetadataText(once)).toBe(once);
    }
  });
});
