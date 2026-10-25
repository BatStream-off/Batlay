# Changelog

Toutes les évolutions notables de Batlay. Le numéro de version suit `package.json`
(vérifié par `tests/version.test.ts`).

## 0.3.7

### Ajouté (alertes : followers et abonnés)
- Page **Alertes** et page overlay **`/alerts`**. Une seule source Web pour toutes les alertes, sur le même port que la musique : `http://batlay.test:3000/alerts`.
- **Types d'alertes** : nouveau follower, nouvel abonné, réabonnement (avec le message du spectateur), abonnements offerts. Chacune est personnalisable :
  - titre et texte avec variables (`{user}`, `{amount}`, `{months}`, `{tier}`, `{message}`, `{platform}`) ;
  - **image** (PNG, JPG, GIF animé, WebP) ;
  - **son** (carillon intégré ou fichier MP3, OGG, WAV) et volume ;
  - durée, animations d'apparition et de disparition (moteur commun), disposition, couleurs, taille, carte.
  
  Aperçu immédiat, bouton **Tester**, bouton **Passer**. Les alertes s'affichent une par une, sans doublon ; la file est limitée à 30 alertes en attente.
- **Twitch** : EventSub officiel (`channel.follow` v2, `channel.subscribe`, `channel.subscription.message`, `channel.subscription.gift`), pour la chaîne du compte connecté. Deux permissions **facultatives** en lecture seule sont demandées à la connexion : `moderator:read:followers` et `channel:read:subscriptions`. Le bouton « Reconnecter Twitch » permet de les accorder sans interrompre le chat. Un abonnement offert à plusieurs personnes donne une seule alerte.
- **TikTok** : TikTok ne propose pas d'API officielle pour les événements d'un live, et Batlay n'utilise aucun protocole non officiel. Une **adresse locale à clé secrète** (`/api/alerts/hook/<clé>`, en GET ou POST) permet à un outil déjà connecté à TikTok (TikFinity, Streamer.bot…) de déclencher les alertes. Le débit est limité (20 alertes / 10 s) et la clé peut être régénérée.
- **Fond « pochette »** (fond de l'overlay et fond de chaque composant) : la pochette du morceau en cours, agrandie et floutée, avec flou, zoom et assombrissement réglables. Un fondu marque chaque changement de morceau, et une couleur de secours s'affiche sans pochette.

### Sécurité (alertes)
- **Fichiers importés** :
  - type reconnu par le contenu (pas par le nom) ;
  - 8 Mo au maximum ;
  - stockés sous un nom calculé (hash) dans le dossier de Batlay ;
  - servis uniquement pour des identifiants validés.
- Les textes des alertes (pseudos, messages) sont nettoyés et rendus comme du texte, jamais comme du HTML.
- CSP du tableau de bord : seul `media-src 'self' data: blob:` a été ajouté, pour écouter les sons dans l'aperçu.

### Corrigé (TikTok LIVE Studio)
- Le champ « Lien » de TikTok LIVE Studio refuse les adresses `localhost` et `127.0.0.1` (« Saisis l'URL correcte ») : la page Intégrations propose désormais pour TikTok une URL en **`http://batlay.test:<port>/…`**. Ce nom réservé (`.test`, RFC 6761) n'existe sur aucun DNS public : il ne pointe vers le PC qu'après l'ajout de la ligne `127.0.0.1 batlay.test` au fichier hosts de Windows, avec la marche à suivre et une vérification en lecture seule dans Batlay (Batlay ne modifie jamais ce fichier).
- **Configuration automatique** : au premier lancement sous Windows, Batlay propose d'ajouter lui-même la ligne au fichier hosts. Windows demande l'autorisation (fenêtre d'administrateur), et la demande n'est faite qu'une fois. Le bouton « Configurer automatiquement » (Intégrations) permet de réessayer, et « Retirer » enlève cette seule ligne. Les scripts sont fixes et ne touchent qu'à `127.0.0.1 batlay.test`.
- **`batlay.test` partout** : dès que ce nom pointe vers le PC, toutes les URL copiées (OBS, chat, barre latérale, éditeur) l'utilisent. Les anciennes URL en `localhost` continuent de fonctionner.
- Les deux serveurs (musique et chat) acceptent ce nom en plus de `localhost` / `127.0.0.1`, et seulement lui : sous-domaines et autres noms toujours refusés. Ils écoutent toujours sur 127.0.0.1 uniquement.

### Ajouté (moteur d'animations et de transitions)
- **Moteur commun** (`src/animation/`) basé sur la Web Animations API native, sans nouvelle dépendance. Il gère :
  - l'entrée, la sortie et les transitions entre deux états ;
  - la durée, le délai, l'accélération et les répétitions ;
  - l'annulation et le remplacement d'une animation en cours, et le nettoyage au retrait du DOM ;
  - le mouvement réduit.
  
  Il est conçu pour servir aussi aux futures alertes et futurs widgets.
- **Effets** :
  - entrée : fondu, 4 glissements, zoom avant, rebond, révélation du texte ;
  - sortie : fondu, 4 glissements, zoom arrière, réduction, flou ;
  - décoratifs : pulsation, lueur, brillance, flottement, rotation de la pochette.
- **Overlay musique** : transition par composant à chaque changement de morceau (pochette, titre, artistes…). La stabilisation contre les clignotements fait qu'une rafale de métadonnées ne produit qu'une seule transition. Un état tardif est ignoré, et l'overlay sort proprement quand la musique s'arrête.
- **Éditeur** :
  - section **Animations et transitions** : Subtil, Fluide, Dynamique, Gaming, Sans animation, entrée, sortie, durée, réglages avancés ;
  - onglet **Animation** par composant : transition propre ou aucune, effet décoratif ;
  - aperçu immédiat et bouton **Tester la transition**.
  
  Les réglages s'appliquent en direct dans OBS à l'enregistrement.
- **Chat Twitch** : arrivée et départ animés des messages. Les messages sortants gardent leur place, aucun chevauchement. La modération retire toujours immédiatement. Nouveaux paramètres d'URL `anim`, `out`, `ad`, `motion` (absents = comportement par défaut), réglables dans Overlays → Chat.

### Compatibilité
- Les overlays enregistrés et les presets sont lus sans changement : les nouveaux champs d'animation sont facultatifs. L'arrivée par défaut des messages reproduit l'ancienne animation CSS. Les URL existantes restent valables.
- **Changement visible** : les réglages d'animation des presets existaient depuis la v0.1 mais n'étaient pas appliqués. Ils le sont désormais : choisir « Sans animation » rétablit l'affichage instantané. Le chat ajoute un fondu de 180 ms au départ des messages (`out=none` pour l'ancien comportement).

### Ajouté (intégrations multi-logiciels)
- Page **Intégrations** (barre latérale) : OBS Studio, **TikTok LIVE Studio**, Streamlabs Desktop, XSplit Broadcaster et « Autre logiciel ». Pour chacun : statut de compatibilité **honnête** (référence / documentée / partielle / non vérifiée), source à utiliser, étapes, limites connues, alternatives, lien vers la documentation officielle quand elle existe. Thèmes sombre et clair.
- TikTok LIVE Studio : source « Link » (compatibilité partielle, non documentée par TikTok) et méthode de secours par la caméra virtuelle d'OBS.
- Par overlay : URL, **Copier l'URL**, **Copier la taille**, taille de source conseillée pour les formats paysage 1920 × 1080, portrait 1080 × 1920 et carré 1080 × 1080, et compteur **« sources connectées »**.
- Options d'URL facultatives : variante `127.0.0.1` et **Ajuster à la source** (`?fit=contain`, overlay musical). Les URL existantes ne changent pas.
- **Quel overlay est derrière cette URL ?** : identifie une URL collée (overlay, chat, lien révoqué).
- Module `src/integrations/` et guide `docs/INTEGRATIONS.md`.

### Sécurité
- Le serveur d'overlay musical (port 3000) refuse désormais les requêtes dont le `Host` n'est pas local (DNS-rebinding) et les WebSocket ouverts depuis une autre origine, comme le serveur du chat. Il écoute toujours sur 127.0.0.1 uniquement.
- Les liens de documentation sont ouverts par identifiant, à partir d'une liste fermée côté process principal.

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
