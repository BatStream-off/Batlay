import { describe, it, expect } from "vitest";
import { parseTwitchChannel, twitchError } from "../electron/shared/twitch";
import { buildSubscriptionBody } from "../electron/services/twitch/twitch-eventsub";
import { TwitchChatClient, fetchChannelByLogin, type SocketLike } from "../electron/services/twitch/twitch-chat";

describe("parseTwitchChannel : pseudo ou lien", () => {
  it("accepte un pseudo, avec @ ou #, en majuscules ou avec espaces", () => {
    expect(parseTwitchChannel("ninja")).toBe("ninja");
    expect(parseTwitchChannel("  @Ninja ")).toBe("ninja");
    expect(parseTwitchChannel("#Some_User_9")).toBe("some_user_9");
  });
  it("accepte les liens de chaîne, avec ou sans schéma, www, m., sous-page", () => {
    for (const url of [
      "https://www.twitch.tv/ninja",
      "http://twitch.tv/Ninja/",
      "twitch.tv/ninja",
      "www.twitch.tv/ninja?sr=a",
      "https://m.twitch.tv/ninja/videos",
      "https://www.twitch.tv/ninja#top",
    ]) {
      expect(parseTwitchChannel(url), url).toBe("ninja");
    }
  });
  it("accepte les liens de chat pop-out / modération / intégré", () => {
    expect(parseTwitchChannel("https://www.twitch.tv/popout/ninja/chat")).toBe("ninja");
    expect(parseTwitchChannel("https://www.twitch.tv/moderator/ninja")).toBe("ninja");
    expect(parseTwitchChannel("https://www.twitch.tv/embed/ninja/chat?parent=x.com")).toBe("ninja");
  });
  it("refuse tout le reste", () => {
    for (const bad of [
      "",
      "   ",
      "deux mots",
      "pseudo/avec/slash",
      "a".repeat(26),
      "nom-avec-tiret",
      "https://www.twitch.tv/",
      "https://www.twitch.tv/directory",
      "https://www.twitch.tv/videos/123456",
      "https://autre-site.com/ninja",
      "https://twitch.tv.evil.com/ninja",
      "https://nottwitch.tv/ninja",
      "<script>",
    ]) {
      expect(parseTwitchChannel(bad), bad).toBeNull();
    }
  });
});

describe("messages d'erreur de chaîne", () => {
  it("chaîne introuvable : cite le pseudo", () => {
    const e = twitchError("channel_not_found", "zzz");
    expect(e.code).toBe("channel_not_found");
    expect(e.message).toContain("zzz");
  });
  it("saisie non reconnue", () => {
    expect(twitchError("invalid_channel").message).toContain("twitch.tv/");
  });
});

describe("abonnement à la chaîne d'un autre streamer", () => {
  it("par défaut : sa propre chaîne (comportement inchangé)", () => {
    expect(buildSubscriptionBody("channel.chat.message", "7", "S").condition).toEqual({ broadcaster_user_id: "7", user_id: "7" });
  });
  it("chaîne différente : la chaîne visée est le broadcaster, le compte connecté reste le lecteur", () => {
    expect(buildSubscriptionBody("channel.chat.message", "7", "S", "42").condition).toEqual({
      broadcaster_user_id: "42",
      user_id: "7",
    });
  });
  it("le client de chat s'abonne avec les deux identifiants", async () => {
    const bodies: any[] = [];
    let socket!: { handlers: Record<string, ((...a: any[]) => void)[]> };
    const createSocket = (): SocketLike => {
      const handlers: Record<string, ((...a: any[]) => void)[]> = {};
      socket = { handlers };
      return { on: (e, fn) => ((handlers[e] ??= []).push(fn), undefined), close: () => undefined, terminate: () => undefined };
    };
    const fetchFn = (async (_u: string, init: any) => {
      bodies.push(JSON.parse(init.body));
      return new Response("{}", { status: 202 });
    }) as unknown as typeof fetch;
    const client = new TwitchChatClient({
      clientId: "CID", getToken: () => "TOKEN", fetchFn, createSocket, emit: () => undefined, onStatus: () => undefined, onFatal: () => undefined,
    });
    client.start("7", "42");
    for (const fn of socket.handlers.message)
      fn(Buffer.from(JSON.stringify({ metadata: { message_id: "m", message_type: "session_welcome" }, payload: { session: { id: "S", keepalive_timeout_seconds: 10 } } })));
    await new Promise((r) => setTimeout(r, 5));
    expect(bodies.length).toBe(4);
    for (const b of bodies) expect(b.condition).toEqual({ broadcaster_user_id: "42", user_id: "7" });
    client.stop();
  });
});

describe("fetchChannelByLogin", () => {
  const user = { id: "42", login: "ninja", display_name: "Ninja", profile_image_url: "https://static-cdn.jtvnw.net/p.png" };
  const reply = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("trouve la chaîne et interroge Twitch par pseudo", async () => {
    let called = "";
    let headers: any;
    const fetchFn = (async (u: string, init: any) => {
      called = u;
      headers = init.headers;
      return new Response(JSON.stringify({ data: [user] }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await fetchChannelByLogin(fetchFn, "TOKEN", "CID", "ninja");
    expect(r).toEqual({ ok: true, account: { id: "42", login: "ninja", displayName: "Ninja", profileImageUrl: user.profile_image_url } });
    expect(called).toBe("https://api.twitch.tv/helix/users?login=ninja");
    expect(headers).toEqual({ Authorization: "Bearer TOKEN", "Client-Id": "CID" });
  });
  it("chaîne inexistante (liste vide ou 400)", async () => {
    expect(await fetchChannelByLogin(reply(200, { data: [] }), "T", "C", "zzz")).toEqual({ ok: false, reason: "not_found" });
    expect(await fetchChannelByLogin(reply(400), "T", "C", "zzz")).toEqual({ ok: false, reason: "not_found" });
  });
  it("jeton refusé, réseau coupé, réponse d'erreur", async () => {
    expect(await fetchChannelByLogin(reply(401), "T", "C", "a")).toEqual({ ok: false, reason: "unauthorized" });
    expect(await fetchChannelByLogin(reply(500), "T", "C", "a")).toEqual({ ok: false, reason: "network" });
    const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await fetchChannelByLogin(boom, "T", "C", "a")).toEqual({ ok: false, reason: "network" });
  });
  it("n'accepte pas une photo de profil hors https", async () => {
    const r = await fetchChannelByLogin(reply(200, { data: [{ ...user, profile_image_url: "http://x/p.png" }] }), "T", "C", "ninja");
    expect(r.ok && r.account.profileImageUrl).toBeNull();
  });
});
