import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createUpdateController, type UpdaterLike } from "../electron/services/updater";
import {
  UPDATE_REPO,
  UPDATE_REPO_PLACEHOLDER,
  describeUpdateError,
  isUpdateRepoConfigured,
  releasesUrl,
  type UpdateStatus,
} from "../electron/shared/update";

/** Faux electron-updater : on déclenche les événements à la main. */
function fakeUpdater() {
  const listeners = new Map<string, (...args: any[]) => void>();
  const updater = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      listeners.set(event, listener);
    }),
    checkForUpdates: vi.fn(async () => undefined),
    downloadUpdate: vi.fn(async () => undefined),
    quitAndInstall: vi.fn(),
  };
  return { updater: updater as unknown as UpdaterLike & typeof updater, emit: (e: string, ...a: any[]) => listeners.get(e)?.(...a) };
}

function setup(overrides: { isPackaged?: boolean; configured?: boolean } = {}) {
  const fake = fakeUpdater();
  const seen: UpdateStatus[] = [];
  const controller = createUpdateController({
    updater: fake.updater,
    isPackaged: overrides.isPackaged ?? true,
    configured: overrides.configured ?? true,
    onStatus: (s) => seen.push(s),
  });
  return { ...fake, controller, seen };
}

describe("mise à jour — contrôleur", () => {
  it("ne télécharge ni n'installe rien sans clic", () => {
    const { updater } = setup();
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
  });

  it("reste inerte en développement et tant que le dépôt n'est pas renseigné", async () => {
    const dev = setup({ isPackaged: false });
    expect(dev.controller.getStatus()).toEqual({ state: "unavailable", reason: "dev" });
    await dev.controller.check();
    expect(dev.updater.checkForUpdates).not.toHaveBeenCalled();

    const unset = setup({ configured: false });
    expect(unset.controller.getStatus()).toEqual({ state: "unavailable", reason: "not-configured" });
    await unset.controller.check();
    expect(unset.updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("recherche → version disponible", async () => {
    const { controller, updater, emit } = setup();
    updater.checkForUpdates.mockImplementation(async () => emit("update-available", { version: "0.3.0" }));
    expect(await controller.check()).toEqual({ state: "available", version: "0.3.0" });
  });

  it("recherche → à jour (événement ou absence d'événement)", async () => {
    const a = setup();
    a.updater.checkForUpdates.mockImplementation(async () => a.emit("update-not-available", {}));
    expect(await a.controller.check()).toEqual({ state: "up-to-date" });

    const b = setup();
    expect((await b.controller.check()).state).toBe("up-to-date");
  });

  it("télécharge seulement une version signalée, avec progression, puis « prête »", async () => {
    const { controller, updater, emit, seen } = setup();
    await controller.download(); // rien de signalé : sans effet
    expect(updater.downloadUpdate).not.toHaveBeenCalled();

    updater.checkForUpdates.mockImplementation(async () => emit("update-available", { version: "0.3.0" }));
    await controller.check();
    updater.downloadUpdate.mockImplementation(async () => {
      emit("download-progress", { percent: 41.6 });
      emit("update-downloaded", { version: "0.3.0" });
    });
    await controller.download();
    expect(seen).toContainEqual({ state: "downloading", percent: 42 });
    expect(controller.getStatus()).toEqual({ state: "downloaded", version: "0.3.0" });
  });

  it("borne le pourcentage entre 0 et 100", () => {
    const { emit, seen } = setup();
    emit("download-progress", { percent: 180 });
    emit("download-progress", { percent: -5 });
    expect(seen).toEqual([
      { state: "downloading", percent: 100 },
      { state: "downloading", percent: 0 },
    ]);
  });

  it("n'installe que si une version est téléchargée", async () => {
    const { controller, updater, emit } = setup();
    controller.install();
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
    emit("update-downloaded", { version: "0.3.0" });
    controller.install();
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("une erreur manuelle est montrée, une erreur de fond (démarrage) est silencieuse", async () => {
    const manual = setup();
    manual.updater.checkForUpdates.mockRejectedValue(new Error("getaddrinfo ENOTFOUND github.com"));
    const result = await manual.controller.check();
    expect(result.state).toBe("error");
    expect(result.state === "error" && result.message).toContain("GitHub");

    const silent = setup();
    silent.updater.checkForUpdates.mockRejectedValue(new Error("getaddrinfo ENOTFOUND github.com"));
    expect((await silent.controller.check({ silent: true })).state).toBe("idle");
  });

  it("ne lance pas deux recherches en même temps", async () => {
    const { controller, updater } = setup();
    let release!: () => void;
    updater.checkForUpdates.mockImplementation(() => new Promise<void>((resolve) => (release = resolve)));
    const first = controller.check();
    await controller.check();
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    release();
    await first;
  });
});

describe("mise à jour — messages et configuration", () => {
  it("traduit les erreurs courantes en messages lisibles", () => {
    expect(describeUpdateError(new Error("net::ERR_INTERNET_DISCONNECTED"))).toMatch(/connexion/i);
    expect(describeUpdateError(new Error("Cannot find latest.yml in the latest release"))).toMatch(/Aucune version publiée/);
    expect(describeUpdateError(new Error("HTTP 403 rate limit exceeded"))).toMatch(/limite/);
    expect(describeUpdateError(new Error("Autre\ndétail technique")).includes("détail")).toBe(false);
  });

  it("le dépôt par défaut est reconnu comme non renseigné", () => {
    expect(isUpdateRepoConfigured({ owner: UPDATE_REPO_PLACEHOLDER, repo: "batlay" })).toBe(false);
    expect(isUpdateRepoConfigured({ owner: "adilbl", repo: "batlay" })).toBe(true);
    expect(releasesUrl({ owner: "adilbl", repo: "batlay" })).toBe("https://github.com/adilbl/batlay/releases");
  });

  it("package.json publie sur le même dépôt GitHub que electron/shared/update.ts", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      build: { publish: { provider: string; owner: string; repo: string }[]; win: { artifactName: string } };
      dependencies: Record<string, string>;
    };
    const publish = pkg.build.publish[0];
    expect(publish.provider).toBe("github");
    expect(publish.owner).toBe(UPDATE_REPO.owner);
    expect(publish.repo).toBe(UPDATE_REPO.repo);
    expect(pkg.dependencies["electron-updater"]).toBeDefined();
    // Un espace dans le nom de l'installateur est transformé par GitHub : latest.yml pointerait vers un fichier introuvable.
    expect(pkg.build.win.artifactName).not.toMatch(/\s/);
  });
});
