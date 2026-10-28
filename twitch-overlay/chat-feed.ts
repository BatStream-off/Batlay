import type { ChatMessage } from "../electron/shared/twitch";
import { isEnterEffect, isExitEffect, type EnterEffectId, type ExitEffectId, type MotionSpec } from "../src/animation/config";

/**
 * Logique de l'overlay de chat, SANS React ni DOM (testée dans
 * tests/twitch-chat-feed.test.ts). Seul import du reste de Batlay : le moteur
 * d'animations commun (src/animation/), sans aucun lien avec l'overlay musical.
 */

// ---------------------------------------------------------------------------
// Réglages passés dans l'URL de la source OBS :
// ?size=24&max=15&fade=30&badges=0&bg=1&opacity=70&font=mono&shadow=0&nocmd=1&top=1&w=420&h=640
// Animations : &anim=pop&out=slideLeft&ad=300&motion=on
// ---------------------------------------------------------------------------

/** Polices proposées : celles de Batlay (embarquées dans la page) et celles livrées avec Windows 10 / 11. */
export const CHAT_FONTS = [
  "segoe", "inter", "grotesk", "arial", "verdana", "trebuchet", "tahoma", "bahnschrift", "calibri", "candara", "franklin",
  "impact", "comic", "segoePrint", "inkfree", "gabriola", "serif", "times", "palatino", "mono", "cascadia", "jetbrains", "courier",
] as const;
export type ChatFont = (typeof CHAT_FONTS)[number];

/** `auto` : respecte « réduire les animations » du système · `on` : toujours animé · `off` : jamais. */
export type ChatMotion = "auto" | "on" | "off";
const CHAT_MOTIONS: readonly ChatMotion[] = ["auto", "on", "off"];

/**
 * Rien n'est chargé depuis Internet : la source Navigateur d'OBS tourne sur le
 * même PC. Inter, Space Grotesk et JetBrains Mono sont embarquées dans la page
 * (twitch-overlay/main.tsx) ; les autres sont livrées avec Windows, avec une
 * police de repli si elles manquent.
 */
export const FONT_STACKS: Record<ChatFont, string> = {
  segoe: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  inter: '"Inter Variable", "Segoe UI", system-ui, sans-serif',
  grotesk: '"Space Grotesk Variable", "Segoe UI", system-ui, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  verdana: 'Verdana, Geneva, sans-serif',
  trebuchet: '"Trebuchet MS", "Segoe UI", sans-serif',
  tahoma: 'Tahoma, Verdana, sans-serif',
  bahnschrift: 'Bahnschrift, "Segoe UI", sans-serif',
  calibri: 'Calibri, Carlito, "Segoe UI", sans-serif',
  candara: 'Candara, "Segoe UI", sans-serif',
  franklin: '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif',
  impact: 'Impact, Haettenschweiler, "Arial Black", sans-serif',
  comic: '"Comic Sans MS", "Comic Neue", cursive',
  segoePrint: '"Segoe Print", "Comic Sans MS", cursive',
  inkfree: '"Ink Free", "Segoe Print", cursive',
  gabriola: 'Gabriola, Georgia, serif',
  serif: 'Georgia, "Times New Roman", serif',
  times: '"Times New Roman", Times, serif',
  palatino: '"Palatino Linotype", "Book Antiqua", Palatino, serif',
  mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
  cascadia: '"Cascadia Code", "Cascadia Mono", Consolas, monospace',
  jetbrains: '"JetBrains Mono Variable", Consolas, monospace',
  courier: '"Courier New", Courier, monospace',
};

export const FONT_LABELS: Record<ChatFont, string> = {
  segoe: "Segoe UI (défaut)",
  inter: "Inter",
  grotesk: "Space Grotesk",
  arial: "Arial",
  verdana: "Verdana",
  trebuchet: "Trebuchet MS",
  tahoma: "Tahoma",
  bahnschrift: "Bahnschrift",
  calibri: "Calibri",
  candara: "Candara",
  franklin: "Franklin Gothic",
  impact: "Impact (gras, gaming)",
  comic: "Comic Sans MS",
  segoePrint: "Segoe Print (manuscrite)",
  inkfree: "Ink Free (manuscrite)",
  gabriola: "Gabriola (élégante)",
  serif: "Georgia (serif)",
  times: "Times New Roman",
  palatino: "Palatino",
  mono: "Consolas (mono)",
  cascadia: "Cascadia Code (mono)",
  jetbrains: "JetBrains Mono",
  courier: "Courier New (machine à écrire)",
};

export interface OverlayOptions {
  /** Taille du texte en px. */
  size: number;
  /** Nombre maximal de messages affichés. */
  max: number;
  /** Disparition d'un message après N ms (0 = jamais). */
  fadeMs: number;
  showBadges: boolean;
  /** Fond sombre translucide derrière chaque message. */
  background: boolean;
  /** Opacité du fond, en % (n'a d'effet que si `background`). */
  bgOpacity: number;
  font: ChatFont;
  /** Contour + ombre portée du texte. */
  shadow: boolean;
  /** Masque les messages qui commencent par « ! » (commandes de bots). */
  hideCommands: boolean;
  /** Nouveaux messages en haut de la liste au lieu du bas. */
  newestTop: boolean;
  /** Largeur de la zone de chat en px (0 = toute la largeur de la source OBS). */
  width: number;
  /** Hauteur de la zone de chat en px (0 = toute la hauteur de la source OBS). */
  height: number;
  /** Animation d'arrivée d'un message (`none` = aucune). */
  enterEffect: EnterEffectId;
  /** Animation de départ (disparition automatique, trop de messages) ; `none` = retrait immédiat. */
  exitEffect: ExitEffectId;
  /** Durée des animations, en ms. */
  animMs: number;
  motion: ChatMotion;
  /** Plateformes affichées : les deux, ou une seule (le chat TikTok arrive dès que le live TikTok est branché dans Batlay). */
  sources: ChatSources;
  /** Petit logo de plateforme devant le pseudo (Twitch et TikTok) ; utile quand les deux chats sont mélangés. */
  platformIcon: boolean;
}

export type ChatSources = "all" | "twitch" | "tiktok";
const CHAT_SOURCES: readonly ChatSources[] = ["all", "twitch", "tiktok"];

/** Plateforme d'un message (absente = Twitch : messages d'avant la 0.3.9). */
export const messagePlatform = (message: Pick<ChatMessage, "platform">): "twitch" | "tiktok" => message.platform ?? "twitch";

export function acceptsMessage(options: Pick<OverlayOptions, "sources">, message: Pick<ChatMessage, "platform">): boolean {
  return options.sources === "all" || options.sources === messagePlatform(message);
}

export const DEFAULT_OPTIONS: OverlayOptions = {
  size: 22,
  max: 20,
  fadeMs: 0,
  showBadges: true,
  background: false,
  bgOpacity: 58,
  font: "segoe",
  shadow: true,
  hideCommands: false,
  newestTop: false,
  width: 0,
  height: 0,
  // Arrivée : équivalent exact de l'ancienne animation CSS (montée de 0,4 em, 180 ms, ease-out).
  enterEffect: "slideUp",
  exitEffect: "fade",
  animMs: 180,
  motion: "auto",
  sources: "all",
  platformIcon: false,
};

function intParam(params: URLSearchParams, key: string, fallback: number, min: number, max: number): number {
  const raw = params.get(key);
  if (raw === null || !/^\d{1,6}$/.test(raw.trim())) return fallback;
  return Math.min(max, Math.max(min, Number(raw)));
}

const flag = (params: URLSearchParams, key: string, fallback: boolean): boolean => {
  const raw = params.get(key)?.trim().toLowerCase();
  if (raw === undefined) return fallback;
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return fallback;
};

function fontParam(params: URLSearchParams): ChatFont {
  const raw = params.get("font")?.trim().toLowerCase();
  // Liste fermée, comparaison sans tenir compte des majuscules (« segoePrint » = « segoeprint »).
  return (raw && CHAT_FONTS.find((f) => f.toLowerCase() === raw)) || DEFAULT_OPTIONS.font;
}

/** Toute valeur absente ou invalide retombe sur le défaut : une URL mal tapée n'affiche jamais une page cassée. */
export function parseOverlayOptions(search: string): OverlayOptions {
  const params = new URLSearchParams(search);
  return {
    size: intParam(params, "size", DEFAULT_OPTIONS.size, 12, 72),
    max: intParam(params, "max", DEFAULT_OPTIONS.max, 1, 100),
    fadeMs: intParam(params, "fade", 0, 0, 3600) * 1000,
    showBadges: flag(params, "badges", DEFAULT_OPTIONS.showBadges),
    background: flag(params, "bg", DEFAULT_OPTIONS.background),
    bgOpacity: intParam(params, "opacity", DEFAULT_OPTIONS.bgOpacity, 0, 100),
    font: fontParam(params),
    shadow: flag(params, "shadow", DEFAULT_OPTIONS.shadow),
    hideCommands: flag(params, "nocmd", DEFAULT_OPTIONS.hideCommands),
    newestTop: flag(params, "top", DEFAULT_OPTIONS.newestTop),
    width: intParam(params, "w", DEFAULT_OPTIONS.width, 0, 3840),
    height: intParam(params, "h", DEFAULT_OPTIONS.height, 0, 2160),
    enterEffect: effectParam(params, "anim", isEnterEffect, DEFAULT_OPTIONS.enterEffect),
    exitEffect: effectParam(params, "out", isExitEffect, DEFAULT_OPTIONS.exitEffect),
    animMs: intParam(params, "ad", DEFAULT_OPTIONS.animMs, 50, 2000),
    motion: effectParam(params, "motion", (v): v is ChatMotion => (CHAT_MOTIONS as readonly string[]).includes(v as string), DEFAULT_OPTIONS.motion),
    sources: effectParam(params, "src", (v): v is ChatSources => (CHAT_SOURCES as readonly string[]).includes(v as string), DEFAULT_OPTIONS.sources),
    platformIcon: flag(params, "pico", DEFAULT_OPTIONS.platformIcon),
  };
}

function effectParam<T extends string>(params: URLSearchParams, key: string, valid: (v: unknown) => v is T, fallback: T): T {
  const raw = params.get(key)?.trim();
  return raw !== undefined && valid(raw) ? raw : fallback;
}

/** Opération inverse de parseOverlayOptions : n'écrit que ce qui diffère du défaut (URL courte et lisible). */
export function buildOverlaySearch(options: OverlayOptions): string {
  const params = new URLSearchParams();
  if (options.size !== DEFAULT_OPTIONS.size) params.set("size", String(options.size));
  if (options.max !== DEFAULT_OPTIONS.max) params.set("max", String(options.max));
  if (options.fadeMs > 0) params.set("fade", String(Math.round(options.fadeMs / 1000)));
  if (!options.showBadges) params.set("badges", "0");
  if (options.background) params.set("bg", "1");
  if (options.bgOpacity !== DEFAULT_OPTIONS.bgOpacity) params.set("opacity", String(options.bgOpacity));
  if (options.font !== DEFAULT_OPTIONS.font) params.set("font", options.font);
  if (!options.shadow) params.set("shadow", "0");
  if (options.hideCommands) params.set("nocmd", "1");
  if (options.newestTop) params.set("top", "1");
  if (options.width > 0) params.set("w", String(options.width));
  if (options.height > 0) params.set("h", String(options.height));
  if (options.enterEffect !== DEFAULT_OPTIONS.enterEffect) params.set("anim", options.enterEffect);
  if (options.exitEffect !== DEFAULT_OPTIONS.exitEffect) params.set("out", options.exitEffect);
  if (options.animMs !== DEFAULT_OPTIONS.animMs) params.set("ad", String(options.animMs));
  if (options.motion !== DEFAULT_OPTIONS.motion) params.set("motion", options.motion);
  if (options.sources !== DEFAULT_OPTIONS.sources) params.set("src", options.sources);
  if (options.platformIcon) params.set("pico", "1");
  const query = params.toString();
  return query ? `?${query}` : "";
}

// ---------------------------------------------------------------------------
// Liste des messages
// ---------------------------------------------------------------------------

export interface FeedItem {
  message: ChatMessage;
  addedAt: number;
}

export type FeedAction =
  | { type: "add"; message: ChatMessage; now: number }
  | { type: "backlog"; messages: ChatMessage[]; now: number }
  | { type: "delete"; messageId: string }
  | { type: "clear_user"; userId: string }
  | { type: "clear" }
  | { type: "prune"; now: number };

/** Commande de bot (« !uptime », « !so pseudo »…) : le texte commence par un point d'exclamation. */
export function isCommand(message: Pick<ChatMessage, "text">): boolean {
  return message.text.trimStart().startsWith("!");
}

export function createFeedReducer(options: Pick<OverlayOptions, "max" | "fadeMs"> & { hideCommands?: boolean; sources?: ChatSources }) {
  const hidden = (message: ChatMessage) =>
    (options.hideCommands === true && isCommand(message)) || (options.sources !== undefined && !acceptsMessage({ sources: options.sources }, message));
  return function feedReducer(state: FeedItem[], action: FeedAction): FeedItem[] {
    switch (action.type) {
      case "add":
        if (hidden(action.message)) return state;
        if (state.some((item) => item.message.id === action.message.id)) return state;
        return [...state, { message: action.message, addedAt: action.now }].slice(-options.max);
      case "backlog":
        return action.messages
          .filter((message) => !hidden(message))
          .slice(-options.max)
          .map((message) => ({ message, addedAt: action.now }));
      case "delete": {
        const next = state.filter((item) => item.message.id !== action.messageId);
        return next.length === state.length ? state : next;
      }
      case "clear_user": {
        const next = state.filter((item) => item.message.userId !== action.userId);
        return next.length === state.length ? state : next;
      }
      case "clear":
        return state.length === 0 ? state : [];
      case "prune": {
        if (options.fadeMs <= 0) return state;
        const next = state.filter((item) => action.now - item.addedAt < options.fadeMs);
        return next.length === state.length ? state : next; // même référence = pas de rendu inutile
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Affichage
// ---------------------------------------------------------------------------

export function emoteUrl(emoteId: string): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(emoteId)}/default/dark/2.0`;
}

/** Couleurs que Twitch attribue par défaut aux comptes qui n'en ont pas choisi. */
const DEFAULT_NAME_COLORS = [
  "#ff0000", "#0000ff", "#008000", "#b22222", "#ff7f50", "#9acd32", "#ff4500", "#2e8b57",
  "#daa520", "#d2691e", "#5f9ea0", "#1e90ff", "#ff69b4", "#8a2be2", "#00ff7f",
];

function luminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Couleur du pseudo, éclaircie si elle est illisible sur un jeu sombre (le bleu
 * foncé de certains comptes disparaît sinon). Sans couleur choisie : une des
 * couleurs par défaut de Twitch, stable pour un même utilisateur.
 */
export function readableNameColor(color: string | null, userId: string): string {
  let hex = color;
  if (!hex) {
    let hash = 0;
    for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    hex = DEFAULT_NAME_COLORS[hash % DEFAULT_NAME_COLORS.length];
  }
  let r = parseInt(hex.slice(1, 3), 16);
  let g = parseInt(hex.slice(3, 5), 16);
  let b = parseInt(hex.slice(5, 7), 16);
  for (let i = 0; i < 10 && luminance(r, g, b) < 0.3; i++) {
    r = Math.round(r + (255 - r) * 0.18);
    g = Math.round(g + (255 - g) * 0.18);
    b = Math.round(b + (255 - b) * 0.18);
  }
  const h = (n: number) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

// ---------------------------------------------------------------------------
// Animations des messages (moteur commun : src/animation/)
// ---------------------------------------------------------------------------

export interface ChatMotionSpecs {
  enter: MotionSpec | null;
  exit: MotionSpec | null;
  /** Distance des glissements, en em : proportionnelle à la taille du texte. */
  distance: (effect: string) => string;
}

/**
 * Animations effectives d'un message. `reducedMotion` : réglage du système,
 * ignoré seulement si l'URL demande `motion=on`.
 */
export function chatMotion(options: Pick<OverlayOptions, "enterEffect" | "exitEffect" | "animMs" | "motion">, reducedMotion: boolean): ChatMotionSpecs {
  const off = options.motion === "off" || (options.motion === "auto" && reducedMotion);
  const spec = (effect: string): MotionSpec | null =>
    off || effect === "none" ? null : { effect, durationMs: options.animMs, delayMs: 0, easing: "ease-out", intensity: 0.3 };
  return {
    enter: spec(options.enterEffect),
    exit: spec(options.exitEffect),
    // 0,4 em vertical (ancienne animation CSS), 1,5 em horizontal : lisible sans balayer l'écran.
    distance: (effect) => (effect === "slideLeft" || effect === "slideRight" || effect === "elastic" ? "1.5em" : effect === "drop" || effect === "fall" ? "0.8em" : "0.4em"),
  };
}
