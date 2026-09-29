import { describeUpdateError, type UpdateStatus } from "../shared/update.js";

/**
 * Logique de mise à jour, sans Electron : l'« updater » (electron-updater) et
 * l'envoi d'état sont injectés, ce qui permet de la tester (tests/updater.test.ts).
 *
 * Principe : Batlay ne télécharge JAMAIS rien sans clic. Une recherche
 * (automatique au démarrage ou à la demande) ne fait que signaler qu'une
 * version existe ; le téléchargement puis l'installation sont deux clics.
 */

/** Sous-ensemble d'`autoUpdater` (electron-updater) utilisé ici. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateControllerOptions {
  updater: UpdaterLike;
  /** Faux en développement : il n'y a alors rien à mettre à jour. */
  isPackaged: boolean;
  /** Faux tant que le dépôt GitHub n'est pas renseigné (electron/shared/update.ts). */
  configured: boolean;
  onStatus: (status: UpdateStatus) => void;
  log?: (message: string) => void;
}

export interface UpdateController {
  getStatus(): UpdateStatus;
  /** `silent` : recherche de fond (démarrage) — une erreur réseau n'est pas montrée. */
  check(options?: { silent?: boolean }): Promise<UpdateStatus>;
  download(): Promise<UpdateStatus>;
  install(): void;
}

export function createUpdateController(options: UpdateControllerOptions): UpdateController {
  const { updater, isPackaged, configured, onStatus } = options;
  const log = options.log ?? (() => {});

  let status: UpdateStatus = !isPackaged
    ? { state: "unavailable", reason: "dev" }
    : !configured
      ? { state: "unavailable", reason: "not-configured" }
      : { state: "idle" };

  const usable = status.state !== "unavailable";

  function set(next: UpdateStatus): void {
    status = next;
    onStatus(next);
  }

  /**
   * État courant relu tel quel. TypeScript « fige » le type de `status` après
   * un test (`if (status.state !== …) return`) et ne voit pas que `set()` le
   * modifie plus loin, y compris via les événements de l'updater : on relit
   * donc la valeur à travers cette fonction.
   */
  const stateNow = (): UpdateStatus["state"] => status.state;

  if (usable) {
    updater.autoDownload = false; // le téléchargement attend un clic
    updater.autoInstallOnAppQuit = false; // et l'installation aussi

    updater.on("update-available", (info: { version?: string }) => {
      set({ state: "available", version: String(info?.version ?? "") });
    });
    updater.on("update-not-available", () => set({ state: "up-to-date" }));
    updater.on("download-progress", (progress: { percent?: number }) => {
      const percent = Math.max(0, Math.min(100, Math.round(Number(progress?.percent ?? 0))));
      set({ state: "downloading", percent });
    });
    updater.on("update-downloaded", (info: { version?: string }) => {
      set({ state: "downloaded", version: String(info?.version ?? "") });
    });
  }

  return {
    getStatus: () => status,

    async check({ silent = false } = {}) {
      if (!usable) return status;
      if (status.state === "checking" || status.state === "downloading" || status.state === "downloaded") return status;
      const previous = status;
      set({ state: "checking" });
      try {
        await updater.checkForUpdates();
        // Les événements « update-available / not-available » ont posé l'état ;
        // s'il n'a pas changé (aucun événement), on ne reste pas bloqué sur « checking ».
        if (stateNow() === "checking") set({ state: "up-to-date" });
      } catch (err) {
        log(`Recherche de mise à jour échouée : ${String((err as Error)?.message ?? err)}`);
        // Recherche de fond : on remet l'état d'avant (jamais « checking », exclu plus haut).
        if (silent) set(previous);
        else set({ state: "error", message: describeUpdateError(err) });
      }
      return status;
    },

    async download() {
      if (status.state !== "available") return status;
      const version = status.version;
      set({ state: "downloading", percent: 0 });
      try {
        await updater.downloadUpdate();
        if (stateNow() === "downloading") set({ state: "downloaded", version });
      } catch (err) {
        log(`Téléchargement de mise à jour échoué : ${String((err as Error)?.message ?? err)}`);
        set({ state: "error", message: describeUpdateError(err) });
      }
      return status;
    },

    install() {
      if (status.state !== "downloaded") return;
      // (silencieux = false : l'installateur montre sa progression ; relance = true : Batlay se rouvre seul.)
      updater.quitAndInstall(false, true);
    },
  };
}
