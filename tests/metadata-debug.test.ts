import { describe, it, expect, vi, afterEach } from "vitest";
import {
  METADATA_DEBUG_STORAGE_KEY,
  classifyMetadataDebugCases,
  createMetadataDebugLogger,
  describeCodePoints,
  isMetadataDebugEnabled,
} from "@/utils/metadata-debug";

const fields = (title: string, artist: string, album = "") => ({ title, artist, album });

describe("describeCodePoints", () => {
  it("laisse l'ASCII lisible et rend tout le reste explicite", () => {
    expect(describeCodePoints("Angèle")).toBe("Ang[U+00E8]le");
    expect(describeCodePoints("A\u0000B")).toBe("A[U+0000]B");
    expect(describeCodePoints("\uFEFFx")).toBe("[U+FEFF]x");
  });

  it("distingue un « è » composé d'un « è » décomposé", () => {
    expect(describeCodePoints("\u00E8")).toBe("[U+00E8]");
    expect(describeCodePoints("e\u0300")).toBe("e[U+0300]");
  });

  it("un emoji est UN point de code, pas deux moitiés de paire de substitution", () => {
    expect(describeCodePoints("🎵")).toBe("[U+1F3B5]");
  });
});

describe("classifyMetadataDebugCases — les 3 cas utiles", () => {
  it("accent", () => {
    expect(classifyMetadataDebugCases(fields("Été", "Angèle"))).toEqual(["accent"]);
    expect(classifyMetadataDebugCases(fields("Track", "Mötley Crüe"))).toEqual(["accent"]);
  });

  it("multi-artistes", () => {
    expect(classifyMetadataDebugCases(fields("Track", "Artiste 1, Artiste 2"))).toEqual(["multi-artistes"]);
    expect(classifyMetadataDebugCases(fields("Track", "Drake feat. Rihanna"))).toEqual(["multi-artistes"]);
    expect(classifyMetadataDebugCases(fields("Track", "Simon & Garfunkel"))).toEqual(["multi-artistes"]);
  });

  it("un « � » (U+FFFD) compte comme un accent perdu", () => {
    expect(classifyMetadataDebugCases(fields("Titre", "Ang\uFFFDle"))).toEqual(["accent"]);
  });

  it("non-latin", () => {
    expect(classifyMetadataDebugCases(fields("First Love", "宇多田ヒカル"))).toEqual(["non-latin"]);
    expect(classifyMetadataDebugCases(fields("Track", "Мумий Тролль"))).toEqual(["non-latin"]);
  });

  it("aucun cas : texte ASCII simple, ou emoji seul (pas une lettre non latine)", () => {
    expect(classifyMetadataDebugCases(fields("Instant Crush", "Daft Punk"))).toEqual([]);
    expect(classifyMetadataDebugCases(fields("🎵", "Daft Punk"))).toEqual([]);
  });

  it("peut cumuler plusieurs cas", () => {
    expect(classifyMetadataDebugCases(fields("Été", "Angèle, 宇多田ヒカル"))).toEqual([
      "accent",
      "multi-artistes",
      "non-latin",
    ]);
  });
});

describe("createMetadataDebugLogger", () => {
  it("désactivé : n'écrit rien (et n'inspecte même pas les champs)", () => {
    const write = vi.fn();
    const log = createMetadataDebugLogger({ isEnabled: () => false, write });
    log("k", fields("Été", "Angèle"), fields("Été", "Angèle"));
    // Champs volontairement invalides : ne doivent jamais être lus quand c'est désactivé.
    log("k2", undefined as never, undefined as never);
    expect(write).not.toHaveBeenCalled();
  });

  it("activé : journalise le brut ET le nettoyé, avec les codes Unicode avant/après", () => {
    const write = vi.fn();
    const log = createMetadataDebugLogger({ isEnabled: () => true, write });
    log("k", fields("Titre", "AngÃ¨le"), fields("Titre", "Angèle"));
    const message = write.mock.calls[0][0] as string;
    expect(message).toContain("cas : accent");
    expect(message).toContain('artiste brut  : "AngÃ¨le"');
    expect(message).toContain("Ang[U+00C3][U+00A8]le");
    expect(message).toContain('artiste propre: "Angèle"');
    expect(message).toContain("Ang[U+00E8]le");
  });

  it("une seule entrée par morceau, même si le relevé se répète toutes les 2 s", () => {
    const write = vi.fn();
    const log = createMetadataDebugLogger({ isEnabled: () => true, write });
    for (let i = 0; i < 5; i++) log("Été::Angèle", fields("Été", "Angèle"), fields("Été", "Angèle"));
    expect(write).toHaveBeenCalledTimes(1);
    log("Autre::Angèle", fields("Autre", "Angèle"), fields("Autre", "Angèle"));
    expect(write).toHaveBeenCalledTimes(2);
  });

  it("ne journalise pas un morceau sans intérêt (ni accent, ni multi-artistes, ni non-latin)", () => {
    const write = vi.fn();
    const log = createMetadataDebugLogger({ isEnabled: () => true, write });
    log("k", fields("Instant Crush", "Daft Punk"), fields("Instant Crush", "Daft Punk"));
    expect(write).not.toHaveBeenCalled();
  });

  it("signale un U+FFFD déjà présent : l'information est perdue en amont, ce n'est pas réparable ici", () => {
    const write = vi.fn();
    const log = createMetadataDebugLogger({ isEnabled: () => true, write });
    log("k", fields("Titre", "Ang\uFFFDle"), fields("Titre", "Ang\uFFFDle"));
    expect(write.mock.calls[0][0]).toContain("cas : accent");
    expect(write.mock.calls[0][0]).toContain("U+FFFD");
  });

  it("le brut illustre un cas que le nettoyage a fait disparaître (mojibake réparé)", () => {
    const write = vi.fn();
    const log = createMetadataDebugLogger({ isEnabled: () => true, write });
    // Brut : « Ã¨ » = accent visible côté brut ; propre : ASCII seul.
    log("k", fields("Titre", "Ã¨"), fields("Titre", "e"));
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain("cas : accent");
  });

  it("affiche albumArtist (diagnostic) quand il est fourni", () => {
    const write = vi.fn();
    const log = createMetadataDebugLogger({ isEnabled: () => true, write });
    log(
      "k",
      { ...fields("Titre", "A, B"), albumArtist: "A" },
      fields("Titre", "A, B")
    );
    expect(write.mock.calls[0][0]).toContain('albumArtist brut  : "A"');
  });
});

describe("isMetadataDebugEnabled — drapeau localStorage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("désactivé par défaut (pas de localStorage, ou clé absente)", () => {
    expect(isMetadataDebugEnabled()).toBe(false);
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(isMetadataDebugEnabled()).toBe(false);
  });

  it('actif uniquement avec la valeur "1"', () => {
    const getItem = vi.fn((key: string) => (key === METADATA_DEBUG_STORAGE_KEY ? "1" : null));
    vi.stubGlobal("localStorage", { getItem });
    expect(isMetadataDebugEnabled()).toBe(true);
    vi.stubGlobal("localStorage", { getItem: () => "true" });
    expect(isMetadataDebugEnabled()).toBe(false);
  });

  it("storage indisponible (exception) : désactivé, jamais d'erreur", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(isMetadataDebugEnabled()).toBe(false);
  });
});
