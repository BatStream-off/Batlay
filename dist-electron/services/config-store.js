import Store from "electron-store";
import { safeStorage, app } from "electron";
const defaults = {
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
export const store = new Store({
    name: "batlay-config",
    defaults,
});
export function saveRefreshToken(token) {
    if (!safeStorage.isEncryptionAvailable()) {
        // Sur certains environnements Linux sans trousseau configuré, safeStorage
        // peut être indisponible. On refuse de stocker en clair plutôt que de
        // faire une fausse promesse de sécurité.
        throw new Error("Le chiffrement sécurisé (safeStorage) n'est pas disponible sur ce système. " +
            "Le refresh token Spotify ne peut pas être sauvegardé en toute sécurité.");
    }
    const encrypted = safeStorage.encryptString(token).toString("base64");
    store.set("spotify", { ...store.get("spotify"), encryptedRefreshToken: encrypted });
}
export function loadRefreshToken() {
    const encrypted = store.get("spotify").encryptedRefreshToken;
    if (!encrypted)
        return null;
    if (!safeStorage.isEncryptionAvailable())
        return null;
    try {
        return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
    }
    catch {
        return null; // token corrompu ou trousseau changé (ex. réinstall OS)
    }
}
export function clearSpotifyAuth() {
    store.set("spotify", { ...store.get("spotify"), encryptedRefreshToken: null });
}
export function getUserDataPath() {
    return app.getPath("userData");
}
//# sourceMappingURL=config-store.js.map