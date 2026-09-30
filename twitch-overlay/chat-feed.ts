import type { ChatMessage } from "../electron/shared/twitch";

/**
 * Logique de l'overlay de chat, SANS React ni DOM (testée dans
 * tests/twitch-chat-feed.test.ts). Aucun import du reste de Batlay :
 * cette page n'a rien en commun avec l'overlay musical.
 */

// ---------------------------------------------------------------------------
// Réglages passés dans l'URL de la source OBS :
// ?size=24&max=15&fade=30&badges=0&bg=1&opacity=70&font=mono&shadow=0&nocmd=1&top=1&w=420&h=640
// ---------------------------------------------------------------------------

export type ChatFont = "segoe" | "arial" | "serif" | "mono";

/** Polices système uniquement : la source Navigateur d'OBS ne charge rien d'extérieur. */
export const FONT_STACKS: Record<ChatFont, string> = {
  segoe: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  arial: 'Arial, Helvetica, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
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
  return raw && Object.prototype.hasOwnProperty.call(FONT_STACKS, raw) ? (raw as ChatFont) : DEFAULT_OPTIONS.font;
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
  };
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

export function createFeedReducer(options: Pick<OverlayOptions, "max" | "fadeMs"> & { hideCommands?: boolean }) {
  const hidden = (message: ChatMessage) => options.hideCommands === true && isCommand(message);
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
