<p align="center">
  <img src="assets/icon.png" alt="Batlay" width="128" height="128" />
</p>

<h1 align="center">Batlay</h1>

<p align="center">
  <strong>Des overlays pour OBS : la musique en cours et le chat Twitch, sans configuration compliquée.</strong>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-0.3.6-9b6bff" />
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%2F%2011-3a2170" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-React%20%2B%20TypeScript-1f1140" />
</p>

---

Batlay est une application Windows qui affiche **ce que vous écoutez** et **le chat de votre stream** dans OBS, à travers de simples sources « Navigateur ». Tout tourne sur votre PC : pas de compte Batlay, pas de serveur externe.

## Fonctionnalités

### 🎵 Overlay musique
- **Éditeur visuel** : glissez, redimensionnez et stylez chaque élément (titre, artiste(s), pochette, barre de progression, fond…), avec annuler/rétablir et aperçu en temps réel.
- **Presets** : Minimal, Modern, Glass, Neon, Compact, Large, ou un canvas vide.
- **Plusieurs overlays**, chacun avec son propre lien OBS ; les modifications s'appliquent **en direct** dans OBS, sans recharger la source.
- **Sources de lecture** :
  - **Lecture système (Windows)** — Spotify, YouTube Music, VLC, navigateurs… tout ce qui apparaît dans le volet multimédia de Windows, sans compte ni clé.
  - **Spotify** via son API officielle (optionnel).
  - **Mode démo** pour tester sans rien lire.
- Plusieurs artistes affichés correctement, accents préservés, barre de progression fluide.

### 💬 Overlay chat Twitch
- Chat en **temps réel**, avec badges, emotes et couleurs des pseudos.
- Affichez le chat de **votre chaîne ou de n'importe quelle autre** (pseudo ou lien Twitch).
- **Personnalisation** : taille du texte, nombre de messages, disparition automatique, police, fond et opacité, ombre du texte, masquage des commandes (`!…`), ordre des messages, largeur et hauteur de la zone.
- Bouton **Test** pour vérifier la source sans attendre un vrai message, et bouton **Redémarrer le lien** pour recharger les sources OBS d'un clic.
- Lecture seule : Batlay ne demande que la permission de lire le chat.

### ⚙️ Confort
- **Vue d'ensemble** : l'état des deux overlays d'un coup d'œil, avec les problèmes à régler.
- Thème **sombre, clair ou système**, couleur d'accent personnalisable.
- **Mises à jour** depuis les Releases GitHub, en deux clics (rien ne se télécharge sans votre accord).
- Régénération des liens OBS quand on veut invalider un ancien lien.

## Installation

1. Téléchargez **`Batlay-Setup-x.y.z.exe`** dans les [Releases](https://github.com/BatStream-off/Batlay/releases).
2. Lancez l'installateur (Windows 10 version 1809 ou plus récent, ou Windows 11).
3. Ouvrez Batlay. Les mises à jour suivantes se font depuis **Paramètres → Mises à jour**.

## Démarrage rapide

### Overlay musique
1. **Connexions** → choisissez **Lecture système** (ou **Mode démo** pour essayer).
2. **Overlays** → créez un overlay à partir d'un preset et ajustez-le dans l'éditeur.
3. Cliquez sur **URL OBS** : le lien est copié.
4. Dans OBS : **Sources → + → Navigateur**, collez le lien et reprenez la largeur/hauteur indiquées dans l'éditeur.

### Overlay chat
1. Page **Chat Twitch** → **Connecter Twitch** et autorisez la lecture du chat dans le navigateur.
2. (Facultatif) collez le pseudo ou le lien d'une autre chaîne dans **Chaîne affichée**.
3. **Overlays → Chat** : réglez l'apparence, puis **Copier l'URL OBS**.
4. Dans OBS : **Sources → + → Navigateur**, collez l'URL (420 × 640 est un bon point de départ), puis cliquez sur **Test**.

> Les réglages du chat sont écrits **dans l'URL** : après un changement, recopiez l'URL dans la source OBS.

<details>
<summary><strong>Réglages du chat dans l'URL</strong></summary>

Exemple : `http://localhost:4000/overlay/chat?size=28&max=15&fade=30&font=mono&bg=1&opacity=70&w=420&h=640`

| Paramètre | Effet | Défaut |
|---|---|---|
| `size` | Taille du texte, 12 à 72 px | `22` |
| `max` | Nombre de messages affichés, 1 à 100 | `20` |
| `fade` | Disparition après N secondes (`0` = jamais) | `0` |
| `badges` | `0` pour masquer les badges | affichés |
| `bg` | `1` pour un fond sombre derrière chaque message | sans fond |
| `opacity` | Opacité du fond, 0 à 100 % | `58` |
| `font` | `segoe`, `arial`, `serif` ou `mono` | `segoe` |
| `shadow` | `0` pour retirer l'ombre du texte | ombre |
| `nocmd` | `1` pour masquer les messages qui commencent par `!` | affichés |
| `top` | `1` pour les nouveaux messages en haut | en bas |
| `w` / `h` | Largeur / hauteur de la zone en px (absent = toute la source) | auto |

Une valeur absente ou invalide retombe sur le défaut : une URL mal tapée n'affiche jamais une page cassée.
</details>

## Spotify (optionnel)

La **Lecture système** suffit dans la plupart des cas et ne demande aucune configuration. Pour utiliser l'API Spotify :

1. Créez une application sur le [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) et ajoutez la Redirect URI `http://127.0.0.1:8945/callback`.
2. Ajoutez votre compte dans **Settings → User Management** de l'application.
3. Dans Batlay : **Connexions → Spotify**, collez le **Client ID**, puis **Connecter Spotify**.

Batlay utilise le flow PKCE : aucun Client Secret n'est nécessaire, et le jeton est chiffré par Windows. Spotify exige un compte **Premium** pour les applications en mode développement.

## Ports utilisés

| Usage | Port |
|---|---|
| Overlay musique | `3000` (modifiable dans Paramètres) |
| Chat Twitch | `4000` (fixe) |
| Retour de connexion Spotify | `8945` (le temps de la connexion) |

Les serveurs n'écoutent que sur `127.0.0.1` : rien n'est accessible depuis le réseau.

## Développement

```bash
npm install
npm run dev        # Vite + Electron
npm test           # Vitest
npm run build      # tsc + Vite + Electron
npm run dist       # génère l'installateur Windows (release/)
```

Architecture, choix techniques, fonctionnement de la Lecture système et du module Twitch, limites connues : voir **[docs/DEVELOPPEMENT.md](docs/DEVELOPPEMENT.md)**. L'historique des versions est dans le **[CHANGELOG](CHANGELOG.md)**.

### Publier une version

1. Changez la version dans `package.json`, `package-lock.json` et « Version x.y.z » dans `src/pages/Settings.tsx` (`tests/version.test.ts` vérifie qu'elles concordent).
2. `git commit`, puis `git tag vX.Y.Z && git push --tags`.
3. Le workflow `.github/workflows/release.yml` lance les tests, construit l'installateur et le publie dans les Releases avec `latest.yml`, que les applications installées lisent pour proposer la mise à jour.

Le dépôt doit rester **public** pour que la mise à jour automatique fonctionne.

---

<p align="center">Créé par <strong>Adilbl</strong></p>
