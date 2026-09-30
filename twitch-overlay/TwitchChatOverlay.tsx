import React, { useEffect, useReducer, useState } from "react";
import { TWITCH_WS_PATH, type ChatFragment, type ChatMessage, type OverlayMessage } from "../electron/shared/twitch";
import { FONT_STACKS, createFeedReducer, emoteUrl, parseOverlayOptions, readableNameColor } from "./chat-feed";

/**
 * Page chargée par la source Navigateur d'OBS (http://localhost:4000/overlay/chat).
 * Elle ne parle qu'au serveur Twitch de Batlay (même origine) : elle ne connaît
 * ni le jeton, ni l'API Twitch, ni l'overlay musical (port 3000).
 * Fond transparent, aucun message d'erreur visible à l'antenne.
 */

const options = parseOverlayOptions(window.location.search);
const reducer = createFeedReducer(options);

export function TwitchChatOverlay() {
  const [items, dispatch] = useReducer(reducer, []);
  const [badges, setBadges] = useState<Record<string, string>>({});

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

  const ordered = options.newestTop ? [...items].reverse() : items;
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
      {ordered.map(({ message }) => (
        <MessageRow key={message.id} message={message} badges={badges} />
      ))}
    </div>
  );
}

function MessageRow({ message, badges }: { message: ChatMessage; badges: Record<string, string> }) {
  return (
    <div className={`msg msg--${message.highlight}`}>
      {options.showBadges &&
        message.badges.map((badge) => {
          const url = badges[`${badge.setId}/${badge.id}`];
          return url ? <img key={`${badge.setId}/${badge.id}`} className="badge" src={url} alt="" /> : null;
        })}
      <span className="name" style={{ color: readableNameColor(message.color, message.userId) }}>
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

// Toujours du texte React (jamais innerHTML) : un message de chat ne peut pas injecter de balise dans l'overlay.
function Fragment({ fragment }: { fragment: ChatFragment }) {
  if (fragment.type === "emote") {
    return <img className="emote" src={emoteUrl(fragment.emoteId)} alt={fragment.text} />;
  }
  if (fragment.type === "mention") return <span className="mention">{fragment.text}</span>;
  return <span>{fragment.text}</span>;
}
