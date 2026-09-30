import React from "react";
import ReactDOM from "react-dom/client";
import { TwitchChatOverlay } from "./TwitchChatOverlay";
import "./chat.css";

ReactDOM.createRoot(document.getElementById("twitch-overlay-root")!).render(
  <React.StrictMode>
    <TwitchChatOverlay />
  </React.StrictMode>
);
