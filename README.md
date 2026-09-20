# Batlay

**Batlay** est une application desktop Windows permettant de créer des overlays musicaux personnalisés pour **OBS Studio**.

Connectez Spotify ou utilisez la lecture système Windows, personnalisez votre overlay dans l'éditeur, puis ajoutez-le à OBS via une **Browser Source**.

---

## ✨ Fonctionnalités

* 🎵 Affichage du morceau en cours
* 🎤 Support de plusieurs artistes
* 🖼️ Pochette d'album
* ⏱️ Progression en temps réel
* 🎨 Éditeur d'overlays complet
* 🖱️ Glisser-déposer des composants
* 📐 Redimensionnement et alignement
* 🎭 7 presets d'overlays
* 🌈 Couleurs, dégradés, bordures et ombres
* 🌙 Thèmes sombre, clair et système
* ↩️ Annuler / rétablir
* 💾 Sauvegarde des overlays
* 📡 Mise à jour en temps réel dans OBS
* 🎧 Mode Demo
* 🪟 Lecture système Windows
* 🔐 OAuth PKCE pour Spotify
* 🧪 Plus de 190 tests automatisés

---

# 🚀 Installation

## 👤 Pour les utilisateurs

**Aucune installation de Node.js ou de npm n'est nécessaire.**

Téléchargez simplement la dernière version de **Batlay** dans la section **Releases**, puis lancez :

```text
Batlay Setup.exe
```

L'installateur s'occupe de l'installation de l'application et de ses dépendances.

Une fois installé, lancez **Batlay** depuis Windows.

> Batlay est actuellement disponible pour Windows.

---

## 👨‍💻 Pour les développeurs

Si vous souhaitez récupérer le code source et développer le projet :

### Prérequis

* Windows
* Node.js
* npm

### Installation

```bash
npm install
```

### Développement

```bash
npm run dev
```

### Tests

```bash
npm test
```

### Build

```bash
npm run build
```

### Générer l'installateur Windows

```bash
npm run dist
```

L'installateur sera généré dans :

```text
release/Batlay Setup.exe
```

Le dossier `release/` est exclu du dépôt Git.

---

# 🎵 Spotify

Batlay peut se connecter à Spotify via l'API officielle.

> ⚠️ **Un compte Spotify Premium est requis pour utiliser l'intégration Spotify de Batlay.**

La connexion utilise OAuth PKCE et aucun Client Secret n'est intégré dans Batlay.

### Alternative : Lecture système Windows (SMTC)

Vous n'avez pas Spotify Premium ? Batlay propose une alternative avec la **Lecture système Windows (SMTC)**.

Elle récupère directement les informations du lecteur multimédia utilisé par Windows, sans nécessiter de compte Spotify ni de Client ID.

Compatible notamment avec :

* Spotify Free
* YouTube Music
* VLC
* Les applications compatibles avec les **Global System Media Transport Controls**

Dans Batlay :

```text
Connections → Lecture système (Windows) → Connect
```

Vous pouvez également choisir le lecteur à suivre lorsqu'il y a plusieurs applications multimédias actives.

La lecture système permet de récupérer le titre, l'artiste, la pochette et la progression lorsque ces informations sont fournies par l'application source.

---

### 4. Autoriser votre compte

Si votre application Spotify est en Development Mode, ajoutez votre compte Spotify dans la liste des utilisateurs autorisés.

### 5. Connecter Spotify

Cliquez sur **Connect Spotify**.

Un navigateur s'ouvrira pour autoriser Batlay.

Le refresh token est stocké localement et protégé via `safeStorage` / DPAPI sous Windows.

---

# 🎧 Mode Demo

Vous pouvez tester Batlay sans compte Spotify.

```text
Connections → Demo Mode → Start Demo
```

Le Mode Demo permet de tester les overlays, la progression, les animations et l'intégration OBS.

---

# 🪟 Lecture système Windows

Batlay peut également récupérer les informations du lecteur multimédia directement depuis Windows.

Compatible notamment avec :

* Spotify
* YouTube Music
* VLC
* Les applications compatibles avec les **Global System Media Transport Controls**

Cette méthode ne nécessite **aucun compte Spotify ni Client ID**.

Elle permet également de sélectionner le lecteur à suivre lorsqu'il y a plusieurs sessions multimédias actives.

---

# 🎨 Éditeur d'overlay

L'éditeur permet de créer un overlay depuis zéro ou à partir d'un preset.

### Composants

* Pochette
* Titre
* Artiste(s)
* Album
* Barre de progression
* Temps écoulé
* Temps restant
* Durée
* Source
* Texte libre
* Formes et fonds

### Personnalisation

* Position
* Taille
* Couleurs
* Dégradés
* Transparence
* Bordures
* Arrondis
* Ombres
* Typographies
* Opacité

Les composants peuvent être déplacés, redimensionnés, dupliqués, réorganisés, masqués, verrouillés ou supprimés.

L'éditeur prend également en charge l'annulation/rétablissement, le magnétisme et l'alignement.

---

# 📺 Utilisation avec OBS

1. Ouvrez un overlay dans **Editor**.
2. Copiez l'**Overlay URL**.
3. Dans OBS, ajoutez une **Browser Source**.
4. Collez l'URL.
5. Utilisez les dimensions du canvas indiquées dans l'éditeur.

L'overlay possède un fond transparent par défaut.

Les modifications enregistrées dans Batlay sont envoyées à OBS en temps réel.

---

# 🏗️ Architecture

```text
Batlay/
├── electron/
│   ├── main/
│   │   └── index.ts
│   ├── preload/
│   │   └── index.ts
│   ├── services/
│   │   ├── config-store.ts
│   │   ├── spotify-auth.ts
│   │   └── overlay-server.ts
│   └── shared/
│       └── types.ts
│
├── src/
│   ├── pages/
│   ├── stores/
│   ├── services/
│   ├── presets/
│   └── components/
│       └── OverlayPreview.tsx
│
├── overlay/
│   ├── main.tsx
│   └── OverlayApp.tsx
│
├── tests/
│
└── vite.config.ts
```

---

# ⚠️ Limitations connues

* L'import JSON des overlays n'est pas encore disponible.
* L'auto-update n'est pas encore implémenté.
* Certaines fonctions de recherche de pochettes peuvent être limitées pour les titres/artistes utilisant uniquement des caractères non latins.
* Les animations d'entrée/sortie existent dans le modèle mais ne sont pas encore éditables.
* `npm run lint` nécessite une configuration ESLint compatible avec ESLint 9.

---

# 📦 Releases

Les versions prêtes à l'emploi sont disponibles dans **GitHub Releases**.

Pour utiliser Batlay, **vous n'avez pas besoin de cloner le projet, d'installer Node.js ou d'exécuter `npm install`**.

Téléchargez simplement :

```text
Batlay Setup.exe
```

et installez l'application.

---

## 📄 Licence

Licence : Tous droits réservés.

---

**Batlay — Des overlays musicaux personnalisables pour OBS.**
