import React from "react";
import ReactDOM from "react-dom/client";
import { TwitchChatOverlay } from "./TwitchChatOverlay";
// Polices de Batlay proposées dans les réglages du chat (fichiers servis par le serveur local, rien d'extérieur).
import "@fontsource-variable/inter";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/jetbrains-mono";
import "./chat.css";

ReactDOM.createRoot(document.getElementById("twitch-overlay-root")!).render(
  <React.StrictMode>
    <TwitchChatOverlay />
  </React.StrictMode>
);
