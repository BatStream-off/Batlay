import Store from "electron-store";
import { safeStorage, app } from "electron";

/**
 * Stocke la configuration persistante de Batlay (overlays, settings,
 * état de connexion). Les secrets (refresh token Spotify) sont chiffrés
 * via `safeStorage` (backé par le trousseau OS : DPAPI sur Windows)
 * avant d'être écrits sur disque — jamais en clair.
 *
 * IMPORTANT : le Client ID / Client Secret Spotify eux-mêmes ne sont
 * JAMAIS codés en dur ici. Ils doivent être fournis par l'utilisateur
 * via Settings > Connections (voir electron/services/spotify-auth.ts).
 */

export interface BatlayConfigSchema {
  overlays: unknown[]; // OverlayConfig[] côté renderer — non typé ici pour éviter le couplage
  activeOverlayId: string | null;
  settings: {
    launchOnStartup: boolean;
    startMinimized: boolean;
    theme: "dark" | "light";
    language: "fr" | "en";
    overlayServerPort: number;
    /**
     * AppUserModelId (ex. "Spotify.exe") de la session multimédia Windows
     * que le provider "Lecture système" doit préférer quand plusieurs
     * lecteurs tournent en même temps. `null` = comportement par défaut
     * (suit la session ayant le focus multimédia côté Windows).
     */
    preferredSystemMediaAppId: string | null;
  };
  spotify: {
    clientId: string | null;
    encryptedRefreshToken: string | null; // base64, chiffré via safeStorage
  };
}

const defaults: BatlayConfigSchema = {
  overlays: [],
  activeOverlayId: null,
  settings: {
    launchOnStartup: false,
    startMinimized: false,
    theme: "dark",
    language: "fr",
    overlayServerPort: 3000,
    preferredSystemMediaAppId: null,
  },
  spotify: {
    clientId: null,
    encryptedRefreshToken: null,
  },
};

export const store = new Store<BatlayConfigSchema>({
  name: "batlay-config",
  defaults,
});

export function saveRefreshToken(token: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    // Sur certains environnements Linux sans trousseau configuré, safeStorage
    // peut être indisponible. On refuse de stocker en clair plutôt que de
    // faire une fausse promesse de sécurité.
    throw new Error(
      "Le chiffrement sécurisé (safeStorage) n'est pas disponible sur ce système. " +
        "Le refresh token Spotify ne peut pas être sauvegardé en toute sécurité."
    );
  }
  const encrypted = safeStorage.encryptString(token).toString("base64");
  store.set("spotify", { ...store.get("spotify"), encryptedRefreshToken: encrypted });
}

export function loadRefreshToken(): string | null {
  const encrypted = store.get("spotify").encryptedRefreshToken;
  if (!encrypted) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return null; // token corrompu ou trousseau changé (ex. réinstall OS)
  }
}

export function clearSpotifyAuth(): void {
  store.set("spotify", { ...store.get("spotify"), encryptedRefreshToken: null });
}

export function getUserDataPath(): string {
  return app.getPath("userData");
}
