import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./styles/globals.css";
import { initTheme } from "./theme/apply-theme";

// Thème posé AVANT le premier rendu React : sinon la première image serait
// dessinée dans le mauvais thème (flash). Lecture synchrone auprès du process
// principal, qui a déjà résolu « system » via nativeTheme.
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
