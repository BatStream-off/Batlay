# Batlay

Application desktop Windows permettant de créer des overlays affichant la musique en cours de lecture (Spotify), personnalisables, à utiliser dans OBS via Browser Source.

---

## ⚠️ État actuel du projet — à lire avant tout

Ce dépôt a été généré dans un environnement de chat **sans accès réseau**. Concrètement :

- Aucune dépendance npm n'a été installée.
- Aucune commande (`dev`, `build`, `test`, `dist`) n'a été exécutée ni vérifiée.
- Aucun `Batlay Setup.exe` n'existe encore — il ne peut être généré que sur une machine avec `npm install` fonctionnel + `electron-builder` (qui télécharge des binaires Electron).
- L'intégration Spotify est écrite contre l'API officielle (OAuth PKCE réel, endpoints réels) mais n'a **jamais été testée en conditions réelles**.
- Le drag & drop des composants dans l'éditeur (section 18 du brief) n'est **pas implémenté** — le positionnement se fait actuellement via les champs numériques X/Y/W/H du panneau Properties. C'est une vraie limitation, pas une fonctionnalité cachée.

Ce qui **fonctionne en l'état** (logique pure, vérifiable par lecture) :

- Le pipeline complet Provider → State → WebSocket → Overlay, y compris en Mode Demo (aucune dépendance externe).
- Les 7 presets, avec de vrais composants et styles par défaut.
- La persistance (electron-store), le chiffrement du refresh token Spotify (safeStorage/DPAPI).
- Les tests unitaires du Mode Demo et des presets (`npm test`, jamais exécuté ici faute de réseau).

**Recommandation** : poursuivre ce projet dans **Claude Code** (terminal, VS Code ou l'app desktop), qui a accès réseau et peut réellement lancer `npm install`, itérer sur les erreurs, tester dans Electron, puis générer l'installateur Windows.

---

## 1. Présentation

Batlay connecte Spotify, détecte le morceau en cours, et diffuse ces informations (titre, artiste, pochette, progression) vers une page d'overlay transparente que vous ajoutez dans OBS comme Browser Source.

Un éditeur visuel permet de personnaliser entièrement l'apparence (position, taille, typographie, couleurs, animations) et de sauvegarder plusieurs overlays.

## 2. Architecture

```text
Batlay/
├── electron/
│   ├── main/index.ts              # Cycle de vie de l'app, fenêtre, démarrage du serveur d'overlay
│   ├── preload/index.ts           # Pont IPC sécurisé
│   ├── services/
│   │   ├── config-store.ts        # Persistance + chiffrement du refresh token
│   │   ├── spotify-auth.ts        # OAuth PKCE Spotify
│   │   └── overlay-server.ts      # Serveur HTTP + WebSocket
│   └── shared/types.ts
│
├── src/                           # Dashboard React
│   ├── pages/                     # Dashboard, Overlays, Editor, Connections, Settings
│   ├── stores/                    # Zustand
│   ├── services/                  # MusicProvider, DemoProvider, SpotifyProvider...
│   ├── presets/                   # Presets d'overlays
│   └── components/OverlayPreview.tsx
│
├── overlay/                       # Page réellement chargée par OBS
│   ├── main.tsx
│   └── OverlayApp.tsx
│
├── tests/                         # Tests Vitest
└── vite.config.ts                 # Entrées dashboard + overlay