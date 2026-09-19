import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// window n'existe pas dans l'environnement de test ("node") : on le simule
// comme dans le renderer Electron réel, où window.batlay est exposé par le
// preload script.
beforeEach(() => {
  (globalThis as unknown as { window: unknown }).window = {
    batlay: {
      overlay: { broadcastState: vi.fn() },
      spotify: {
        isConfigured: vi.fn().mockResolvedValue(true),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        isSessionRestorable: vi.fn().mockResolvedValue(false),
        getCurrentlyPlaying: vi.fn().mockResolvedValue(null),
      },
    },
  };
});

afterEach(() => {
  delete (globalThis as unknown as { window?: unknown }).window;
  vi.resetModules();
});

describe("useMusicStore (intégration avec DemoProvider)", () => {
  it("connectDemo() peuple playbackState.track (pas 'Nothing is playing')", async () => {
    const { useMusicStore } = await import("@/stores/useMusicStore");
    await useMusicStore.getState().connectDemo();
    const { playbackState, activeProviderId, error } = useMusicStore.getState();
    expect(error).toBeNull();
    expect(activeProviderId).toBe("demo");
    expect(playbackState.track).not.toBeNull();
    expect(playbackState.track?.title).toBe("Blinding Lights");
  });

  it("diffuse chaque état vers window.batlay.overlay.broadcastState", async () => {
    const { useMusicStore } = await import("@/stores/useMusicStore");
    await useMusicStore.getState().connectDemo();
    const win = (globalThis as unknown as { window: { batlay: { overlay: { broadcastState: ReturnType<typeof vi.fn> } } } }).window;
    expect(win.batlay.overlay.broadcastState).toHaveBeenCalled();
  });

  it("disconnect() puis reconnexion demo fonctionne toujours", async () => {
    const { useMusicStore } = await import("@/stores/useMusicStore");
    await useMusicStore.getState().connectDemo();
    await useMusicStore.getState().disconnect();
    expect(useMusicStore.getState().playbackState.track).toBeNull();
    await useMusicStore.getState().connectDemo();
    expect(useMusicStore.getState().playbackState.track).not.toBeNull();
  });
});
