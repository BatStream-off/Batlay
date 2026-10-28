import React, { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { TWITCH_WS_PATH, type ChatFragment, type ChatMessage, type OverlayMessage } from "../electron/shared/twitch";
import { FONT_STACKS, chatMotion, createFeedReducer, messagePlatform, emoteUrl, parseOverlayOptions, readableNameColor, type FeedAction, type FeedItem } from "./chat-feed";
import { reconcilePresence, removeLeaving, type Presence } from "../src/animation/presence";
import { prefersReducedMotion, watchReducedMotion } from "../src/animation/engine";
import type { MotionSpec } from "../src/animation/config";
import { useListItemMotion } from "../src/animation/react";

/**
 * Page chargée par la source Navigateur d'OBS (http://localhost:4000/overlay/chat).
 * Elle ne parle qu'au serveur Twitch de Batlay (même origine) : elle ne connaît
 * ni le jeton, ni l'API Twitch, ni l'overlay musical (port 3000).
 * Fond transparent, aucun message d'erreur visible à l'antenne.
 */

const options = parseOverlayOptions(window.location.search);
const reducer = createFeedReducer(options);

/** Sortants simultanés au plus : sous un flot de messages, les plus anciens partent sans attendre. */
const MAX_LEAVING = 8;

export function TwitchChatOverlay() {
  const [items, rawDispatch] = useReducer(reducer, []);
  const [badges, setBadges] = useState<Record<string, string>>({});
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion());
  useEffect(() => watchReducedMotion(setReducedMotion), []);
  // Stable tant que le réglage système ne change pas : les effets qui en dépendent ne se relancent pas à chaque rendu.
  const motion = useMemo(() => chatMotion(options, reducedMotion), [reducedMotion]);
  const animateExit = motion.exit !== null;

  // --- Présence : un message retiré des données reste affiché le temps de son animation de sortie. ---
  const itemsRef = useRef<FeedItem[]>(items);
  itemsRef.current = items;
  /** Retraits à faire SANS animation : modération (message supprimé, chat vidé) — le texte doit disparaître tout de suite. */
  const instantRef = useRef<Set<string> | "all">(new Set());
  /** Messages rejoués à la (re)connexion : affichés sans animation d'entrée (pas de cascade au chargement). */
  const noEnterRef = useRef<Set<string>>(new Set());
  const dispatch = useCallback((action: FeedAction) => {
    if (action.type === "delete") addInstant(instantRef, [action.messageId]);
    else if (action.type === "clear_user") addInstant(instantRef, itemsRef.current.filter((i) => i.message.userId === action.userId).map((i) => i.message.id));
    else if (action.type === "clear" || action.type === "backlog") instantRef.current = "all";
    if (action.type === "backlog") noEnterRef.current = new Set(action.messages.map((m) => m.id));
    rawDispatch(action);
  }, []);
  const [rendered, setRendered] = useState<Presence<FeedItem>[]>([]);
  useLayoutEffect(() => {
    const instant = instantRef.current;
    instantRef.current = new Set();
    setRendered((prev) =>
      reconcilePresence(prev, items, (i) => i.message.id, { animateExit, instant, maxLeaving: MAX_LEAVING })
    );
  }, [items, animateExit]);
  const onExited = useCallback((id: string) => setRendered((list) => removeLeaving(list, id)), []);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;
    let attempt = 0;

    function handle(msg: OverlayMessage) {
      const now = Date.now();
      switch (msg.type) {
        case "init":
          setBadges(msg.badges ?? {});
          dispatch({ type: "backlog", messages: msg.backlog ?? [], now });
          break;
        case "badges":
          setBadges(msg.badges ?? {});
          break;
        case "chat":
          dispatch({ type: "add", message: msg.message, now });
          break;
        case "delete":
          dispatch({ type: "delete", messageId: msg.messageId });
          break;
        case "clear_user":
          dispatch({ type: "clear_user", userId: msg.userId });
          break;
        case "clear":
          dispatch({ type: "clear" });
          break;
        case "reload":
          // « Redémarrer le lien OBS » depuis Batlay : la page repart de zéro et se reconnecte.
          window.location.reload();
          break;
      }
    }

    function connect() {
      socket = new WebSocket(`ws://${window.location.host}${TWITCH_WS_PATH}`);
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as OverlayMessage;
          if (msg && typeof msg.type === "string") handle(msg);
        } catch {
          /* message illisible : ignoré */
        }
      };
      // Batlay redémarré ou fermé : on retente sans jamais laisser la source figée.
      socket.onclose = () => {
        if (closedByUs) return;
        timer = setTimeout(connect, Math.min(10_000, 1_000 * 2 ** attempt++));
      };
    }
    connect();

    return () => {
      closedByUs = true;
      if (timer) clearTimeout(timer);
      socket?.close();
    };
  }, []);

  useEffect(() => {
    if (options.fadeMs <= 0) return;
    const id = setInterval(() => dispatch({ type: "prune", now: Date.now() }), 1_000);
    return () => clearInterval(id);
  }, []);

  const ordered = options.newestTop ? [...rendered].reverse() : rendered;
  const className = ["chat", options.background && "chat--bg", !options.shadow && "chat--flat", options.newestTop && "chat--top"]
    .filter(Boolean)
    .join(" ");
  const style = {
    fontSize: options.size,
    fontFamily: FONT_STACKS[options.font],
    "--bg-alpha": options.bgOpacity / 100,
    // Taille choisie : la zone reste collée au bord où arrivent les messages (bas, ou haut si « nouveaux en haut »).
    ...(options.width > 0 && { width: options.width, right: "auto" }),
    ...(options.height > 0 && {
      height: options.height,
      top: options.newestTop ? 0 : "auto",
      bottom: options.newestTop ? "auto" : 0,
    }),
  } as React.CSSProperties;

  return (
    <div className={className} style={style}>
      {ordered.map(({ id, item, leaving }) => (
        <MessageRow
          key={id}
          message={item.message}
          badges={badges}
          leaving={leaving}
          enter={noEnterRef.current.has(id) ? null : motion.enter}
          exit={motion.exit}
          distance={motion.distance}
          onExited={onExited}
        />
      ))}
    </div>
  );
}

function addInstant(ref: { current: Set<string> | "all" }, ids: string[]) {
  if (ref.current === "all") return;
  for (const id of ids) ref.current.add(id);
}

function MessageRow({
  message,
  badges,
  leaving,
  enter,
  exit,
  distance,
  onExited,
}: {
  message: ChatMessage;
  badges: Record<string, string>;
  leaving: boolean;
  enter: MotionSpec | null;
  exit: MotionSpec | null;
  distance: (effect: string) => string;
  onExited: (id: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const spec = leaving ? exit : enter;
  useListItemMotion(ref, {
    leaving,
    enter,
    exit,
    onExited: () => onExited(message.id),
    effectContext: spec ? { distance: distance(spec.effect) } : undefined,
  });
  return (
    // Un message sortant reste à sa place dans la liste (aucun chevauchement) et n'est plus lu par les lecteurs d'écran.
    <div ref={ref} className={`msg msg--${message.highlight}`} aria-hidden={leaving || undefined}>
      {options.platformIcon && <PlatformIcon platform={messagePlatform(message)} />}
      {options.showBadges &&
        message.badges.map((badge) => {
          const url = badges[`${badge.setId}/${badge.id}`];
          return url ? <img key={`${badge.setId}/${badge.id}`} className="badge" src={url} alt="" /> : null;
        })}
      <span className="name" style={{ color: messagePlatform(message) === "tiktok" && !message.color ? "#FE6C8A" : readableNameColor(message.color, message.userId) }}>
        {message.displayName}
      </span>
      <span>: </span>
      {message.replyTo && <span className="reply">@{message.replyTo} </span>}
      {message.fragments.map((fragment, i) => (
        <Fragment key={i} fragment={fragment} />
      ))}
    </div>
  );
}

/** Repère de plateforme : pastille de couleur avec une lettre (pas de logo de marque). */
function PlatformIcon({ platform }: { platform: "twitch" | "tiktok" }) {
  return (
    <span className={`platform platform--${platform}`} role="img" aria-label={platform === "tiktok" ? "TikTok" : "Twitch"}>
      {platform === "tiktok" ? "T" : "t"}
    </span>
  );
}

// Toujours du texte React (jamais innerHTML) : un message de chat ne peut pas injecter de balise dans l'overlay.
function Fragment({ fragment }: { fragment: ChatFragment }) {
  if (fragment.type === "emote") {
    return <img className="emote" src={emoteUrl(fragment.emoteId)} alt={fragment.text} />;
  }
  if (fragment.type === "mention") return <span className="mention">{fragment.text}</span>;
  return <span>{fragment.text}</span>;
}
