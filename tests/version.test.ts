import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (file: string) => readFileSync(join(process.cwd(), file), "utf8");

// La version est écrite à la main dans « À propos » (Settings) : ce test évite
// qu'elle diverge de package.json lors d'une prochaine mise à jour.
describe("numéro de version", () => {
  const { version } = JSON.parse(read("package.json")) as { version: string };

  it("est le même dans package.json, package-lock.json et l'écran « À propos »", () => {
    const lock = JSON.parse(read("package-lock.json")) as { version: string; packages: Record<string, { version: string }> };
    expect(lock.version).toBe(version);
    expect(lock.packages[""].version).toBe(version);
    expect(read("src/pages/Settings.tsx")).toContain(`Version ${version}`);
  });
});
