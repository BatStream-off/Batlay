import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { shell } from "electron";
import { store, saveRefreshToken, loadRefreshToken, clearSpotifyAuth } from "./config-store.js";
/**
 * Authentification Spotify via Authorization Code + PKCE (recommandé pour
 * une app desktop, pas de Client Secret nécessaire côté client).
 *
 * ⚠️ CONFIGURATION REQUISE (voir README > "Configuration Spotify") :
 *   1. Créer une app sur https://developer.spotify.com/dashboard
 *   2. Ajouter la Redirect URI exacte : http://127.0.0.1:{CALLBACK_PORT}/callback
 *   3. Renseigner le Client ID dans Batlay (Settings > Connections > Spotify)
 *
 * Sans ce Client ID fourni par l'utilisateur, la connexion Spotify est
 * désactivée dans l'UI — Batlay ne prétend jamais qu'elle est active.
 */
const CALLBACK_PORT = 8945;
const REDIRECT_URI = `http://127.0.0.1:${CALLBACK_PORT}/callback`;
const SCOPES = ["user-read-currently-playing", "user-read-playback-state"];
let accessToken = null;
let accessTokenExpiresAt = 0;
function base64UrlEncode(buffer) {
    return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function generateCodeVerifier() {
    return base64UrlEncode(randomBytes(64));
}
function generateCodeChallenge(verifier) {
    return base64UrlEncode(createHash("sha256").update(verifier).digest());
}
export function getClientId() {
    return store.get("spotify").clientId;
}
export function setClientId(clientId) {
    store.set("spotify", { ...store.get("spotify"), clientId });
}
export function isConfigured() {
    return Boolean(getClientId());
}
/**
 * Lance le flow OAuth : ouvre le navigateur système sur la page
 * d'autorisation Spotify, démarre un serveur HTTP local éphémère pour
 * capter le callback, échange le code contre un token, puis stocke le
 * refresh token chiffré.
 */
export async function connectSpotify() {
    const clientId = getClientId();
    if (!clientId) {
        throw new Error("Aucun Client ID Spotify configuré. Renseignez-le dans Settings > Connections avant de vous connecter.");
    }
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = base64UrlEncode(randomBytes(16));
    const authUrl = new URL("https://accounts.spotify.com/authorize");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("state", state);
    const code = await waitForAuthorizationCode(authUrl.toString(), state);
    const tokens = await exchangeCodeForTokens(code, codeVerifier, clientId);
    accessToken = tokens.access_token;
    accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
    if (tokens.refresh_token) {
        saveRefreshToken(tokens.refresh_token);
    }
}
function waitForAuthorizationCode(authUrl, expectedState) {
    return new Promise((resolve, reject) => {
        let server;
        const timeout = setTimeout(() => {
            server?.close();
            reject(new Error("Délai d'attente dépassé pour l'autorisation Spotify."));
        }, 120_000);
        server = createServer((req, res) => {
            if (!req.url?.startsWith("/callback")) {
                res.writeHead(404).end();
                return;
            }
            const url = new URL(req.url, `http://127.0.0.1:${CALLBACK_PORT}`);
            const code = url.searchParams.get("code");
            const returnedState = url.searchParams.get("state");
            const error = url.searchParams.get("error");
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            if (error || !code || returnedState !== expectedState) {
                res.end("<h1>Connexion Spotify échouée</h1><p>Vous pouvez fermer cet onglet et réessayer dans Batlay.</p>");
                clearTimeout(timeout);
                server.close();
                reject(new Error(error ?? "Réponse d'autorisation invalide (state mismatch)."));
                return;
            }
            res.end("<h1>Spotify connecté ✅</h1><p>Vous pouvez fermer cet onglet et revenir à Batlay.</p>");
            clearTimeout(timeout);
            server.close();
            resolve(code);
        });
        server.listen(CALLBACK_PORT, "127.0.0.1", () => {
            shell.openExternal(authUrl);
        });
        server.on("error", (err) => {
            clearTimeout(timeout);
            reject(new Error(`Impossible de démarrer le serveur de callback local sur le port ${CALLBACK_PORT} (${err.message}). ` +
                "Vérifiez qu'aucune autre application ne l'utilise."));
        });
    });
}
async function exchangeCodeForTokens(code, codeVerifier, clientId) {
    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: clientId,
        code_verifier: codeVerifier,
    });
    const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Échec de l'échange du code Spotify (${res.status}): ${text}`);
    }
    return res.json();
}
async function refreshAccessToken() {
    const clientId = getClientId();
    const refreshToken = loadRefreshToken();
    if (!clientId || !refreshToken) {
        throw new Error("Aucune session Spotify à rafraîchir. Reconnectez-vous.");
    }
    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
    });
    const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!res.ok) {
        throw new Error(`Échec du rafraîchissement du token Spotify (${res.status}).`);
    }
    const tokens = (await res.json());
    accessToken = tokens.access_token;
    accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
    if (tokens.refresh_token)
        saveRefreshToken(tokens.refresh_token);
}
async function getValidAccessToken() {
    if (accessToken && Date.now() < accessTokenExpiresAt - 5000) {
        return accessToken;
    }
    await refreshAccessToken();
    if (!accessToken)
        throw new Error("Impossible d'obtenir un access token Spotify valide.");
    return accessToken;
}
export function disconnectSpotify() {
    accessToken = null;
    accessTokenExpiresAt = 0;
    clearSpotifyAuth();
}
export function isSessionRestorable() {
    return Boolean(loadRefreshToken());
}
/**
 * Restaure une session existante au démarrage de Batlay, sans ouvrir
 * de navigateur, si un refresh token valide est présent.
 */
export async function restoreSession() {
    if (!isSessionRestorable())
        return false;
    try {
        await refreshAccessToken();
        return true;
    }
    catch {
        clearSpotifyAuth();
        return false;
    }
}
/** Appelle GET /me/player/currently-playing avec un access token valide. */
export async function fetchCurrentlyPlaying() {
    const token = await getValidAccessToken();
    const res = await fetch("https://api.spotify.com/v1/me/player/currently-playing", {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 204)
        return null; // rien en lecture actuellement
    if (!res.ok) {
        // Spotify renvoie presque toujours une raison exploitable dans le corps
        // JSON (ex. "Premium required", "Insufficient client scope") — sans ça,
        // on ne voit qu'un code HTTP nu et impossible à diagnostiquer.
        const body = (await res.json().catch(() => null));
        const reason = body?.error?.message;
        throw new Error(`Échec de la récupération du morceau en cours (${res.status})` + (reason ? ` : ${reason}` : "."));
    }
    // L'API Spotify répond en snake_case (is_playing, progress_ms) ; on
    // normalise ici vers le camelCase attendu par le reste de l'app, sinon
    // isPlaying/progress restent `undefined` à l'exécution malgré le typage.
    const raw = (await res.json());
    return {
        isPlaying: raw.is_playing,
        progressMs: raw.progress_ms ?? 0,
        item: raw.item,
    };
}
//# sourceMappingURL=spotify-auth.js.map