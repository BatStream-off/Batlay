import { describe, it, expect } from "vitest";
import {
  DEFAULT_OVERLAY_ANIMATION,
  ENTER_EFFECTS,
  EXIT_EFFECTS,
  LOOP_EFFECTS,
  MOTION_PRESETS,
  applyMotionPreset,
  clampDelay,
  clampDuration,
  matchMotionPreset,
  normalizeComponentAnimation,
  normalizeEasing,
  normalizeLoop,
  normalizeOverlayAnimation,
  resolveComponentMotion,
  type MotionSpec,
} from "@/animation/config";
import { ENTER_EFFECT_DEFS, EXIT_EFFECT_DEFS, LOOP_EFFECT_DEFS, getEnterEffect, getExitEffect, slideDistance } from "@/animation/effects";
import {
  activeChannels,
  cancelAll,
  isMotionAllowed,
  playEnter,
  playExit,
  playKeyframes,
  playLoop,
  prefersReducedMotion,
  watchReducedMotion,
} from "@/animation/engine";
import { currentLayer, initSwap, swapReducer, type SwapState } from "@/animation/swap";
import { reconcilePresence, removeLeaving, type Presence } from "@/animation/presence";
import { getPreset, listPresetIds } from "@/presets";

// ---------------------------------------------------------------------------
// Faux élément : imite element.animate() (Web Animations API) sans DOM.
// ---------------------------------------------------------------------------

interface FakeAnimation {
  keyframes: Keyframe[];
  options: KeyframeAnimationOptions;
  state: "running" | "finished" | "cancelled" | "paused";
  finished: Promise<unknown>;
  cancel(): void;
  finish(): void;
  pause(): void;
  play(): void;
}
function fakeElement() {
  const animations: FakeAnimation[] = [];
  return {
    animations,
    animate(keyframes: Keyframe[], options: KeyframeAnimationOptions) {
      let resolve!: (v: unknown) => void;
      let reject!: (e: unknown) => void;
      const a: FakeAnimation = {
        keyframes,
        options,
        state: "running",
        finished: new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        }),
        cancel() {
          if (a.state === "finished") return;
          a.state = "cancelled";
          reject(new DOMException("aborted", "AbortError"));
        },
        finish() {
          a.state = "finished";
          resolve(a);
        },
        pause() {
          a.state = "paused";
        },
        play() {
          a.state = "running";
        },
      };
      animations.push(a);
      return a;
    },
  };
}
const spec = (effect: string, extra: Partial<MotionSpec> = {}): MotionSpec => ({ effect, durationMs: 300, delayMs: 0, easing: "ease-out", intensity: 0.5, ...extra });
const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Configuration : valeurs par défaut, validation, compatibilité
// ---------------------------------------------------------------------------

describe("configuration des animations : défauts et validation", () => {
  it("absent ou illisible → valeurs par défaut complètes", () => {
    for (const raw of [undefined, null, 42, "fade", [], {}]) {
      expect(normalizeOverlayAnimation(raw), String(raw)).toEqual(DEFAULT_OVERLAY_ANIMATION);
    }
  });

  it("anciens overlays (v0.1 → v0.3.6 : enter, exit, durationMs, easing) lus tels quels, nouveaux champs par défaut", () => {
    for (const id of listPresetIds()) {
      const legacy = getPreset(id).animations;
      const n = normalizeOverlayAnimation(legacy);
      expect(n.enter, id).toBe(legacy.enter);
      expect(n.exit, id).toBe(legacy.exit);
      expect(n.durationMs, id).toBe(legacy.durationMs);
      expect(n.easing, id).toBe(normalizeEasing(legacy.easing));
      expect([n.enabled, n.delayMs, n.staggerMs, n.respectReducedMotion], id).toEqual([true, 0, 0, true]);
    }
    // Les six anciens identifiants restent des effets valides, en entrée comme en sortie.
    for (const legacy of ["fade", "slideLeft", "slideRight", "slideUp", "slideDown", "scale"]) {
      expect(ENTER_EFFECTS as readonly string[]).toContain(legacy);
      expect(EXIT_EFFECTS as readonly string[]).toContain(legacy);
    }
  });

  it("durées et délais bornés ; NaN, Infinity, négatifs et textes rejetés", () => {
    expect(clampDuration(-5)).toBe(50);
    expect(clampDuration(99_999)).toBe(3000);
    expect(clampDuration(Number.NaN)).toBe(400);
    expect(clampDuration(Infinity)).toBe(400);
    expect(clampDuration("300")).toBe(400);
    expect(clampDuration(333.6)).toBe(334);
    expect(clampDelay(-1)).toBe(0);
    expect(clampDelay(10_000)).toBe(5000);
    const n = normalizeOverlayAnimation({ enter: "explode", exit: 3, durationMs: -10, delayMs: "x", intensity: 9, staggerMs: 9000, enabled: "oui" });
    expect(n).toMatchObject({ enter: "fade", exit: "fade", durationMs: 50, delayMs: 0, intensity: 1, staggerMs: 500, enabled: true });
  });

  it("accélération : mots-clés et cubic-bezier valides seulement (le navigateur lèverait une erreur sinon)", () => {
    expect(normalizeEasing("ease-out")).toBe("ease-out");
    expect(normalizeEasing(" EASE-IN-OUT ")).toBe("ease-in-out");
    expect(normalizeEasing("cubic-bezier(0.16, 1, 0.3, 1)")).toBe("cubic-bezier(0.16, 1, 0.3, 1)");
    expect(normalizeEasing("cubic-bezier(0.34,1.56,0.64,1)")).toBe("cubic-bezier(0.34, 1.56, 0.64, 1)");
    for (const bad of ["cubic-bezier(2, 0, 0, 1)", "cubic-bezier(0,0,0)", "steps(4)", "url(x)", "ease; color: red", "", 12]) {
      expect(normalizeEasing(bad), String(bad)).toBe(DEFAULT_OVERLAY_ANIMATION.easing);
    }
  });

  it("composant : absent = « comme l'overlay », valeurs invalides corrigées, boucle désactivée par défaut", () => {
    const overlay = normalizeOverlayAnimation({ enter: "pop", exit: "blur", durationMs: 600 });
    const c = normalizeComponentAnimation(undefined, overlay);
    expect(c).toMatchObject({ mode: "inherit", enter: "pop", exit: "blur", durationMs: 600, delayMs: 0 });
    expect(c.loop.effect).toBe("none");
    expect(normalizeComponentAnimation({ mode: "bizarre", loop: "pulse" }).mode).toBe("inherit");
    expect(normalizeLoop({ effect: "rotate", periodMs: 1, repeat: 99, trigger: "souvent" })).toMatchObject({ effect: "rotate", periodMs: 600, repeat: 10, trigger: "change" });
  });
});

describe("sélection et résolution des animations", () => {
  it("hérite de l'overlay, avec décalage selon le rang et délai propre", () => {
    const m = resolveComponentMotion({ enter: "slideUp", exit: "fade", durationMs: 500, easing: "linear", delayMs: 100, staggerMs: 50 }, { delayMs: 20 }, { index: 3 });
    expect(m.enter).toEqual({ effect: "slideUp", durationMs: 500, delayMs: 100 + 150 + 20, easing: "linear", intensity: 0.5 });
    // Une sortie ne patiente jamais : l'ancienne information laisse la place tout de suite.
    expect(m.exit?.delayMs).toBe(0);
  });
  it("mode personnalisé : réglages du composant seuls", () => {
    const m = resolveComponentMotion({ enter: "fade", delayMs: 900, staggerMs: 100 }, { mode: "custom", enter: "reveal", exit: "shrink", durationMs: 250, delayMs: 30 }, { index: 5 });
    expect(m.enter).toMatchObject({ effect: "reveal", durationMs: 250, delayMs: 30 });
    expect(m.exit).toMatchObject({ effect: "shrink" });
  });
  it("désactivation : overlay désactivé, composant « aucune », mouvement réduit, effet « none »", () => {
    const none = { enter: null, exit: null, loop: null };
    expect(resolveComponentMotion({ enabled: false }, { loop: { effect: "pulse" } })).toEqual(none);
    expect(resolveComponentMotion({}, { mode: "none" })).toEqual(none);
    expect(resolveComponentMotion({}, { loop: { effect: "glow" } }, { motionAllowed: false })).toEqual(none);
    expect(resolveComponentMotion({ enter: "none", exit: "none" }, undefined)).toEqual(none);
    expect(isMotionAllowed({ enabled: true, respectReducedMotion: true }, true)).toBe(false);
    expect(isMotionAllowed({ enabled: true, respectReducedMotion: false }, true)).toBe(true);
    expect(isMotionAllowed({ enabled: false, respectReducedMotion: false }, false)).toBe(false);
  });
  it("combinaisons prêtes à l'emploi : Subtil, Fluide, Dynamique, Gaming, Sans animation", () => {
    expect(MOTION_PRESETS.map((p) => p.label)).toEqual(["Subtil", "Fluide", "Dynamique", "Gaming", "Sans animation"]);
    for (const p of MOTION_PRESETS) {
      const applied = applyMotionPreset({ respectReducedMotion: false }, p.id);
      expect(matchMotionPreset(applied), p.id).toBe(p.id);
      expect(applied.respectReducedMotion, p.id).toBe(false); // un preset ne touche pas à ce réglage
      if (p.id !== "none") expect(isMotionAllowed(applied, false), p.id).toBe(true);
    }
    expect(applyMotionPreset(DEFAULT_OVERLAY_ANIMATION, "none").enabled).toBe(false);
    expect(matchMotionPreset({ enter: "pop", exit: "fade", durationMs: 1234 })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bibliothèque d'effets
// ---------------------------------------------------------------------------

describe("bibliothèque d'effets", () => {
  const all = [...Object.values(ENTER_EFFECT_DEFS), ...Object.values(EXIT_EFFECT_DEFS), ...Object.values(LOOP_EFFECT_DEFS)];

  it("chaque identifiant déclaré a sa définition, et inversement", () => {
    expect(Object.keys(ENTER_EFFECT_DEFS).sort()).toEqual(ENTER_EFFECTS.filter((e) => e !== "none").sort());
    expect(Object.keys(EXIT_EFFECT_DEFS).sort()).toEqual(EXIT_EFFECTS.filter((e) => e !== "none").sort());
    expect(Object.keys(LOOP_EFFECT_DEFS).sort()).toEqual(LOOP_EFFECTS.filter((e) => e !== "none").sort());
  });

  it("n'anime jamais de propriété de mise en page (width, top, margin…) et déclare ce qu'il anime", () => {
    const allowed = new Set(["opacity", "transform", "filter", "clipPath", "offset"]);
    for (const def of all) {
      for (const intensity of [0, 0.5, 1]) {
        for (const frame of def.keyframes({ intensity })) {
          for (const prop of Object.keys(frame)) {
            expect(allowed.has(prop), `${def.id}.${prop}`).toBe(true);
            if (prop !== "offset") expect(def.properties as readonly string[], `${def.id} déclare ${prop}`).toContain(prop === "clipPath" ? "clip-path" : prop);
          }
        }
      }
    }
  });

  it("une entrée finit dans l'état naturel, une sortie finit cachée", () => {
    for (const def of Object.values(ENTER_EFFECT_DEFS)) {
      const last = def.keyframes({ intensity: 0.7 }).at(-1)!;
      if ("opacity" in last) expect(last.opacity, def.id).toBe(1);
      if ("transform" in last) expect(String(last.transform), def.id).toMatch(/^(translate3d\(0, 0, 0\)|scale\(1\))$/);
    }
    for (const def of Object.values(EXIT_EFFECT_DEFS)) {
      expect(def.keyframes({ intensity: 0.7 }).at(-1)!.opacity, def.id).toBe(0);
    }
  });

  it("les glissements vont dans le sens annoncé ; l'amplitude règle la distance", () => {
    const fromBelow = String(getEnterEffect("slideUp")!.keyframes({ intensity: 0.5 })[0].transform);
    expect(fromBelow).toContain("calc(1 * 32px)"); // part d'en dessous (y positif), monte
    expect(String(getEnterEffect("slideRight")!.keyframes({ intensity: 0.5 })[0].transform)).toContain("calc(-1 * 32px)"); // depuis la gauche
    expect(String(getExitEffect("slideLeft")!.keyframes({ intensity: 1 }).at(-1)!.transform)).toContain("calc(-1 * 56px)");
    expect(slideDistance({ intensity: 0 })).toBe("8px");
    expect(slideDistance({ intensity: 1, distance: "0.4em" })).toBe("0.4em");
  });

  it("effets décoratifs : amplitudes faibles, aucun clignotement (opacité jamais coupée net)", () => {
    const pulse = LOOP_EFFECT_DEFS.pulse.keyframes({ intensity: 1 });
    expect(Number(String(pulse[1].transform).match(/scale\(([\d.]+)\)/)![1])).toBeLessThanOrEqual(1.07);
    const glow = LOOP_EFFECT_DEFS.glow.keyframes({ intensity: 1 }).map((f) => Number(f.opacity));
    expect(Math.max(...glow)).toBeLessThanOrEqual(0.85);
    expect(LOOP_EFFECT_DEFS.rotate.easing).toBe("linear");
    expect(LOOP_EFFECT_DEFS.shine.clip).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Moteur (Web Animations API simulée)
// ---------------------------------------------------------------------------

describe("moteur : lecture, annulation, remplacement, nettoyage", () => {
  it("transmet durée, délai, accélération ; entrée en fill backwards, sortie en fill forwards", () => {
    const el = fakeElement();
    playEnter(el, spec("fade", { delayMs: 120 }));
    expect(el.animations[0].options).toEqual({ duration: 300, delay: 120, easing: "ease-out", fill: "backwards" });
    playExit(el, spec("fade"));
    expect(el.animations[1].options.fill).toBe("forwards");
  });

  it("une nouvelle animation sur le même canal annule la précédente ; « cancelled » signalé, jamais de rejet", async () => {
    const el = fakeElement();
    const first = playEnter(el, spec("fade"));
    const second = playExit(el, spec("fade"));
    expect(el.animations[0].state).toBe("cancelled");
    expect(await first.finished).toBe("cancelled");
    el.animations[1].finish();
    expect(await second.finished).toBe("finished");
    expect(activeChannels(el)).toEqual([]);
  });

  it("canaux indépendants : une boucle décorative ne coupe pas l'entrée", () => {
    const el = fakeElement();
    playEnter(el, spec("fade"));
    playLoop(el, { effect: "pulse", periodMs: 1000, intensity: 0.5, trigger: "change", repeat: 2 });
    expect(el.animations.map((a) => a.state)).toEqual(["running", "running"]);
    expect(el.animations[1].options.iterations).toBe(2);
    expect(activeChannels(el).sort()).toEqual(["loop", "main"]);
    cancelAll(el); // élément retiré du DOM
    expect(el.animations.map((a) => a.state)).toEqual(["cancelled", "cancelled"]);
    expect(activeChannels(el)).toEqual([]);
  });

  it("boucle continue : infinie, mise en pause / reprise", () => {
    const el = fakeElement();
    const h = playLoop(el, { effect: "rotate", periodMs: 8000, intensity: 0.5, trigger: "always", repeat: 1 });
    expect(el.animations[0].options.iterations).toBe(Infinity);
    expect(el.animations[0].options.easing).toBe("linear");
    h.pause();
    expect(el.animations[0].state).toBe("paused");
    h.resume();
    expect(el.animations[0].state).toBe("running");
  });

  it("annuler explicitement un handle", async () => {
    const el = fakeElement();
    const h = playExit(el, spec("blur"));
    h.cancel();
    expect(el.animations[0].state).toBe("cancelled");
    expect(await h.finished).toBe("cancelled");
  });

  it("rien à animer → résolu immédiatement (« skipped ») : effet none, spec null, pas d'API, effet inconnu, erreur navigateur", async () => {
    const el = fakeElement();
    expect(await playEnter(el, null).finished).toBe("skipped");
    expect(await playEnter(el, spec("none")).finished).toBe("skipped");
    expect(await playEnter(el, spec("inexistant")).finished).toBe("skipped");
    expect(await playEnter({}, spec("fade")).finished).toBe("skipped"); // pas d'element.animate (rendu serveur)
    expect(await playEnter(null, spec("fade")).finished).toBe("skipped");
    const throwing = { animate: () => { throw new TypeError("bad easing"); } };
    expect(await playKeyframes(throwing, [{ opacity: 0 }], { duration: 1 }).finished).toBe("skipped");
    expect(el.animations).toHaveLength(0);
  });

  it("mouvement réduit : lu et suivi via matchMedia, sans planter hors navigateur", () => {
    const listeners: (() => void)[] = [];
    const mq = { matches: true, addEventListener: (_: "change", l: () => void) => listeners.push(l), removeEventListener: (_: "change", l: () => void) => listeners.splice(listeners.indexOf(l), 1) };
    expect(prefersReducedMotion(() => mq)).toBe(true);
    expect(prefersReducedMotion(undefined)).toBe(false);
    expect(prefersReducedMotion(() => { throw new Error("x"); })).toBe(false);
    const seen: boolean[] = [];
    const stop = watchReducedMotion((r) => seen.push(r), () => mq);
    mq.matches = false;
    listeners[0]();
    expect(seen).toEqual([false]);
    stop();
    expect(listeners).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Transitions entre deux états (changements de musique)
// ---------------------------------------------------------------------------

describe("transition entre deux états : changements successifs de musique", () => {
  type S = SwapState<string>;
  const update = (s: S, key: string, value = key, animate = true) => swapReducer(s, { type: "update", key, value, animate });
  const settle = (s: S) => swapReducer(s, { type: "settle" });
  const shown = (s: S) => s.layers.map((l) => `${l.value}:${l.phase}`);

  it("A → B : l'ancien sort, le nouveau entre, puis l'ancien est retiré", () => {
    let s = initSwap("A", "A", false);
    s = settle(update(s, "B"));
    expect(shown(s)).toEqual(["A:exiting", "B:entering"]);
    const [old, neu] = s.layers;
    s = swapReducer(s, { type: "exited", id: old.id });
    s = swapReducer(s, { type: "entered", id: neu.id });
    expect(shown(s)).toEqual(["B:present"]);
  });

  it("rafale (titre, artiste, pochette…) avant stabilisation : UNE seule transition, vers l'état final", () => {
    let s = initSwap("A", "A", false);
    s = update(s, "B");
    s = update(s, "C");
    s = update(s, "D");
    expect(shown(s)).toEqual(["A:present"]); // rien ne bouge pendant l'attente
    s = settle(s);
    expect(shown(s)).toEqual(["A:exiting", "D:entering"]);
  });

  it("aller-retour A → B → A pendant l'attente : aucune animation, aucun clignotement", () => {
    let s = initSwap("A", "A", false);
    s = update(s, "B");
    s = update(s, "A");
    expect(s.pending).toBeNull();
    expect(settle(s)).toBe(s);
    expect(shown(s)).toEqual(["A:present"]);
  });

  it("changement pendant une sortie : au plus un ancien état visible, l'information périmée ne revient jamais", () => {
    let s = initSwap("A", "A", false);
    s = settle(update(s, "B"));
    s = settle(update(s, "C")); // A sort encore, B entre…
    expect(shown(s)).toEqual(["B:exiting", "C:entering"]);
    // La fin tardive de la sortie de A ne change rien.
    const stale = swapReducer(s, { type: "exited", id: 1 });
    expect(stale).toBe(s);
    expect(currentLayer(s)?.value).toBe("C");
  });

  it("même clé, valeur plus récente (pochette arrivée plus tard) : mise à jour sur place, sans animation", () => {
    let s = initSwap<string>("track-1", "sans pochette", false);
    s = update(s, "track-1", "avec pochette");
    expect(shown(s)).toEqual(["avec pochette:present"]);
    expect(s.pending).toBeNull();
    expect(update(s, "track-1", "avec pochette")).toBe(s); // rien de nouveau : même objet (pas de rendu)
  });

  it("animations désactivées : remplacement immédiat, aucun calque sortant", () => {
    let s = initSwap("A", "A", false);
    s = update(s, "B", "B", false);
    expect(shown(s)).toEqual(["B:present"]);
  });

  it("premier affichage animé ou non", () => {
    expect(shown(initSwap("A", "A", true))).toEqual(["A:entering"]);
    expect(shown(initSwap("A", "A", false))).toEqual(["A:present"]);
  });
});

// ---------------------------------------------------------------------------
// Listes animées (chat)
// ---------------------------------------------------------------------------

describe("liste animée : arrivées rapides et retraits", () => {
  type M = { id: string };
  const m = (...ids: string[]): M[] => ids.map((id) => ({ id }));
  const view = (list: Presence<M>[]) => list.map((p) => (p.leaving ? `(${p.id})` : p.id)).join(" ");
  const rec = (prev: Presence<M>[], next: M[], opts: Partial<Parameters<typeof reconcilePresence>[3]> = {}) =>
    reconcilePresence(prev, next, (x) => x.id, { animateExit: true, ...opts });

  it("arrivées rapides : l'ordre des données est conservé", () => {
    let list = rec([], m("1"));
    list = rec(list, m("1", "2", "3", "4", "5"));
    expect(view(list)).toBe("1 2 3 4 5");
  });

  it("retrait animé : l'élément reste à sa place, marqué sortant, puis disparaît à la fin de l'animation", () => {
    let list = rec([], m("1", "2", "3"));
    list = rec(list, m("2", "3", "4")); // 1 dépasse le maximum, 4 arrive
    expect(view(list)).toBe("(1) 2 3 4");
    list = rec(list, m("2", "4")); // 3 disparaît (délai)
    expect(view(list)).toBe("(1) 2 (3) 4");
    list = removeLeaving(list, "1");
    list = removeLeaving(list, "3");
    expect(view(list)).toBe("2 4");
    expect(removeLeaving(list, "2")).toBe(list); // un élément présent n'est jamais retiré par erreur
  });

  it("modération (suppression, chat vidé) : retrait immédiat, jamais animé", () => {
    let list = rec([], m("1", "2", "3"));
    expect(view(rec(list, m("1", "3"), { instant: new Set(["2"]) }))).toBe("1 3");
    list = rec(list, [], { instant: "all" });
    expect(view(list)).toBe("");
  });

  it("animations désactivées : comportement historique (retrait immédiat)", () => {
    const list = rec([], m("1", "2"));
    expect(view(rec(list, m("2"), { animateExit: false }))).toBe("2");
  });

  it("flot de messages : au plus N sortants, les plus anciens partent sans attendre", () => {
    let list = rec([], m("1", "2", "3", "4", "5", "6"));
    list = rec(list, m("7"), { maxLeaving: 2 });
    expect(view(list)).toBe("(5) (6) 7");
  });

  it("un message qui revient pendant sa sortie redevient présent", () => {
    let list = rec([], m("1", "2"));
    list = rec(list, m("2"));
    expect(view(list)).toBe("(1) 2");
    list = rec(list, m("1", "2"));
    expect(view(list)).toBe("1 2");
  });

  it("aucune file sans fin : 500 messages d'affilée laissent une liste bornée", () => {
    let list: Presence<M>[] = [];
    for (let i = 0; i < 500; i++) list = rec(list, m(...Array.from({ length: 20 }, (_, k) => String(Math.max(0, i - 19) + k)).filter((x) => Number(x) <= i)), { maxLeaving: 8 });
    expect(list.filter((p) => !p.leaving)).toHaveLength(20);
    expect(list.filter((p) => p.leaving).length).toBeLessThanOrEqual(8);
  });
});

describe("rendu : flush des promesses du moteur", () => {
  it("une animation terminée libère son canal", async () => {
    const el = fakeElement();
    playEnter(el, spec("pop"));
    el.animations[0].finish();
    await flush();
    expect(activeChannels(el)).toEqual([]);
  });
});
