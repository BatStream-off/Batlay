import { describe, it, expect } from "vitest";
import { TwitchAuth, type AuthDeps, type AuthStatePatch, type TwitchSession } from "../electron/services/twitch/twitch-auth";
import type { StoredTwitchSession, TokenStorage } from "../electron/services/twitch/twitch-token-store";
import { TWITCH_CLIENT_ID } from "../electron/shared/twitch";

const TOKEN = "abcdefghijklmnopqrstuvwxyz0123";
const ACCOUNT = { id: "42", login: "adil", displayName: "Adil", profileImageUrl: "https://static-cdn.jtvnw.net/p.png" };
const flush = () => new Promise((r) => setTimeout(r, 5));

function setup(opts: { validate?: () => Response | Promise<Response>; saveOk?: boolean; stored?: StoredTwitchSession | null; extra?: Partial<AuthDeps> } = {}) {
  const patches: AuthStatePatch[] = [];
  const opened: string[] = [];
  const fetched: { url: string; init?: any }[] = [];
  const sessions: TwitchSession[] = [];
  let loggedOut = 0;
  let stored: StoredTwitchSession | null = opts.stored ?? null;
  const storage: TokenStorage = {
    save: (s) => { if (opts.saveOk === false) return false; stored = s; return true; },
    load: () => stored,
    clear: () => { stored = null; },
  };
  const okValidate = () =>
    new Response(JSON.stringify({ client_id: TWITCH_CLIENT_ID, login: "adil", scopes: ["user:read:chat"], user_id: "42", expires_in: 5_000_000 }), { status: 200 });
  const fetchFn = (async (url: string, init?: any) => {
    fetched.push({ url, init });
    if (url.includes("/oauth2/validate")) return (opts.validate ?? okValidate)();
    if (url.includes("/helix/users"))
      return new Response(JSON.stringify({ data: [{ display_name: "Adil", profile_image_url: ACCOUNT.profileImageUrl }] }), { status: 200 });
    return new Response("", { status: 200 });
  }) as unknown as typeof fetch;
  const auth = new TwitchAuth({
    fetchFn, storage, now: () => 1_000_000,
    openExternal: async (u) => { opened.push(u); },
    onChange: (p) => patches.push(p),
    onLoggedIn: (s) => sessions.push(s),
    onLoggedOut: () => { loggedOut++; },
    ...opts.extra,
  });
  const stateOf = () => new URL(opened[0]).searchParams.get("state")!;
  const last = (key: keyof AuthStatePatch) => [...patches].reverse().find((p) => key in p)?.[key];
  return { auth, patches, opened, fetched, sessions, storage, getStored: () => stored, loggedOut: () => loggedOut, stateOf, last };
}

describe("TwitchAuth : connexion", () => {
  it("ouvre le navigateur, puis accepte le callback au bon state et mémorise la session", async () => {
    const t = setup();
    await t.auth.begin();
    expect(new URL(t.opened[0]).host).toBe("id.twitch.tv");
    expect(t.last("status")).toBe("authorizing");

    const res = await t.auth.handleCallback({ kind: "token", accessToken: TOKEN, scopes: ["user:read:chat"], state: t.stateOf() });
    expect(res.ok).toBe(true);
    expect(t.last("status")).toBe("connected");
    expect(t.sessions[0].account).toEqual(ACCOUNT);
    expect(t.getStored()?.token).toBe(TOKEN);
    expect(t.sessions[0].expiresAt).toBe(1_000_000 + 5_000_000_000);
    expect(t.auth.getToken()).toBe(TOKEN);
    t.auth.dispose();
  });

  it("ignore un state erroné SANS annuler la connexion en cours", async () => {
    const t = setup();
    await t.auth.begin();
    const bad = await t.auth.handleCallback({ kind: "token", accessToken: TOKEN, scopes: [], state: "x".repeat(48) });
    expect(bad.ok).toBe(false);
    expect(t.auth.hasPendingAuthorization()).toBe(true);
    expect(t.sessions).toEqual([]);
    const good = await t.auth.handleCallback({ kind: "token", accessToken: TOKEN, scopes: [], state: t.stateOf() });
    expect(good.ok).toBe(true);
    t.auth.dispose();
  });

  it("refuse un callback quand aucune connexion n'est en attente", async () => {
    const t = setup();
    const res = await t.auth.handleCallback({ kind: "token", accessToken: TOKEN, scopes: [], state: "a".repeat(48) });
    expect(res.ok).toBe(false);
    expect(t.sessions).toEqual([]);
  });

  it("un state ne sert qu'une fois", async () => {
    const t = setup();
    await t.auth.begin();
    const p = { kind: "token" as const, accessToken: TOKEN, scopes: [], state: t.stateOf() };
    expect((await t.auth.handleCallback(p)).ok).toBe(true);
    expect((await t.auth.handleCallback(p)).ok).toBe(false);
    t.auth.dispose();
  });

  it("l'utilisateur refuse : erreur access_denied, aucune session", async () => {
    const t = setup();
    await t.auth.begin();
    const res = await t.auth.handleCallback({ kind: "error", error: "access_denied", description: "denied", state: t.stateOf() });
    expect(res.ok).toBe(false);
    expect((t.last("error") as any).code).toBe("access_denied");
    expect(t.last("status")).toBe("disconnected");
    expect(t.sessions).toEqual([]);
  });

  it("jeton rejeté par /validate : rien n'est mémorisé", async () => {
    const t = setup({ validate: () => new Response("{}", { status: 401 }) });
    await t.auth.begin();
    const res = await t.auth.handleCallback({ kind: "token", accessToken: TOKEN, scopes: [], state: t.stateOf() });
    expect(res.ok).toBe(false);
    expect((t.last("error") as any).code).toBe("token_invalid");
    expect(t.getStored()).toBeNull();
  });

  it("réseau coupé pendant la validation : erreur « network »", async () => {
    const t = setup({ validate: () => { throw new Error("ECONNREFUSED"); } });
    await t.auth.begin();
    await t.auth.handleCallback({ kind: "token", accessToken: TOKEN, scopes: [], state: t.stateOf() });
    expect((t.last("error") as any).code).toBe("network");
  });

  it("délai dépassé sans réponse", async () => {
    const t = setup({ extra: { authTimeoutMs: 15 } });
    await t.auth.begin();
    await new Promise((r) => setTimeout(r, 40));
    expect((t.last("error") as any).code).toBe("authorization_timeout");
    expect(t.auth.hasPendingAuthorization()).toBe(false);
  });

  it("annuler remet à zéro sans erreur", async () => {
    const t = setup();
    await t.auth.begin();
    t.auth.cancel();
    expect(t.last("status")).toBe("disconnected");
    expect(t.last("error")).toBeNull();
  });

  it("navigateur impossible à ouvrir : erreur claire", async () => {
    const t = setup({ extra: { openExternal: async () => { throw new Error("boom"); } } });
    await t.auth.begin();
    expect((t.last("error") as any).code).toBe("oauth_error");
    expect(t.auth.hasPendingAuthorization()).toBe(false);
  });

  it("chiffrement indisponible : connecté pour cette session, avec avertissement", async () => {
    const t = setup({ saveOk: false });
    await t.auth.begin();
    await t.auth.handleCallback({ kind: "token", accessToken: TOKEN, scopes: [], state: t.stateOf() });
    expect(t.last("status")).toBe("connected");
    expect((t.last("warning") as any).code).toBe("storage_unavailable");
    t.auth.dispose();
  });
});

describe("TwitchAuth : restauration, contrôle et déconnexion", () => {
  const stored: StoredTwitchSession = { token: TOKEN, account: ACCOUNT, expiresAt: 123 };

  it("restaure une session valide sans ouvrir le navigateur", async () => {
    const t = setup({ stored });
    await t.auth.restore();
    expect(t.last("status")).toBe("connected");
    expect(t.opened).toEqual([]);
    expect(t.sessions.length).toBe(1);
    t.auth.dispose();
  });

  it("jeton expiré au démarrage : effacé, l'utilisateur est invité à se reconnecter", async () => {
    const t = setup({ stored, validate: () => new Response("{}", { status: 401 }) });
    await t.auth.restore();
    expect(t.getStored()).toBeNull();
    expect((t.last("error") as any).code).toBe("token_expired");
    expect(t.last("status")).toBe("disconnected");
  });

  it("hors ligne au démarrage : le jeton est CONSERVÉ et la restauration réessayée", async () => {
    let online = false;
    const t = setup({
      stored,
      validate: () => (online ? new Response(JSON.stringify({ client_id: TWITCH_CLIENT_ID, login: "adil", scopes: ["user:read:chat"], user_id: "42", expires_in: 100 }), { status: 200 }) : new Response("", { status: 503 })),
      extra: { restoreRetryMs: 20 },
    });
    await t.auth.restore();
    expect(t.getStored()).not.toBeNull();
    expect((t.last("error") as any).code).toBe("network");
    online = true;
    await new Promise((r) => setTimeout(r, 60));
    expect(t.last("status")).toBe("connected");
    t.auth.dispose();
  });

  it("le contrôle horaire détecte une révocation et termine la session", async () => {
    let revoked = false;
    const t = setup({
      stored,
      validate: () => revoked ? new Response("{}", { status: 401 }) : new Response(JSON.stringify({ client_id: TWITCH_CLIENT_ID, login: "adil", scopes: ["user:read:chat"], user_id: "42", expires_in: 100 }), { status: 200 }),
    });
    await t.auth.restore();
    revoked = true;
    await t.auth.revalidate();
    expect(t.auth.getToken()).toBeNull();
    expect(t.getStored()).toBeNull();
    expect(t.loggedOut()).toBe(1);
    expect((t.last("error") as any).code).toBe("token_expired");
  });

  it("un incident réseau lors du contrôle ne déconnecte pas", async () => {
    let down = false;
    const t = setup({ stored, validate: () => down ? new Response("", { status: 500 }) : new Response(JSON.stringify({ client_id: TWITCH_CLIENT_ID, login: "adil", scopes: ["user:read:chat"], user_id: "42", expires_in: 100 }), { status: 200 }) });
    await t.auth.restore();
    down = true;
    await t.auth.revalidate();
    expect(t.auth.getToken()).toBe(TOKEN);
    t.auth.dispose();
  });

  it("déconnecter : efface le jeton local et le révoque chez Twitch", async () => {
    const t = setup({ stored });
    await t.auth.restore();
    await t.auth.disconnect();
    await flush();
    expect(t.getStored()).toBeNull();
    expect(t.auth.getToken()).toBeNull();
    expect(t.last("status")).toBe("disconnected");
    const revoke = t.fetched.find((f) => f.url.includes("/oauth2/revoke"))!;
    expect(String(revoke.init.body)).toContain(`token=${TOKEN}`);
    expect(String(revoke.init.body)).toContain(`client_id=${TWITCH_CLIENT_ID}`);
    expect(String(revoke.init.body)).not.toContain("secret");
    expect(t.loggedOut()).toBe(1);
  });
});
