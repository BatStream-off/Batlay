import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DemoProvider } from "@/services/demo-provider";

describe("DemoProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("n'a pas de morceau tant qu'il n'est pas connecté", async () => {
    const provider = new DemoProvider();
    expect(await provider.getCurrentTrack()).toBeNull();
  });

  it("expose un morceau dès la connexion", async () => {
    const provider = new DemoProvider();
    await provider.connect();
    const track = await provider.getCurrentTrack();
    expect(track).not.toBeNull();
    expect(track?.title).toBe("Blinding Lights");
    expect(track?.isPlaying).toBe(true);
  });

  it("fait progresser la lecture au fil du temps", async () => {
    const provider = new DemoProvider();
    await provider.connect();
    vi.advanceTimersByTime(5000);
    const track = await provider.getCurrentTrack();
    expect(track?.progress).toBe(5000);
  });

  it("passe au morceau suivant avec next()", async () => {
    const provider = new DemoProvider();
    await provider.connect();
    provider.next();
    const track = await provider.getCurrentTrack();
    expect(track?.title).toBe("Starboy");
    expect(track?.progress).toBe(0);
  });

  it("bascule play/pause sans faire progresser la lecture en pause", async () => {
    const provider = new DemoProvider();
    await provider.connect();
    provider.playPause(); // pause
    vi.advanceTimersByTime(5000);
    const track = await provider.getCurrentTrack();
    expect(track?.isPlaying).toBe(false);
    expect(track?.progress).toBe(0);
  });

  it("notifie les abonnés via onStateChange", async () => {
    const provider = new DemoProvider();
    const listener = vi.fn();
    provider.onStateChange(listener);
    await provider.connect();
    expect(listener).toHaveBeenCalled();
  });
});
