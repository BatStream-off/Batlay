# Batlay

Application desktop Windows permettant de créer des overlays affichant la musique en cours de lecture (Spotify), personnalisables, à utiliser dans OBS via Browser Source.

---

## ⚠️ État actuel du projet — à lire avant tout

**Vérifié automatiquement (Linux, sans Windows, sans compte Spotify, sans OBS) :**
- `npm run build` (tsc + Vite + Electron) et `npm test` (plus de 190 tests) passent.
- Le vrai serveur d'overlay compilé + le bundle de production ont été chargés dans un vrai **Chromium** : mesure image par image de la barre de progression (60 fps, aucun recul, pause parfaitement figée), rendu du fond/bordure/arrondi, tous les artistes affichés, accents intacts sur le fil WebSocket.
- L'éditeur d'overlay a été piloté dans Chromium : création d'un overlay vide, ajout de composants, glisser à la souris, annuler/rétablir, duplication, réorganisation, fond dégradé, enregistrement, rechargement.

**NON vérifié (à tester en priorité sur votre machine) :**
- **La Lecture système Windows** : le script PowerShell/WinRT n'a jamais tourné (pas de Windows ici). Les correctifs d'encodage et de position (sections 6bis et 6quater) sont couverts par des tests unitaires sur la logique de décodage/extrapolation, pas par une exécution réelle.
- **Spotify réel** : l'intégration est écrite contre l'API officielle mais n'a jamais parlé à un vrai compte. Le parsing est testé sur des réponses simulées.
- **L'application Electron elle-même** (fenêtre, IPC, installateur) et **OBS** : seul leur équivalent navigateur a été testé.
- `npm run lint` ne fonctionne pas : le projet n'a aucun fichier `eslint.config.*` (ESLint ≥ 9 l'exige). Ce n'est pas nouveau.

---

## 1. Présentation

Batlay connecte Spotify, détecte le morceau en cours, et diffuse ces informations (titre, artiste, pochette, progression) vers une page d'overlay transparente que vous ajoutez dans OBS comme Browser Source. Un éditeur visuel permet de personnaliser entièrement l'apparence (position, taille, typographie, couleurs, animations) et de sauvegarder plusieurs overlays.

## 2. Architecture

```
Batlay/
├── electron/
│   ├── main/index.ts         # Cycle de vie de l'app, fenêtre, démarrage du serveur d'overlay
│   ├── preload/index.ts      # Pont IPC sécurisé (contextIsolation, pas de nodeIntegration)
│   ├── services/
│   │   ├── config-store.ts   # Persistance + chiffrement du refresh token (safeStorage)
│   │   ├── spotify-auth.ts   # OAuth PKCE Spotify (aucun secret en dur)
│   │   └── overlay-server.ts # Serveur HTTP + WebSocket (Express + ws)
│   └── shared/types.ts
├── src/                       # Dashboard React (fenêtre principale Electron)
│   ├── pages/                 # Dashboard, Overlays, Editor, Connections, Settings
│   ├── stores/                # Zustand : useMusicStore, useOverlayStore, useSettingsStore
│   ├── services/               # MusicProvider (interface), DemoProvider, SpotifyProvider
│   ├── presets/                # Minimal, Modern, Glass, Neon, Compact, Large, Blank
│   └── components/OverlayPreview.tsx  # Rendu partagé (thumbnail, éditeur, overlay réel)
├── overlay/                    # Page réellement chargée par OBS Browser Source
│   ├── main.tsx
│   └── OverlayApp.tsx          # Fetch config + WebSocket, fond transparent, rien d'autre
├── tests/                      # Vitest : DemoProvider, presets
└── vite.config.ts              # Deux entrées : index.html (dashboard) + overlay.html
```

### Flux de données

```
Spotify / Lecture système / Mode Demo
   ↓  (MusicProvider — interface commune ; `Track.artists[]` + `Track.artist`)
useMusicStore (Zustand, renderer)  ──→  playbackClock (horloge de progression, renderer)
   ↓  window.batlay.overlay.broadcastState()  [IPC]
electron/services/overlay-server.ts (process principal)
   │  (pochette base64 sortie du flux : /api/artwork/<id> ; message = { payload, sentAt })
   ↓  WebSocket
overlay/OverlayApp.tsx  ──→  horloge de progression (même code)  →  OBS Browser Source
```

Le renderer ne détient **jamais** de token Spotify : toute l'authentification et les appels API passent par `window.batlay.spotify.*`, exposé via `contextBridge` dans `electron/preload/index.ts`.

## 3. Installation (sur une machine avec accès réseau)

```bash
npm install
```

## 4. Développement

```bash
npm run dev
```

Lance Vite (dashboard + overlay), attend que le serveur soit prêt, puis démarre Electron. Le serveur d'overlay démarre automatiquement avec l'app — aucune commande séparée n'est nécessaire.

## 5. Configuration Spotify

Spotify n'est **jamais** pré-configuré avec des identifiants embarqués. Pour l'activer :

1. Créez une application sur le [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
2. Dans les paramètres de l'app, ajoutez exactement cette Redirect URI :
   ```
   http://127.0.0.1:8945/callback
   ```
3. Copiez le **Client ID** (le Client Secret n'est pas nécessaire — Batlay utilise le flow PKCE, la méthode que Spotify recommande explicitement pour les apps desktop, justement parce qu'un secret ne peut pas y être stocké en sécurité).
4. **Ajoutez votre propre compte Spotify à l'allowlist de l'app** : Dashboard > votre app > Settings > User Management > ajoutez l'email associé à votre compte Spotify. Tant que l'app reste en **Development Mode** (le cas par défaut, et suffisant pour un usage personnel), Spotify refuse l'autorisation à tout compte non explicitement ajouté ici — c'est l'étape la plus souvent oubliée.
5. Depuis les changements Spotify de février 2026, un **compte Spotify Premium** est requis pour utiliser une app en Development Mode (y compris le vôtre en tant que testeur).
6. Dans Batlay : **Connexions > Spotify**, collez le Client ID, puis cliquez sur **Connecter Spotify**.

Un navigateur s'ouvre pour l'autorisation ; Batlay capte le retour via un petit serveur HTTP local éphémère (port `8945`) et échange le code contre un token. Le refresh token est chiffré via `safeStorage` (DPAPI sur Windows) avant d'être stocké — jamais en clair, jamais dans les logs.

Les scopes utilisés (`user-read-currently-playing`, `user-read-playback-state`) sont des scopes de **lecture seule** sur le morceau en cours — ils sont restés accessibles en Development Mode après les restrictions Spotify de fin 2024/2026 (contrairement aux endpoints de recommandations, follow, ou modification de playlists, qui nécessitent désormais l'Extended Quota Mode, hors de portée pour un usage personnel).

## 6. Mode Demo

Aucune configuration requise. **Connexions > Mode démo > Lancer la démo** fait défiler 6 morceaux d'exemple (dont des collaborations à 2 et 3 artistes et des noms accentués : *Lean On* — Major Lazer, DJ Snake, MØ ; *Balance ton quoi* — Angèle) avec une progression calculée sur l'horloge, exploitable pour tester overlays, animations et OBS sans compte Spotify.

## 6bis. Lecture système (Windows) — pour les comptes non-Premium

Depuis mars 2026, Spotify exige qu'un compte **Premium** possède l'app Development Mode utilisée pour l'OAuth (voir section 5, point 5) — et comme chaque utilisateur de Batlay crée son propre Client ID, chaque utilisateur est son propre "propriétaire d'app" et doit donc être Premium. C'est une restriction imposée par Spotify côté serveur, impossible à contourner en modifiant Batlay.

Pour les comptes gratuits, **Connexions > Lecture système (Windows) > Connecter** lit directement les métadonnées "En cours de lecture" exposées par Windows via les *Global System Media Transport Controls* (la même API que le Volet de contrôle multimédia / les touches multimédias du clavier) :

- Aucun compte Spotify, Client ID ou OAuth requis.
- Fonctionne avec Spotify Free, un navigateur (YouTube Music...), VLC, ou toute autre app qui expose son "Now Playing" à Windows.
- Implémenté dans `electron/services/system-media.ts` (interroge PowerShell/WinRT depuis le process principal) et `src/services/system-media-provider.ts` (provider `MusicProvider` côté renderer, polling 2s comme `SpotifyProvider`).
- **Choix du lecteur** : si plusieurs apps jouent en même temps (ex. Spotify + un onglet YouTube), **Connexions > Lecture système > Lecteur à suivre** liste les sessions actives (`GetSessions()` WinRT) et permet d'en épingler une explicitement — sinon Batlay suit par défaut celle qui a le focus multimédia côté Windows. Le choix est persisté (`settings.preferredSystemMediaAppId`).
- **Pochette** : récupérée **en arrière-plan** (`Thumbnail` WinRT converti en data URI base64, puis recherche en ligne si absente : iTunes, Deezer, ListenBrainz, MusicBrainz et Audius interrogés **en parallèle**, sans clé d'API — la première réponse fiable l'emporte et annule les autres ; voir l'en-tête de `electron/services/artwork-lookup.ts`) : le titre, l'artiste et la progression s'affichent sans l'attendre, et l'état est ré-émis dès que l'image arrive. Mise en cache tant que le morceau ne change pas ; les tentatives sont espacées et bornées. Côté OBS, l'image n'est plus renvoyée dans chaque message WebSocket mais servie une fois via `/api/artwork/<id>` (cache navigateur).
- **Spotify Desktop** : SMTC peut rester sur le morceau précédent pendant une pub et n'afficher qu'une partie des artistes. Pour Spotify uniquement, Batlay lit aussi le **titre de la fenêtre** Spotify (`Artiste - Titre`, `Advertisement` pendant une pub) et le recoupe avec SMTC (`src/utils/spotify-metadata.ts`) : pendant une pub, l'overlay affiche « Publicité / Spotify » (barre vide, aucune recherche de pochette) au lieu du morceau précédent ; l'artiste est complété quand la fenêtre en donne davantage **et** est cohérente avec SMTC. Au moindre désaccord (changement de piste en cours), SMTC reste seul juge. Si Spotify est réduit dans la zone de notification, sa fenêtre est masquée : le recoupement est alors inactif et seul SMTC est utilisé. Pour diagnostiquer, activer le journal debug (section 6quater) : le cas `fenetre-spotify` affiche le titre de fenêtre à côté des valeurs SMTC.
- **Plusieurs artistes** : Windows ne transmet que la chaîne que l'application source lui donne. Batlay l'affiche **telle quelle** (aucun découpage). Si un lecteur n'y met que l'artiste principal, Batlay ne peut pas retrouver les autres — voir la section 6quater et les limitations.
- Limitations connues : **Windows 10 1809+ / Windows 11 uniquement** ; non testé sur une vraie machine Windows dans cet environnement (pas d'accès à PowerShell/WinRT ici) — à valider en priorité avant `npm run dist`.

## 6ter. Progression en temps réel (Dashboard + overlay OBS)

Les providers ne fournissent une position que toutes les ~1 à 3 s (polling). Entre deux mesures, **une seule horloge partagée** (`src/utils/progress-clock.ts`) fait avancer la barre ; le Dashboard, l'éditeur et la page OBS (`overlay/OverlayApp.tsx`) utilisent exactement ce même code.

Pourquoi la barre saccadait, et ce qui a changé :

| Cause | Correctif |
|---|---|
| Affichage rafraîchi toutes les 250 ms (4 images/s) + `transition` CSS qui rattrapait en retard | Mise à jour **image par image** (`requestAnimationFrame`, `src/utils/frame-ticker.ts`) directement dans le DOM (`translate3d`, `src/components/LiveProgress.tsx`) : 60 images/s sans re-rendre React |
| `updatedAt` posé **après** les appels (latence perdue) | `updatedAt` = instant de la **mesure** : milieu de l'aller-retour HTTP pour Spotify, horodatage pris dans PowerShell pour la Lecture système |
| Position SMTC brute : c'est la position à `LastUpdatedTime`, pas « en direct » | Extrapolation `position + (mesure − LastUpdatedTime)` si lecture en cours (`resolvePosition`) |
| 2ᵉ process PowerShell **bloquant** pour la pochette | Pochette asynchrone, ré-émission à l'arrivée |
| Recalage brutal sur chaque mesure (sauts, retours en arrière) | Écart < 120 ms : ignoré ; 120 ms–4 s : absorbé en accélérant/ralentissant la barre (vitesse toujours dans [0,5×, 1,5×] → **jamais de recul**) ; > 4 s ou autre morceau : vrai saut (seek) |
| Pochette base64 (100–500 Ko) renvoyée à chaque message WebSocket | Servie une fois par HTTP ; le message ne pèse plus que quelques centaines d'octets |
| Message WebSocket sans notion d'âge, dépendant de l'horloge d'OBS | `sentAt` (horloge de Batlay) + `updatedAt` → âge exact de la mesure, indépendant de l'horloge de la page OBS |
| Pause détectée avec 1–2 s de retard → la barre reculait | La barre se fige où elle est (tolérance 2,5 s) |
| Fin de morceau : polling à cadence fixe | Spotify : relevé programmé pile après la fin prévue ; rafale rapide après tout changement ; recul exponentiel en cas d'erreur/429 |
| Déconnexion : OBS gardait l'ancien morceau (barre qui continuait) | L'état « rien en lecture » est diffusé à la déconnexion |

Mesuré dans Chromium contre le vrai serveur d'overlay avec un provider simulé bruité (latence 60–760 ms, pause, changement de morceau) : 0 recul, erreur d'affichage entre −65 ms et +184 ms, vitesse lissée ≤ 1,15×.

## 6quater. Artistes multiples et encodage UTF-8

**Artistes.** `Track.artists: string[]` (liste structurée) et `Track.artist` (chaîne « Artiste 1, Artiste 2, Artiste 3 ») circulent ensemble sur tout le pipeline. La liste existe parce que la chaîne est ambiguë : « Tyler, The Creator » contient une virgule. Le composant *Artiste(s)* de l'overlay accepte un séparateur au choix (`, ` · `•` `&` `/` …) et **défile** (marquee) au lieu de couper avec « … » quand le texte dépasse le bloc — ce qui donnait l'impression qu'un seul artiste s'affichait. Le parsing Spotify est dans `src/services/spotify-track.ts` (tolère morceau, fichier local sans id, épisode). Un test (`tests/no-first-artist-only.test.ts`) échoue si `artists[0]` & co. réapparaissent.

**Caractères corrompus (« � »).** Cause racine : `powershell.exe` écrit sa sortie dans la page de code **OEM** de Windows (850 en France), pas en UTF-8 ; Node la décodait en UTF-8, et l'octet de « é » en CP850 devient « � » — information perdue, aucun remplacement a posteriori ne peut la retrouver. Correctif (`electron/services/system-media.ts`) : PowerShell encode son JSON en UTF-8 puis en **Base64** (ASCII pur), Node décode les octets lui-même (`decodePowerShellOutput`, avec repli UTF-8 strict → Windows-1252). Un test reproduit le bug (CP850 lu en UTF-8) puis le correctif. Le code source, lui, était sain : aucun `�`, `Ã©` ni BOM dans le projet (vérifié). En filet de sécurité, `src/utils/text-encoding.ts` répare le cas où c'est la **source** qui fournit un texte déjà mal décodé (tags MP3 UTF-8 lus en Windows-1252 : « CafÃ© » → « Café »), uniquement si le résultat est de l'UTF-8 strictement valide, et retire les caractères de contrôle. Un `�` déjà présent n'est volontairement jamais masqué. `.editorconfig` impose UTF-8/LF.

**Robustesse du décodage et nettoyage (`cleanMetadataText`).** `decodePowerShellOutput` tolère désormais un BOM devant le Base64, un CRLF final et un Base64 replié sur plusieurs lignes, et ne prend pas un simple mot (« null ») pour notre sortie. `runScript` reste le chemin unique d'exécution PowerShell (`executePowerShell` en est la version injectable, testée avec un faux stdout ; un test impose `encoding: "buffer"` et que le script n'écrive que via `Emit`, en Base64). `cleanMetadataText` (pure) retire caractères de contrôle, NUL, BOM et invisibles (U+200B, U+2060, U+FEFF), normalise en NFC et ramène toute suite d'espaces à un seul ; elle ne découpe ni ne réécrit jamais un nom (« Tyler, The Creator », « Simon & Garfunkel », « AC/DC », « Earth, Wind & Fire », « Mötley Crüe », « !!! » sont testés). ZWJ/ZWNJ (U+200D/U+200C) ne sont retirés qu'en bordure : à l'intérieur d'un texte ils ont un sens (emoji composés, persan).

**Journal de diagnostic des métadonnées.** Désactivé par défaut. Dans la console de Batlay (`F12`), `localStorage.setItem("batlay:debug-metadata", "1")` puis relancer : pour les morceaux qui illustrent un des trois cas (*accent*, *multi-artistes*, *non-latin*), une seule entrée par morceau donne le texte brut, le texte nettoyé et leurs points de code Unicode (`Ang[U+00E8]le`), plus `AlbumArtist` tel que le lecteur le déclare — lu **uniquement** pour ce diagnostic, jamais utilisé à l'affichage. Un `U+FFFD` est signalé : l'information est déjà perdue en amont. Retrait : `localStorage.removeItem("batlay:debug-metadata")`.

## 6quinquies. Éditeur d'overlay

- **Créer** : « Nouvel overlay » propose un des 6 presets (avec miniatures) ou **Canvas vide** (taille au choix, préréglages OBS). Le nom est facultatif. Les presets existants sont inchangés.
- **Composants** (palette *Ajouter un composant*, qui reste ouverte pour en enchaîner plusieurs) : pochette, titre, artiste(s), album, barre de progression, temps écoulé, **temps restant**, durée, source, **texte libre** (variables `{title} {artist} {album} {source}`), **forme / fond** (carte, séparateur…).
- **Fond, bordure, arrondi, ombre** — pour chaque composant **et** pour l'overlay entier : fond uni ou dégradé (linéaire/radial, angle) avec **transparence**, bordure (épaisseur, couleur, continu/tirets/pointillés), rayon des coins, ombre portée (x, y, flou, étalement, couleur, opacité), ombre de texte, opacité globale.
- **Calques** : glisser-déposer pour réordonner, monter/descendre, dupliquer, supprimer, renommer (double-clic), masquer, verrouiller.
- **Position / taille** : glisser à la souris, 8 poignées de redimensionnement, magnétisme avec guides (bords et centres du canvas et des autres composants), champs X/Y/L/H, alignement sur le canvas, canvas redimensionnable (préréglages OBS).
- **Aperçu temps réel** : rendu identique à la page OBS (même code), rogné comme OBS ; morceau *Exemple* (barre animée) ou *En direct* (musique détectée) ; fond de scène simulé (damier, sombre, clair, vert).
- **Annuler / rétablir** (100 niveaux ; un geste de souris = une étape). Un brouillon non enregistré est conservé si vous quittez l'éditeur puis y revenez.
- **Raccourcis** (liste complète : bouton clavier au-dessus de l'aperçu) : `Ctrl+S` enregistrer · `Ctrl+Z` / `Ctrl+Y` · `Ctrl+D` dupliquer · `Suppr` · flèches = 1 px (`Maj` = 10 px) · `Ctrl+↑` / `Ctrl+↓` (ou `Ctrl+[` / `Ctrl+]`, qui demandent AltGr en AZERTY) calque en dessous / au-dessus · `Ctrl+0` zoom ajusté, `Ctrl++` / `Ctrl+-` et `Ctrl+molette` zoom · pendant un glissement : `Maj` = axe droit ou proportions, `Alt` = sans magnétisme ou depuis le centre · `Échap` désélectionne.
- Rétrocompatibilité : tous les nouveaux champs sont optionnels ; les overlays déjà enregistrés et les presets (`shadow: true`, `borderWidth`…) sont toujours lus. Une bordure est maintenant comprise **dans** la taille du bloc (`border-box`), ce qui peut réduire de quelques pixels la pochette des presets Glass/Neon.

## 6sexies. Démarrage et fenêtre principale

- **Start minimized** = la fenêtre est **affichée puis réduite** dans la barre des tâches, jamais invisible (`getInitialWindowState`, `electron/services/window-lifecycle.ts`). Avant ce correctif elle ne s'affichait jamais dans ce mode, et `ready-to-show` était écouté *après* `loadFile` (course possible même en mode normal). Désormais l'affichage est branché **avant** le chargement, avec un filet de sécurité (~5 s) et un affichage sur `did-fail-load`. Le renderer n'est jamais détruit ni masqué (`backgroundThrottling: false`) : polling musical et WebSocket vers OBS continuent fenêtre réduite. Pas d'icône de zone de notification (aucune icône n'existe dans le projet).
- **Instance unique** (`requestSingleInstanceLock`, avant `whenReady`) : relancer Batlay ramène la fenêtre existante au premier plan (`restore` si réduite, `show`, `focus`) au lieu de lancer un second processus qui se battrait pour le port de l'overlay.
- **Launch on startup** est appliqué au système (`app.setLoginItemSettings`), **uniquement si l'app est packagée** ; sans cela le réglage était enregistré mais sans effet. Le fichier n'est réécrit que si l'état demandé diffère de l'état réel.

## 6septies. Thème sombre / clair / système

- Réglage `theme` : `"dark" | "light" | "system"` (Settings > Appearance). Un ancien `"dark"` reste valide ; toute valeur inconnue retombe sur `"dark"`. `system` suit Windows, y compris quand il bascule pendant que Batlay tourne.
- **Source de vérité** : `electron/shared/theme.ts` (tokens hexadécimaux dark/light, résolution, fond de fenêtre). Le renderer pose les variables CSS RGB sur `<html>` (`src/theme/apply-theme.ts`) ; Tailwind les lit via `rgb(var(--x) / <alpha-value>)` (`tailwind.config.js`), donc `bg-base-800/60` continue de fonctionner. Le sombre reprend **à l'identique** les anciennes valeurs (figées par un test).
- Nouveaux jetons sémantiques : `fg`, `muted`, `faint`, `line` (bordures des cartes), `accent`/`ok`/`danger`/`warn` (texte de statut lisible sur les surfaces) ; `bg-stage` est le fond **fixe** des miniatures d'overlay. Contraste WCAG AA (≥ 4,5:1) vérifié par test pour le texte principal, `muted` et les statuts, dans les deux thèmes.
- **Jamais thématisés** : la page overlay d'OBS, `OverlayPreview`, et les fonds d'aperçu de l'éditeur (Damier / Sombre / Clair / Scène) — un test le garantit.
- Zéro flash : le process principal résout le thème (`nativeTheme`), donne sa couleur à `BrowserWindow.backgroundColor`, et le renderer l'applique **avant** `createRoot` (lecture synchrone `theme:get-initial`).

## 6octies. Navigation et interface

- **Langue** : toute l'interface est en français (le réglage `language` existe dans la config mais n'est pas encore exploité : pas d'internationalisation).
- **Barre latérale** : dans l'éditeur elle se réduit à des icônes (la fenêtre fait 1024 px minimum) et peut être rouverte ; « Overlays » reste allumé pendant l'édition. Le pied de barre donne accès à **Copier l'URL OBS** et à l'état du serveur / de la source (cliquables : ils mènent à la page qui permet de corriger).
- **Overlay principal** : l'overlay marqué « Principal » (ancien « Active ») est celui dont l'URL OBS est proposée dans la barre latérale et le tableau de bord. S'il n'existe plus, c'est le premier de la liste (`pickMainOverlay`). Cela n'a **aucun effet sur le serveur** : chaque overlay reste servi sur sa propre URL.
- **Tableau de bord** : « Mise en route » en trois étapes (source, overlay, URL OBS), lecture en cours, aperçu de l'overlay principal avec la vraie musique.
- **Éditeur** : nom modifiable dans l'en-tête ; propriétés d'un composant en trois onglets (*Général*, *Texte/Pochette/Barre*, *Apparence*) ; barre d'outils de vue (magnétisme, fond, exemple/direct, zoom) ; « Abandonner » demande confirmation car l'historique d'annulation est effacé.
- **Paramètres** : le port n'est enregistré qu'à la validation (Entrée / sortie du champ) et doit être compris entre 1024 et 65535 (`validatePort`).
- **Liens OBS régénérables** : l'URL d'un overlay contient son identifiant (`/overlay/<id>`), donc *régénérer* un lien = donner un nouvel `id` à l'overlay (`regenerateObsIds`, `src/utils/obs-link.ts`, `updatedAt` inchangé). Disponible pour un overlay (menu « … » de *Mes overlays* : le nouveau lien est copié) ou pour tous (Paramètres > Serveur d'overlay), toujours après confirmation. L'ancien lien est **révoqué côté serveur** (`OverlayServer.setOverlayConfigs`) : ses sources OBS sont déconnectées, et le WebSocket refuse désormais tout id inconnu — sans quoi une source dont le lien a changé se reconnecterait toutes les 2 s et recevrait encore l'état de lecture. Ce refus s'applique aussi à un overlay supprimé. L'overlay principal suit son nouvel id, et un brouillon non enregistré de l'éditeur est rattaché au nouvel id (`src/utils/unsaved-drafts.ts`).
- Fonctions pures de l'interface (zoom, port, overlay principal, dates relatives) : `src/utils/ui-helpers.ts`, testées dans `tests/ui-helpers.test.ts`.

## 7. Build

```bash
npm run build   # build Vite (dashboard + overlay) + compilation electron/
npm run dist    # build + génération de l'installateur Windows via electron-builder
```

`npm run dist` doit produire `release/Batlay Setup.exe` — **non vérifié dans cet environnement**, à confirmer sur une machine Windows (ou via electron-builder cross-compilation) avec accès réseau.

## 8. Utilisation avec OBS

1. Dans Batlay, ouvrez un overlay dans l'**éditeur**.
2. Cliquez sur **URL OBS** (en-tête de l'éditeur, carte de la page *Mes overlays* ou barre latérale) : l'URL est copiée (ex. `http://localhost:3000/overlay/abc123`).
3. Dans OBS : **Sources > Browser Source** > collez l'URL.
4. Renseignez la taille recommandée affichée dans l'éditeur (largeur/hauteur du canvas de l'overlay).
5. Le fond de la page est transparent nativement (`overlay.html` force `background: transparent`) ; le fond que vous définissez dans l'éditeur (couleur, transparence, dégradé) s'y ajoute.
6. **Enregistrer** dans l'éditeur applique les changements **en direct** dans OBS (le serveur pousse la nouvelle configuration), sans recharger la Browser Source.
7. Polices : OBS n'a accès qu'aux polices installées sur son PC. Il n'y a volontairement aucun flou d'arrière-plan (`backdrop-filter`) : dans une Browser Source il n'y a rien derrière la page à flouter.

## 9. Import / Export

Chaque overlay peut être exporté en `.json` (`schemaVersion: 1`) depuis la page **Mes overlays** (menu « … » de la carte). L'import avec validation stricte du schéma **n'est pas encore implémenté** — actuellement seul l'export fonctionne.

## 10. Ajouter un nouveau provider musical

Implémentez l'interface `MusicProvider` (`src/services/music-provider.ts`) :

```ts
interface MusicProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getCurrentTrack(): Promise<Track | null>;
  getPlaybackState(): Promise<PlaybackState>;
  onStateChange(listener: (state: PlaybackState) => void): () => void;
  isConnected(): boolean;
}
```

Voir `src/services/demo-provider.ts` (aucune dépendance externe), `src/services/spotify-provider.ts` (via IPC + OAuth) et `src/services/system-media-provider.ts` (via IPC + OS, section 6bis) comme références.

## 11. Limitations connues (honnêtes, à date)

- Import d'overlay `.json` non implémenté (export seulement).
- Auto-update non implémenté (architecture prévue pour, non câblée).
- Icônes/identité visuelle (`assets/icon.ico`, favicon) non fournies — à ajouter avant `npm run dist`, sinon electron-builder utilisera une icône par défaut.
- Rien de tout ceci n'a été testé avec un vrai compte Spotify, dans l'app Electron packagée ni dans OBS (voir « État actuel »).
- **Spotify Desktop, recoupement par la fenêtre** : écrit d'après le comportement décrit par d'autres projets (libspotifyctl) ; le script PowerShell correspondant n'a pas pu être exécuté hors Windows. Le titre `Advertisement` de la fenêtre est reconnu en plusieurs langues d'interface mais n'a pas été vérifié pour chacune.
- **Plusieurs artistes en Lecture système** : Batlay affiche la chaîne fournie par Windows. Je n'ai pas pu vérifier ici si Spotify Desktop y place tous les artistes ou seulement le principal ; si c'est le second cas, c'est une limite de la source, et seul le provider Spotify (API, compte Premium) donne la liste complète.
- **Polling PowerShell** : chaque relevé de la Lecture système lance un process PowerShell (quelques centaines de ms). La précision est bonne grâce à l'horodatage exact, mais la détection d'un changement peut prendre jusqu'à ~2 s. Un processus PowerShell persistant réduirait cette latence, mais n'a pas été tenté sans Windows pour le valider.
- **Recherche de pochette et écritures non latines** : `comparable()` (`electron/services/artwork-lookup.ts`) ne garde que `[a-z0-9]`, donc un titre ou un artiste 100 % japonais/cyrillique/arabe y devient une chaîne vide et n'est jamais jugé « plausible » — pas de pochette en ligne pour eux (celle du lecteur, si elle existe, reste utilisée). Non modifié à ce jour (normalisation dédiée).
- **Processus d'une ancienne version** : si une version antérieure de Batlay avec « Start minimized » tourne encore en fenêtre invisible, le verrou d'instance unique du nouveau build lui transmet le second lancement mais l'ancien code ne sait pas y réagir : terminer `Batlay.exe` dans le Gestionnaire des tâches (ou redémarrer) une fois.
- `npm run lint` inutilisable (pas de `eslint.config.*`).
- Les animations d'entrée/sortie (`AnimationConfig`) existent dans le modèle mais ne sont pas encore appliquées ni éditables.
- Le provider "Lecture système" (section 6bis) n'a pas non plus été testé sur une vraie machine Windows — le script PowerShell est écrit selon le pattern WinRT documenté par la communauté, mais à valider en priorité avant `npm run dist`.

## 12. Prochaines étapes suggérées (dans Claude Code)

1. `npm install`, corriger les éventuelles erreurs de compilation.
2. `npm run dev`, tester le Mode Demo de bout en bout (Dashboard → Editor → OBS Browser Source).
3. Tester la connexion Spotify avec un vrai Client ID.
4. Valider la Lecture système sur un vrai Windows (accents, artistes, pochette, position).
5. Implémenter l'import JSON avec validation de schéma.
6. Créer l'identité visuelle (icône, favicon) et configurer `assets/icon.ico`.
7. `npm run dist` sur Windows pour produire et tester `Batlay Setup.exe`.
