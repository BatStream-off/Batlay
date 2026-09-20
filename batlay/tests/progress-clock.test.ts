import { describe, it, expect } from "vitest";
import { ProgressClock, CLOCK_TUNING, sampleFromPlaybackState, type ProgressSample } from "@/utils/progress-clock";
import type { PlaybackState } from "@/types/track";

const sample = (over: Partial<ProgressSample> = {}): ProgressSample => ({
  trackId: "t1",
  progressMs: 10_000,
  durationMs: 200_000,
  isPlaying: true,
  sampledAtMs: 0,
  ...over,
});

describe("ProgressClock — interpolation de base", () => {
  it("vaut 0 avant toute mesure", () => {
    expect(new ProgressClock().read(1234)).toBe(0);
  });

  it("avance en temps réel entre deux mesures", () => {
    const c = new ProgressClock();
    c.sync(sample({ sampledAtMs: 1000 }), 1000);
    expect(c.read(1000)).toBe(10_000);
    expect(c.read(3500)).toBe(12_500);
  });

  it("compense la latence : une mesure vieille de 400 ms à l'arrivée est rattrapée", () => {
    const c = new ProgressClock();
    // mesurée à t=1000, reçue à t=1400 : la lecture est déjà 400 ms plus loin
    c.sync(sample({ sampledAtMs: 1000 }), 1400);
    expect(c.read(1400)).toBe(10_400);
  });

  it("ne dépasse jamais la durée du morceau (fin de morceau)", () => {
    const c = new ProgressClock();
    c.sync(sample({ progressMs: 199_000, sampledAtMs: 0 }), 0);
    expect(c.read(500)).toBe(199_500);
    expect(c.read(60_000)).toBe(200_000);
  });

  it("n'applique aucun plafond si la durée est inconnue (0)", () => {
    const c = new ProgressClock();
    c.sync(sample({ durationMs: 0, progressMs: 5000, sampledAtMs: 0 }), 0);
    expect(c.read(20_000)).toBe(25_000);
  });

  it("reset() efface tout", () => {
    const c = new ProgressClock();
    c.sync(sample(), 0);
    c.reset();
    expect(c.read(5000)).toBe(0);
  });
});

describe("ProgressClock — pas de saut ni de retour en arrière", () => {
  it("ignore le bruit de mesure (< zone morte) : la trajectoire ne bouge pas", () => {
    const c = new ProgressClock();
    c.sync(sample({ sampledAtMs: 0 }), 0);
    const before = c.read(2000);
    // nouvelle mesure avec 80 ms d'écart avec la position affichée
    c.sync(sample({ progressMs: 10_000 + 2000 + 80, sampledAtMs: 2000 }), 2000);
    expect(c.read(2000)).toBe(before);
    expect(c.read(3000)).toBe(before + 1000);
  });

  it("absorbe une dérive avance/retard SANS saut à l'instant de la synchronisation", () => {
    const c = new ProgressClock();
    c.sync(sample({ sampledAtMs: 0 }), 0);
    const displayed = c.read(2000);
    // le provider dit que la lecture est 700 ms PLUS AVANCÉE que prévu
    c.sync(sample({ progressMs: 10_000 + 2000 + 700, sampledAtMs: 2000 }), 2000);
    expect(c.read(2000)).toBe(displayed); // continuité parfaite
    expect(c.read(2000 + 5000)).toBeCloseTo(10_000 + 2000 + 700 + 5000, 0); // rattrapé ensuite
  });

  it("dérive dans l'autre sens : la barre ralentit mais ne recule JAMAIS", () => {
    const c = new ProgressClock();
    c.sync(sample({ sampledAtMs: 0 }), 0);
    // la lecture est en fait 1500 ms EN RETARD sur l'affichage
    c.sync(sample({ progressMs: 10_000 + 2000 - 1500, sampledAtMs: 2000 }), 2000);
    let previous = c.read(2000);
    for (let t = 2000; t <= 12_000; t += 16) {
      const now = c.read(t);
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
    // et finit par se caler sur la vraie position
    expect(c.read(12_000)).toBeCloseTo(10_000 + 2000 - 1500 + 10_000, 0);
  });

  it("un vrai seek (> seuil) fait sauter la barre, avant comme arrière", () => {
    const c = new ProgressClock();
    c.sync(sample({ sampledAtMs: 0 }), 0);
    c.sync(sample({ progressMs: 120_000, sampledAtMs: 2000 }), 2000);
    expect(c.read(2000)).toBe(120_000);
    c.sync(sample({ progressMs: 30_000, sampledAtMs: 4000 }), 4000);
    expect(c.read(4000)).toBe(30_000);
  });

  it("changement de morceau : saut franc à la nouvelle position, sans transition depuis l'ancienne", () => {
    const c = new ProgressClock();
    c.sync(sample({ progressMs: 190_000, sampledAtMs: 0 }), 0);
    c.sync(sample({ trackId: "t2", progressMs: 0, durationMs: 180_000, sampledAtMs: 3000 }), 3000);
    expect(c.read(3000)).toBe(0);
    expect(c.read(4000)).toBe(1000);
  });

  it("répétition du même morceau (id identique, retour à 0) : saut franc", () => {
    const c = new ProgressClock();
    c.sync(sample({ progressMs: 199_500, sampledAtMs: 0 }), 0);
    c.sync(sample({ progressMs: 300, sampledAtMs: 1000 }), 1000);
    expect(c.read(1000)).toBe(300);
  });

  it("ignore une mesure livrée dans le désordre (plus ancienne que la dernière appliquée)", () => {
    const c = new ProgressClock();
    c.sync(sample({ progressMs: 50_000, sampledAtMs: 5000 }), 5000);
    const before = c.read(6000);
    c.sync(sample({ progressMs: 10_000, sampledAtMs: 1000 }), 6000); // vieille mesure arrivée en retard
    expect(c.read(6000)).toBe(before);
  });
});

describe("ProgressClock — pause et reprise", () => {
  it("la pause fige la barre", () => {
    const c = new ProgressClock();
    c.sync(sample({ sampledAtMs: 0 }), 0);
    c.sync(sample({ isPlaying: false, progressMs: 12_000, sampledAtMs: 2000 }), 2000);
    const frozen = c.read(2000);
    expect(c.read(9000)).toBe(frozen);
  });

  it("ne fait PAS reculer la barre de la latence de détection de la pause", () => {
    const c = new ProgressClock();
    c.sync(sample({ sampledAtMs: 0 }), 0);
    // pause réelle à t=800 (position 10 800), détectée seulement à t=2000 :
    // l'affichage est à 12 000, la vraie position figée est 10 800.
    const displayed = c.read(2000);
    c.sync(sample({ isPlaying: false, progressMs: 10_800, sampledAtMs: 2000 }), 2000);
    expect(c.read(2000)).toBe(displayed);
    expect(c.read(5000)).toBe(displayed);
  });

  it("reprise : repart de la position figée puis se recale en douceur", () => {
    const c = new ProgressClock();
    c.sync(sample({ isPlaying: false, progressMs: 20_000, sampledAtMs: 0 }), 0);
    expect(c.read(3000)).toBe(20_000);
    c.sync(sample({ isPlaying: true, progressMs: 20_000, sampledAtMs: 3000 }), 3000);
    expect(c.read(3000)).toBe(20_000);
    expect(c.read(4000)).toBe(21_000);
  });

  it("pause avec un vrai déplacement (> tolérance) : la position est corrigée", () => {
    const c = new ProgressClock();
    c.sync(sample({ isPlaying: false, progressMs: 20_000, sampledAtMs: 0 }), 0);
    c.sync(sample({ isPlaying: false, progressMs: 50_000, sampledAtMs: 1000 }), 1000);
    expect(c.read(1000)).toBe(50_000);
  });
});

describe("ProgressClock — simulation d'un polling réaliste et bruité", () => {
  // PRNG déterministe : le test doit donner le même résultat à chaque exécution.
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  it("60 s de lecture, poll toutes les 2 s avec latence 80–900 ms : jamais de recul, pas de saut, erreur faible", () => {
    const random = rng(42);
    const clock = new ProgressClock();
    const truth = (t: number) => 30_000 + t; // lecture à vitesse normale, position réelle
    const arrivals: { arriveAt: number; measuredAt: number }[] = [];
    for (let poll = 0; poll <= 60_000; poll += 2000) {
      const latency = 80 + random() * 820;
      arrivals.push({ measuredAt: poll + latency / 2, arriveAt: poll + latency });
    }

    let previous = -Infinity;
    let worstStep = 0;
    let worstError = 0;
    let next = 0;
    for (let t = 0; t <= 60_000; t += 16) {
      while (next < arrivals.length && arrivals[next].arriveAt <= t) {
        const { measuredAt, arriveAt } = arrivals[next++];
        clock.sync(
          { trackId: "t", progressMs: truth(measuredAt), durationMs: 600_000, isPlaying: true, sampledAtMs: measuredAt },
          arriveAt
        );
      }
      if (next === 0) continue;
      const shown = clock.read(t);
      if (previous !== -Infinity) {
        expect(shown).toBeGreaterThanOrEqual(previous); // jamais en arrière
        worstStep = Math.max(worstStep, shown - previous);
      }
      previous = shown;
      if (t > 4000) worstError = Math.max(worstError, Math.abs(shown - truth(t)));
    }
    // vitesse max 1,5x => 24 ms par image de 16 ms ; aucun saut
    expect(worstStep).toBeLessThanOrEqual(16 * 1.5 + 1);
    expect(worstError).toBeLessThan(CLOCK_TUNING.deadZoneMs * 4);
  });
});

describe("sampleFromPlaybackState", () => {
  const state: PlaybackState = {
    track: { id: "a", title: "T", artist: "A", duration: 100_000, progress: 5000, isPlaying: true },
    isPlaying: true,
    updatedAt: 1_000_000,
  };

  it("place la mesure à `now - âge` (âge = maintenant - updatedAt)", () => {
    const s = sampleFromPlaybackState(state, { nowMs: 500, nowEpochMs: 1_000_300 });
    expect(s?.sampledAtMs).toBe(200);
  });

  it("avec sentAt (WebSocket), l'âge se calcule dans l'horloge de Batlay, pas celle d'OBS", () => {
    // horloge d'OBS décalée de +1 h : elle ne doit avoir AUCUN effet
    const s = sampleFromPlaybackState(state, { nowMs: 500, nowEpochMs: 1_000_300 + 3_600_000, sentAtEpochMs: 1_000_250 });
    expect(s?.sampledAtMs).toBe(250);
  });

  it("aucun morceau -> null", () => {
    expect(sampleFromPlaybackState({ track: null, isPlaying: false, updatedAt: 0 }, { nowMs: 0, nowEpochMs: 0 })).toBeNull();
  });
});
