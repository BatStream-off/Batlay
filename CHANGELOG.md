# Changelog

Toutes les évolutions notables de Batlay. Le numéro de version suit `package.json`
(vérifié par `tests/version.test.ts`).

## 0.3.6

### Modifié
- **Icônes définitives** : ajout de la source vectorielle `assets/icon.svg` et d'une version `icon_2x.png` (1024 px) ;
  `icon.png`, `icon.ico` et `favicon.png` sont mis à jour.
- **Images de l'installateur** (`assets/installer/*.bmp`) mises à jour avec la nouvelle icône.

## 0.3.5

### Modifié (identité et documentation)
- **Nouvelle icône** (`assets/icon.png`, `icon.ico`, `favicon.png`) : la chauve-souris garde sa place, mais la note de
  musique laisse la place à un symbole d'overlay (écran + bandeau), puisque Batlay gère aussi le chat Twitch.
- **Images de l'installateur** refaites : « Overlay pour le streaming » au lieu de « Overlay musical ».
- **README** refait : présentation, installation, démarrage rapide (musique et chat), réglages du chat, mises à jour.
  L'ancien README technique est conservé dans `docs/DEVELOPPEMENT.md`.

### Ajouté (personnalisation du chat)
- Overlays → **Chat** : **largeur** et **hauteur** de la zone de chat (« Auto » = toute la source OBS ; la zone reste
  collée au bord où arrivent les messages), et cinq autres réglages, tous écrits dans l'URL OBS et visibles dans l'aperçu — **police**
  (Segoe UI, Arial, Georgia, Consolas), **opacité du fond**, **ombre et contour du texte**, **masquer les commandes**
  (messages commençant par « ! ») et **nouveaux messages en haut**. Une URL existante reste valable : chaque réglage
  absent garde sa valeur d'avant.
- Bouton **Redémarrer le lien** : recharge d'un clic les sources OBS du chat connectées (équivalent d'« Actualiser » sur
  la source Navigateur) et indique combien ont été rechargées.

### Amélioré (Vue d'ensemble)
- Cartes **Musique** et **Chat Twitch** refaites : ce qui est affiché en ce moment en tête (pochette et titre du morceau,
  ou avatar et pseudo de la chaîne), puis des points de contrôle avec pastille de couleur (serveur, source, overlay /
  serveur, compte, sources OBS), puis les actions. La carte Musique est teintée par la pochette.
- Bloc **« À régler »** : liste des problèmes en cours, chacun avec un bouton qui mène à la bonne page ; remplacé par
  « Tout est prêt » quand les deux overlays fonctionnent.

### Ajouté (choix de la chaîne du chat)
- Page **Chat** → section **Chaîne affichée** : collez un **pseudo** (`ninja`, `@ninja`) ou un **lien Twitch**
  (`https://www.twitch.tv/ninja`, lien pop-out, `m.twitch.tv`…) pour afficher le chat de n'importe quelle chaîne,
  pas seulement la vôtre. Champ vide ou bouton « Ma chaîne » = votre propre chaîne. Le choix est mémorisé, y compris
  après une déconnexion. La **connexion Twitch reste nécessaire** (elle sert à lire le chat, permission
  `user:read:chat` inchangée). Une chaîne introuvable affiche une erreur et laisse le chat éteint (jamais de repli
  silencieux sur un autre chat).
- **Menu** réorganisé, en trois blocs sans titres : *Vue d'ensemble, Overlays* · *Lecture en cours, Chat Twitch,
  Connexions* · *Paramètres*. Les routes sont inchangées.
- Vue d'ensemble : ligne « Chaîne affichée » ; barre latérale : « Chat de <chaîne> en direct ».

### Ajouté (chat Twitch)
- Page **Twitch** : connexion/déconnexion du compte (OAuth Implicit, sans Client Secret), état du chat, URL OBS,
  message de test. Overlay de chat temps réel (EventSub WebSocket) sur le **port fixe 4000**, totalement
  indépendant de l'overlay musical (port 3000). Voir README §14.
- **Deux sections** dans le dashboard : *Musique* (lecture, overlays, connexions) et *Chat* (Twitch), plus une
  *Vue d'ensemble* qui montre les deux overlays côte à côte. Les deux fonctionnent en même temps dans OBS
  (deux sources Navigateur, ports distincts). L'ancienne page d'accueil musicale est désormais `/musique`,
  `/twitch` redirige vers `/chat` ; les routes `/overlays`, `/editor`, `/connections` sont inchangées.
- Page **Overlays** en deux sections : *Musique* (grille d'overlays inchangée) et *Chat* (réglages taille, nombre de
  messages, disparition, badges, fond, aperçu, URL OBS avec réglages). « Overlays » sort de la section Musique du menu.
- Le port 4000 est réservé : refusé dans Paramètres pour l'overlay musical.

## 0.3.0

### Ajouté (mises à jour)
- **Paramètres → Mises à jour** : recherche, téléchargement puis « Installer et redémarrer » depuis les Releases GitHub
  (`electron-updater`), pastille dans la barre latérale, recherche discrète au démarrage. Voir README §13.
- Workflow GitHub Actions de publication ; l'installateur s'appelle désormais `Batlay-Setup-<version>.exe`.

### Amélioré (graphisme)
- **Polices embarquées** (Inter, Space Grotesk, JetBrains Mono via `@fontsource-variable/*`) : elles n'étaient
  jamais chargées jusqu'ici (la CSP bloque les polices distantes), l'interface retombait sur la police système.
  À faire une fois : `npm install`.
- **Fond ambiant** : halos d'accent (suivent la couleur choisie dans Paramètres) et grain fin, thèmes sombre et clair.
- **Cartes en relief** (`.card`) : dégradé, liseré lumineux, ombre douce ; survol animé sur les overlays.
- **Boutons** en dégradé avec halo, effet d'appui ; interrupteurs, touches `Kbd`, pastilles d'état retravaillés.
- **Barre latérale** : repère lumineux sur l'onglet actif, logo animé pendant la lecture, indicateurs « en ligne » qui pulsent.
- **Tableau de bord** : carte « En cours de lecture » teintée par la pochette floutée, titre en grand,
  barre de progression lumineuse, égaliseur animé.
- Modales (flou d'arrière-plan), menus et notifications (icônes) animés ; entrée échelonnée des pages.
- **Nouvelle icône** : chauve-souris avec une note de musique (`assets/icon.png`, `icon.ico` multi-tailles 16→256 px,
  `favicon.png`), coins transparents, utilisée comme icône de l’application, de la fenêtre et de l’installateur ;
  la barre latérale garde les trois barres d’égaliseur animées.
- **Installateur aux couleurs de Batlay** : assistant en français, bandeau latéral violet avec l’icône, en-tête,
  icônes d’installation/désinstallation, lancement de Batlay à la fin de l’installation.
- Animations désactivées avec « Réduire les animations » de Windows. Aucun token de couleur modifié.

### Ajouté
- **Import d'overlays** : le bouton « Importer » de « Mes overlays » lit un fichier `.json` exporté par Batlay.
  Le fichier est vérifié avant tout ajout (format, taille du canvas, type des composants) et l'overlay reçoit
  un **nouveau lien OBS** : l'identifiant du fichier n'est jamais réutilisé. Un nom déjà pris devient « Nom (2) ».
- Tableau de bord : une fois la source, l'overlay et le serveur prêts, le guide « Mise en route » se replie en
  une ligne avec le bouton « Copier l'URL OBS » ; « Revoir les étapes » le rouvre.
- Tableau de bord : le morceau en cours affiche l'état lecture/pause, l'album et le lecteur d'origine.
- Marque Batlay dans la barre latérale (visible aussi quand la barre est réduite).

### Modifié
- Tableau de bord : le morceau en cours passe au premier plan (pochette agrandie) et l'aperçu de l'overlay
  principal rejoint la même carte, au lieu de trois cartes identiques.
- Titres de section en casse normale (Paramètres, éditeur) au lieu de petites capitales grises.
- Fenêtres modales : le focus entre dans la fenêtre à l'ouverture, reste dedans avec Tab, et revient sur le
  bouton d'origine à la fermeture.
- Champs de saisie : anneau de focus visible au clavier.

### Inchangé volontairement
- Couleurs des thèmes sombre et clair, page overlay d'OBS, `OverlayPreview`, détection de la lecture système
  et liste multi-artistes.

## 0.1.1

### Ajouté
- Bouton pour **régénérer le lien OBS** d'un overlay (menu « … » de « Mes overlays ») et de tous les
  overlays (Paramètres > Serveur d'overlay). L'ancien lien cesse de fonctionner et le nouveau est copié.
