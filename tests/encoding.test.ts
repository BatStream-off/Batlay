import { describe, it, expect } from "vitest";
import { cleanMetadataText, repairMojibake } from "@/utils/text-encoding";
import { decodePowerShellOutput, resolvePosition } from "../electron/services/system-media";

/** Encode en page de code OEM 850 (celle d'une console Windows française) les seuls caractères dont on a besoin. */
const CP850: Record<string, number> = { é: 0x82, è: 0x8a, à: 0x85, ç: 0x87, Ç: 0x80, ê: 0x88, ô: 0x93 };
function encodeCp850(text: string): Buffer {
  return Buffer.from([...text].map((ch) => (ch in CP850 ? CP850[ch] : ch.charCodeAt(0))));
}

describe("cause racine des « � » : sortie PowerShell en page de code OEM", () => {
  const json = JSON.stringify({ title: "Été à Paris — Ça ira", artist: "Angèle, Stromaé" }).replace(/—/g, "-");

  it("REPRODUCTION : lire une sortie CP850 comme de l'UTF-8 (ancien comportement) détruit les accents", () => {
    const wrong = encodeCp850(json).toString("utf8");
    expect(wrong).toContain("\ufffd");
    expect(JSON.parse(wrong).title).not.toBe("Été à Paris - Ça ira");
  });

  it("CORRECTIF : Base64 d'un JSON UTF-8 (ce que le script PowerShell émet) est décodé sans perte", () => {
    const stdout = Buffer.from(Buffer.from(json, "utf8").toString("base64") + "\r\n", "latin1");
    const parsed = JSON.parse(decodePowerShellOutput(stdout));
    expect(parsed.title).toBe("Été à Paris - Ça ira");
    expect(parsed.artist).toBe("Angèle, Stromaé");
  });

  it("insensible à la page de code : caractères hors Latin-1 (Ø, japonais, emoji) inclus", () => {
    const original = JSON.stringify({ artist: "MØ, 宇多田ヒカル, 🎵" });
    const stdout = Buffer.from(Buffer.from(original, "utf8").toString("base64"), "latin1");
    expect(decodePowerShellOutput(stdout)).toBe(original);
  });

  it("repli JSON en clair : UTF-8 valide (avec ou sans BOM) décodé correctement", () => {
    const text = '{"title":"Café"}';
    expect(decodePowerShellOutput(Buffer.from(text, "utf8"))).toBe(text);
    expect(decodePowerShellOutput(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, "utf8")]))).toBe(text);
  });

  it("repli JSON en clair : octets non UTF-8 (Windows-1252) -> décodés en Windows-1252, jamais en �", () => {
    const latin1 = Buffer.from('{"title":"Caf\u00e9"}', "latin1");
    expect(decodePowerShellOutput(latin1)).toBe('{"title":"Café"}');
  });

  it("accepte aussi une chaîne", () => {
    expect(decodePowerShellOutput(Buffer.from('{"a":1}').toString("utf8"))).toBe('{"a":1}');
  });
});

describe("métadonnées mal décodées par la SOURCE (tags MP3 UTF-8 lus en Windows-1252)", () => {
  const cases: [string, string][] = [
    ["CafÃ©", "Café"],
    ["AngÃ¨le", "Angèle"],
    ["FranÃ§ois Hardy", "François Hardy"],
    ["Ã‰tienne Daho", "Étienne Daho"], // É = C3 89 ; 0x89 lu en Windows-1252 = ‰
    ["Beyoncé".normalize("NFC"), "Beyoncé"], // déjà correct : inchangé
    ["Sinéad O’Connor", "Sinéad O’Connor"], // apostrophe typographique légitime : inchangé
  ];
  it.each(cases)("%s -> %s", (input, expected) => {
    expect(cleanMetadataText(input)).toBe(expected);
  });

  it("répare un double encodage", () => {
    const once = Buffer.from("Café", "utf8").toString("latin1"); // CafÃ©
    const twice = Buffer.from(once, "utf8").toString("latin1");
    expect(repairMojibake(twice)).toBe("Café");
  });

  it("ne « répare » PAS un texte légitime qui contient un Ã ou un Â", () => {
    expect(repairMojibake("SÃO PAULO")).toBe("SÃO PAULO");
    expect(repairMojibake("Bâ Ã")).toBe("Bâ Ã");
  });

  it("ne masque pas un � déjà perdu (il doit rester visible pour signaler le problème en amont)", () => {
    expect(cleanMetadataText("Caf\ufffd")).toBe("Caf\ufffd");
  });

  it("retire les caractères de contrôle (NUL final des tags) et normalise en NFC", () => {
    expect(cleanMetadataText("Titre\u0000\u0000")).toBe("Titre");
    expect(cleanMetadataText("Cafe\u0301")).toBe("Café"); // e + accent combinant -> é
    expect(cleanMetadataText("  espaces  ")).toBe("espaces");
    expect(cleanMetadataText(null)).toBe("");
    expect(cleanMetadataText(undefined)).toBe("");
  });
});

describe("resolvePosition — position Windows extrapolée depuis LastUpdatedTime", () => {
  const base = { durationMs: 200_000, isPlaying: true };

  it("ajoute le temps écoulé depuis la dernière mise à jour de l'app", () => {
    expect(resolvePosition({ ...base, positionMs: 30_000, lastUpdatedMs: 1_000_000, sampledAtMs: 1_004_000 })).toBe(34_000);
  });

  it("en pause : position telle quelle", () => {
    expect(resolvePosition({ ...base, isPlaying: false, positionMs: 30_000, lastUpdatedMs: 1_000_000, sampledAtMs: 1_004_000 })).toBe(30_000);
  });

  it("ignore un LastUpdatedTime absent, dans le futur ou aberrant", () => {
    expect(resolvePosition({ ...base, positionMs: 30_000, lastUpdatedMs: null, sampledAtMs: 5 })).toBe(30_000);
    expect(resolvePosition({ ...base, positionMs: 30_000, lastUpdatedMs: 2_000_000, sampledAtMs: 1_000_000 })).toBe(30_000);
    expect(resolvePosition({ ...base, positionMs: 30_000, lastUpdatedMs: 0, sampledAtMs: 1_700_000_000_000 })).toBe(30_000);
  });

  it("n'extrapole pas sans durée connue (flux en direct)", () => {
    expect(resolvePosition({ durationMs: 0, isPlaying: true, positionMs: 5000, lastUpdatedMs: 1000, sampledAtMs: 4000 })).toBe(5000);
  });

  it("ne dépasse jamais la durée", () => {
    expect(resolvePosition({ ...base, positionMs: 199_000, lastUpdatedMs: 0 + 1, sampledAtMs: 1 + 5000 })).toBe(200_000);
  });

  it("valeurs invalides -> 0", () => {
    expect(resolvePosition({ ...base, positionMs: Number.NaN })).toBe(0);
  });
});
