import { describe, it, expect } from "vitest";
import { accountStatus, channelLabel, chatStatus, describeTokenExpiry, isOtherChannel } from "@/utils/twitch-ui";
import { validatePort } from "@/utils/ui-helpers";

describe("describeTokenExpiry", () => {
  const now = 1_000_000_000;
  it("jours, heures, minutes", () => {
    expect(describeTokenExpiry(now + 58 * 86_400_000, now)).toContain("58 jours");
    expect(describeTokenExpiry(now + 86_400_000, now)).toContain("1 jour.");
    expect(describeTokenExpiry(now + 5 * 3_600_000, now)).toContain("5 h");
    expect(describeTokenExpiry(now + 30_000, now)).toContain("1 min");
  });
  it("expiré ou inconnu", () => {
    expect(describeTokenExpiry(now - 1, now)).toContain("expiré");
    expect(describeTokenExpiry(null, now)).toContain("aucune date");
  });
});

describe("statuts", () => {
  it("compte", () => {
    expect(accountStatus({ status: "connected" }).tone).toBe("ok");
    expect(accountStatus({ status: "authorizing" }).busy).toBe(true);
    expect(accountStatus({ status: "disconnected" }).label).toBe("Non connecté");
  });
  it("chat : inactif tant que le compte n'est pas connecté", () => {
    expect(chatStatus({ status: "disconnected", chat: "live" }).label).toBe("Chat inactif");
    expect(chatStatus({ status: "connected", chat: "live" }).tone).toBe("ok");
    expect(chatStatus({ status: "connected", chat: "reconnecting" }).tone).toBe("warn");
  });
});

describe("port de l'overlay musical", () => {
  it("le port 4000 est réservé à Twitch", () => {
    expect(validatePort(4000).ok).toBe(false);
    expect(validatePort("4000").ok).toBe(false);
    expect(validatePort(3000).ok).toBe(true);
    expect(validatePort(4001).ok).toBe(true);
  });
});

describe("chaîne affichée", () => {
  const me = { id: "1", login: "moi", displayName: "Moi", profileImageUrl: null };
  const other = { id: "2", login: "autre", displayName: "Autre", profileImageUrl: null };
  it("libellé : chaîne résolue, sinon pseudo demandé, sinon la sienne", () => {
    expect(channelLabel({ channel: other, channelLogin: "autre", account: me })).toBe("Autre");
    expect(channelLabel({ channel: null, channelLogin: "autre", account: me })).toBe("autre");
    expect(channelLabel({ channel: null, channelLogin: null, account: me })).toBe("Moi");
    expect(channelLabel({ channel: null, channelLogin: null, account: null })).toBe("Votre chaîne");
  });
  it("détecte une chaîne différente du compte connecté", () => {
    expect(isOtherChannel({ channel: other, account: me })).toBe(true);
    expect(isOtherChannel({ channel: me, account: me })).toBe(false);
    expect(isOtherChannel({ channel: null, account: me })).toBe(false);
  });
});
