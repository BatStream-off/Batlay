import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Garde-fou : aucun code de production ne doit réduire une liste d'artistes
 * à son premier élément (`artists[0]`, `artists?.[0]`, `artists.slice(0, 1)`,
 * `artists.at(0)`, `artists.shift()`...). Un tel raccourci fait disparaître
 * silencieusement les featurings et collaborations à l'affichage.
 *
 * (La recherche de pochette en ligne, dans electron/services/artwork-lookup.ts,
 * découpe volontairement le nom pour interroger iTunes/Deezer : c'est une
 * requête de recherche, jamais du texte affiché. Elle ne manipule pas de
 * tableau `artists`, donc n'est pas concernée par ce motif.)
 */
const FORBIDDEN = [
  /\bartists\s*\??\.?\s*\[\s*0\s*\]/,
  /\bartists\s*\??\.\s*slice\(\s*0\s*,\s*1\s*\)/,
  /\bartists\s*\??\.\s*at\(\s*0\s*\)/,
  /\bartists\s*\??\.\s*(shift|pop)\(\s*\)/,
  /\bartists\s*\??\.\s*find\(/,
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

describe("aucun code ne garde que le premier artiste", () => {
  const files = ["src", "electron", "overlay"].flatMap((d) => walk(join(process.cwd(), d)));

  it("analyse bien des fichiers (le garde-fou n'est pas vide)", () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it.each(FORBIDDEN.map((r) => [String(r), r] as const))("motif interdit %s", (_label, pattern) => {
    const offenders = files.filter((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .some((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*") && pattern.test(line))
    );
    expect(offenders).toEqual([]);
  });
});
