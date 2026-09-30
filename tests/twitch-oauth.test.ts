import { describe, it, expect } from "vitest";
import {
  buildAuthorizeUrl,
  generateState,
  interpretValidation,
  oauthErrorToTwitchError,
  parseCallbackPayload,
  statesMatch,
} from "../electron/services/twitch/twitch-oauth";
import { TWITCH_CLIENT_ID, TWITCH_PORT, TWITCH_REDIRECT_URI, TWITCH_SCOPES } from "../electron/shared/twitch";

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123";
const STATE = "0123456789abcdef0123456789abcdef";

describe("constantes Twitch", () => {
  it("port fixe 4000, redirection http://localhost:4000, Client ID fourni", () => {
    expect(TWITCH_PORT).toBe(4000);
    expect(TWITCH_REDIRECT_URI).toBe("http://localhost:4000");
    expect(TWITCH_CLIENT_ID).toBe("vog5xlub7gikyjfoseohp2uo33di6x");
    expect([...TWITCH_SCOPES]).toEqual(["user:read:chat"]);
  });
});

describe("buildAuthorizeUrl", () => {
  const url = new URL(buildAuthorizeUrl(STATE));

  it("vise l'endpoint d'autorisation Twitch en flux « token » (sans secret)", () => {
    expect(url.origin + url.pathname).toBe("https://id.twitch.tv/oauth2/authorize");
    expect(url.searchParams.get("response_type")).toBe("token");
    expect(url.searchParams.get("client_id")).toBe(TWITCH_CLIENT_ID);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:4000");
    expect(url.searchParams.get("scope")).toBe("user:read:chat");
    expect(url.searchParams.get("state")).toBe(STATE);
  });

  it("n'embarque aucun secret", () => {
    expect(url.search.toLowerCase()).not.toContain("secret");
    expect([...url.searchParams.keys()].sort()).toEqual(["client_id", "force_verify", "redirect_uri", "response_type", "scope", "state"]);
  });
});

describe("generateState", () => {
  it("est aléatoire, assez long, et de format sûr", () => {
    const a = generateState();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(generateState()).not.toBe(a);
  });
});

describe("statesMatch", () => {
  it("n'accepte que l'égalité exacte", () => {
    expect(statesMatch(STATE, STATE)).toBe(true);
    expect(statesMatch(STATE, STATE + "0")).toBe(false);
    expect(statesMatch(STATE, "x".repeat(STATE.length))).toBe(false);
    expect(statesMatch(STATE, null)).toBe(false);
    expect(statesMatch(STATE, "")).toBe(false);
  });
});

describe("parseCallbackPayload", () => {
  it("accepte un jeton bien formé et sépare les permissions", () => {
    expect(parseCallbackPayload({ access_token: TOKEN, scope: "user:read:chat", token_type: "bearer", state: STATE })).toEqual({
      kind: "token",
      accessToken: TOKEN,
      scopes: ["user:read:chat"],
      state: STATE,
    });
  });

  it("accepte une réponse d'erreur OAuth (access_denied) et nettoie les caractères de contrôle", () => {
    const parsed = parseCallbackPayload({ error: "access_denied", error_description: "The user\u0000 denied you access", state: STATE });
    expect(parsed).toEqual({ kind: "error", error: "access_denied", description: "The user  denied you access", state: STATE });
  });

  it("rejette tout ce qui est mal formé (jamais d'exception)", () => {
    const bad: unknown[] = [
      null, undefined, "x", 42, [], {},
      { access_token: TOKEN },                                   // pas de state
      { access_token: TOKEN, state: "court" },                   // state trop court
      { access_token: "a b c", state: STATE },                   // caractères interdits
      { access_token: "x".repeat(200), state: STATE },           // trop long
      { access_token: TOKEN, state: STATE, token_type: "mac" },  // type inattendu
      { access_token: 123, state: STATE },
      { access_token: TOKEN, state: STATE, scope: "x".repeat(600) },
      { error: "", state: STATE },
    ];
    for (const body of bad) expect(parseCallbackPayload(body), JSON.stringify(body)).toBeNull();
  });
});

describe("oauthErrorToTwitchError", () => {
  it("distingue le refus de l'utilisateur des autres erreurs", () => {
    expect(oauthErrorToTwitchError("access_denied", "").code).toBe("access_denied");
    const other = oauthErrorToTwitchError("redirect_mismatch", "Parameter redirect_uri does not match");
    expect(other.code).toBe("oauth_error");
    expect(other.message).toContain("http://localhost:4000");
    expect(other.message).toContain("redirect_mismatch");
  });
});

describe("interpretValidation", () => {
  const good = { client_id: TWITCH_CLIENT_ID, login: "adil", scopes: ["user:read:chat"], user_id: "42", expires_in: 5000 };

  it("accepte un jeton valide de notre application", () => {
    const r = interpretValidation(200, good);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.info).toEqual({ clientId: TWITCH_CLIENT_ID, userId: "42", login: "adil", scopes: ["user:read:chat"], expiresIn: 5000 });
  });

  it("401 = jeton expiré ou révoqué", () => {
    const r = interpretValidation(401, { status: 401, message: "invalid access token" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.unauthorized).toBe(true);
      expect(r.error.code).toBe("token_invalid");
    }
  });

  it("refuse un jeton émis pour une autre application", () => {
    const r = interpretValidation(200, { ...good, client_id: "autre" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("wrong_client");
  });

  it("refuse un jeton sans la permission de lire le chat", () => {
    const r = interpretValidation(200, { ...good, scopes: ["user:read:email"] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("missing_scope");
  });

  it("une erreur serveur n'est PAS une révocation (on ne doit pas effacer la session)", () => {
    const r = interpretValidation(503, null);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.unauthorized).toBe(false);
      expect(r.error.code).toBe("network");
    }
  });

  it("réponse 200 inattendue", () => {
    const r = interpretValidation(200, { hello: "world" });
    expect(r.ok).toBe(false);
  });
});
