# Changelog

Toutes les évolutions notables de Batlay. Le numéro de version suit `package.json`
(vérifié par `tests/version.test.ts`).

## 0.4.0

### Ajouté : overlays personnalisés
- Nouvelle section **Overlays → Personnalisés**, avec **Créer un overlay** et 9 modèles prêts à modifier :
  - Toile vide (1920 × 1080) ;
  - Ça commence bientôt, Pause, Fin du live ;
  - Cadre webcam ;
  - Bandeau réseaux ;
  - Écran vertical TikTok (1080 × 1920, textes hors des zones de l'interface TikTok) ;
  - Logo ou image.
- **Toujours affichés**, même quand aucune musique ne joue, contrairement aux overlays musicaux qui se masquent. Un texte qui ne contient que des variables de musique (« ♪ {title} — {artist} ») disparaît proprement quand rien ne joue.
- **Images** : nouveau composant **Image** (PNG, JPG, GIF animé, WebP, 8 Mo max). Trois façons d'en ajouter :
  - « Image » dans la palette ;
  - **glisser un fichier sur le canvas** : l'image est posée là où on la lâche ;
  - **coller** une image (Ctrl+V), par exemple une capture d'écran.

  L'image garde ses proportions. Réglage « Image entière / Remplir le cadre », « Changer l'image ». Dans les modèles, les emplacements d'image sont marqués en pointillés dans l'éditeur, jamais dans OBS.
- **Horloge** : nouveau composant (heure, heure et secondes, date, date et heure), mis à jour en direct, avec les réglages de texte habituels.
- **Compte à rebours** : nouveau composant (« 04:59 »), lancé quand la source s'affiche dans OBS. Durée réglable en minutes et secondes, texte de fin (« C'est parti ! »).
- **Infos du live dans les textes** : nouvelles variables `{lastFollower}`, `{lastSub}`, `{lastGift}`, `{followers}`, `{subs}`, `{gifts}`, `{messages}`. Ce sont les totaux Twitch + TikTok depuis l'ouverture de Batlay ou la remise à zéro (page Live).
  - Envoyées en direct aux pages d'overlay.
  - Un nouveau « dernier follower » rejoue l'animation du texte.
  - Un texte dont les variables sont encore vides (aucun follower) reste masqué.
  - Les alertes de test ne comptent pas.
- **Objectif** : nouveau composant barre de progression (followers, abonnés, cadeaux ou messages), avec objectif, libellé, « 12 / 20 » et couleurs réglables. La barre avance en douceur.
- **Mes images** : sous la palette de l'éditeur, les images déjà importées (overlays et alertes) se réutilisent d'un clic.
- Modèles mis à jour :
  - compte à rebours dans « Ça commence bientôt » ;
  - dernier follower dans « Pause » ;
  - dernier abonné dans « Fin du live » ;
  - nouveau modèle **Objectif du live**.
- Polices de l'éditeur : **13 de plus** (Space Grotesk, JetBrains Mono, Bahnschrift, Comic Sans MS, Segoe Print, Ink Free, Gabriola, Palatino…). Les polices de Batlay sont maintenant chargées dans la page OBS.
- Dans un overlay personnalisé, la palette propose d'abord Image, Texte, Forme et Horloge.

### Ajouté : TikTok en « mode navigateur » (nouvelle méthode par défaut)
- Batlay ouvre la page de votre live TikTok dans une **fenêtre invisible** (jamais affichée, absente de la barre des tâches, son coupé, sans vidéo ni images) et lit les événements que TikTok envoie à cette page : follows, Super Fans, cadeaux, commentaires, fin du live.
- **Aucun service tiers** : plus besoin d'Euler Stream. La page utilise la session TikTok connectée dans Batlay, donc ça marche aussi pour un **compte privé** (connectez votre compte dans la carte TikTok).
- Nouveau choix **Méthode** dans la carte TikTok : « Navigateur intégré (recommandé) » ou « Bibliothèque (Euler) », l'ancienne méthode. Changer de méthode rebranche aussitôt.
- Si la page s'ouvre sans flux, Batlay réessaie en alternant avec et sans vidéo. La fenêtre invisible est fermée à la déconnexion, à la fin du live et en quittant Batlay.
- Le diagnostic indique la méthode utilisée.

### Ajouté : diagnostic TikTok
- Bouton **Diagnostic** dans la carte TikTok (page Alertes). Il vérifie chaque étape sans ouvrir de connexion au live :
  - bibliothèque installée (et sa version) ;
  - pseudo et compte ;
  - session TikTok ;
  - live trouvé, caché ou absent ;
  - dernier état de la connexion.

  Chaque étape a un résultat clair (OK, attention, échec) et un rapport texte à copier pour demander de l'aide.

### Sécurité
- Les images sont vérifiées par leur contenu à l'import, stockées dans le dossier de Batlay sous un nom calculé, et servies seulement par le serveur local. Un overlay importé (.json) qui référence une image au nom invalide est refusé.

## 0.3.9

### Ajouté : fenêtre « Live »
- Nouvelle page **Live** (barre latérale, sous « Vue d'ensemble ») : tout le live au même endroit.
  - **Chats Twitch et TikTok** : fusionnés (par ordre d'arrivée, avec un repère de couleur), **côte à côte**, ou un seul. La liste suit les nouveaux messages ; si vous remontez lire, un bouton « N nouveaux messages » vous ramène en bas. Émotes Twitch affichées, messages supprimés par la modération retirés.
  - **Compteurs du live** : nouveaux followers, abonnés (Twitch : abonnements et réabonnements ; TikTok : Super Fans), cadeaux (abonnements offerts sur Twitch, cadeaux TikTok en quantité), messages. Total et détail Twitch / TikTok, depuis l'ouverture de Batlay ou depuis **Remettre à zéro**. Les tests ne sont pas comptés.
  - **Journal d'activité lisible**, du plus récent au plus ancien. Pour chaque alerte : type, plateforme, pseudo, résumé (« 5 × Rose », « 14 mois · « message » »…) et **ce qui lui est arrivé**, en clair : « Affichée », « Non affichée : ce type d'alerte ou cette plateforme est désactivé », « Non affichée : aucune page d'alertes ouverte dans le logiciel de streaming », « Non affichée : trop d'alertes en peu de temps ». Bouton **Rejouer**. Les connexions y sont aussi notées : chat Twitch connecté ou coupé, live TikTok branché, en attente, caché, terminé. Filtres : Tout / Alertes / Connexions, et par plateforme.
- **Ouvrir dans une fenêtre** : la page Live dans une fenêtre séparée (pour un second écran), avec **Toujours visible** pour la garder au-dessus du jeu ou d'OBS. Mêmes protections que la fenêtre principale ; elle se ferme avec Batlay.

### Interface (passe visuelle)
- **Vue d'ensemble** refaite :
  - bandeau « Le live en chiffres » (followers, abonnés, cadeaux, messages, dont le chiffre rebondit à chaque nouvel événement) ;
  - trois cartes Musique, Chat Twitch et **TikTok** (compte, état du live, session) ;
  - **Dernières alertes** avec leur issue ;
  - liste « À régler » qui inclut maintenant TikTok (live caché, erreur) ;
  - bouton **Fenêtre Live** et accueil personnalisé (« Bonsoir Adil ! »).
- **Barre latérale** : étiquette **LIVE** animée sur « Live » quand le live TikTok est branché, et nouvelle ligne d'état TikTok en bas (en live, en attente, caché, erreur), qui mène à la carte TikTok.
- **Paramètres → Apparence** :
  - **Densité** Confortable / Compacte (toute l'interface un peu plus petite pour en voir plus) ;
  - **Animations de l'interface** Normales / Réduites (n'agit pas sur les overlays ; la préférence de Windows reste respectée) ;
  - **8 couleurs d'accent** en un clic, en plus de la pipette.
- **Animations de l'interface** : nouvelles lignes du journal et des chats qui glissent en place, compteurs qui rebondissent, halo pulsé sur les étiquettes « Live ». Tout est coupé en mouvement réduit.
- **Cohérence** : largeurs de page harmonisées (pages de suivi larges, pages de réglages étroites), titres alignés sur le menu (« Chat Twitch », « Lecture en cours »), couleurs passées par le thème (clair et sombre).

- **Palette de commandes** (**Ctrl+K**, ou « Rechercher… » en haut de la barre latérale) :
  - aller à n'importe quelle page ;
  - copier l'URL OBS d'un overlay, du chat ou des alertes ;
  - tester une alerte ou passer celle en cours ;
  - ouvrir la fenêtre Live, changer de thème ou de densité.

  Recherche sans accents ni majuscules ; ↑ ↓ pour choisir, Entrée pour lancer.
- **Barre latérale réductible sur toutes les pages** (et plus seulement dans l'éditeur), choix mémorisé.
- **Interrupteurs** : les cases à cocher des réglages (alertes, éditeur, chat) deviennent des interrupteurs, les mêmes que dans les Paramètres.
- **Page Alertes** :
  - types d'alerte présentés en onglets avec icône et pastille « activée » (au lieu d'un sélecteur serré) ;
  - carte Twitch avec la chaîne concernée et des boutons pour essayer chaque alerte Twitch.

### Ajouté : chat
- **Chat TikTok** : les commentaires du live TikTok (branché dans Alertes → TikTok) arrivent dans la fenêtre Live **et dans l'overlay du chat**.
- Overlay du chat : réglage **Plateformes** (Twitch + TikTok, Twitch seulement, TikTok seulement ; paramètre d'URL `src=`) et **repère Twitch / TikTok** devant le pseudo (`pico=1`). Par défaut, les deux plateformes sont affichées sans repère : une source Twitch existante ne change pas tant que TikTok n'est pas branché.
- **19 polices de plus** pour le chat (23 en tout) : Inter, Space Grotesk et JetBrains Mono (embarquées dans la page), et des polices livrées avec Windows : Verdana, Trebuchet MS, Tahoma, Bahnschrift, Calibri, Candara, Franklin Gothic, Impact, Comic Sans MS, Segoe Print, Ink Free, Gabriola, Times New Roman, Palatino, Cascadia Code, Courier New. Le paramètre `font=` accepte aussi les majuscules.

### Ajouté : animations
- Moteur commun : **6 nouvelles entrées** (Mise au point, Bascule 3D, Balancement, Chute avec rebond, Élastique, Arrivée de loin) et **3 nouvelles sorties** (Bascule 3D, Chute, Éclatement). Elles sont proposées automatiquement partout : chat, alertes, composants des overlays. Elles n'animent que `opacity`, `transform` et, pour la mise au point, `filter` (plafonné à 8 px).

### Technique
- `electron/shared/live.ts` (pur) et `electron/services/live/live-hub.ts` (mémoire de la session, sans écriture sur disque). `AlertHub` signale chaque résultat (`onResult`) et sait rejouer une alerte (`replay`). Le service Twitch recopie les messages des overlays (`onOverlayMessage`) et accepte les messages TikTok (`injectChat`). `ChatMessage.platform` est facultatif (absent = Twitch).
- Tests : `tests/live.test.ts` (16), polices et plateformes du chat, nouveaux effets.

## 0.3.8

### Ajouté (TikTok directement dans Batlay)
- Page **Alertes → TikTok** : pseudo (`@pseudo` ou lien du live) → **Se connecter**. Aucun mot de passe, aucun outil tiers à installer.
- Batlay **attend le live** et s'y branche tout seul, puis s'y **rebranche** après une coupure, au live suivant et au redémarrage de Batlay. **Déconnecter** arrête tout. L'état est affiché : Déconnecté, Connexion…, En live, En attente du live (avec le prochain essai), Erreur.
- Événements : **follows** (une alerte par spectateur et par live), nouveaux **Super Fans** (abonnés TikTok) → alerte « Nouvel abonné », **cadeaux**.
- Nouveau type d'alerte **Cadeau TikTok** : texte par défaut `{user} envoie {amount} × {gift} !`, nouvelle variable `{gift}` (nom du cadeau). Une série de cadeaux donne **une seule** alerte, à la fin de la série. Réglage **Alertes de cadeaux** : tous, ou à partir de 5 / 10 / 50 / 100 / 500 / 1 000 diamants (quantité comprise).
- L'adresse locale pour TikFinity, Streamer.bot… reste disponible (repliée dans la carte TikTok) et accepte aussi `type=tiktokGift` (alias `cadeau`) avec `gift=`.

### Fonctionnement et limites
- TikTok ne propose pas d'API officielle : Batlay utilise la bibliothèque communautaire **`tiktok-live-connector`** (non officielle, nouvelle dépendance). Elle fait valider la connexion par un **service tiers, Euler Stream**, qui reçoit le pseudo (jamais de mot de passe ni de session). Lecture seule : Batlay n'écrit rien dans le live. Peut cesser de fonctionner si TikTok change son site ; non autorisé par TikTok.
- Nouveaux essais espacés (hors live 90 s, service saturé 5 min, après la fin du live 60 s), car la version gratuite du service limite les connexions.
- **Compte vérifié même hors live** : à la connexion, Batlay vérifie le pseudo avec l'oEmbed officiel de TikTok (profil public, sans clé) et affiche le nom du compte avec « Compte trouvé » et « Hors live ». Un pseudo inexistant est signalé tout de suite. Si la vérification est impossible (réseau), Batlay continue quand même.
- **Recherche du live par Batlay** : l'identifiant du live est cherché par Chromium (page du live, puis API « api-live »), comme un navigateur, avec des cookies TikTok séparés du reste de Batlay. La bibliothèque le reçoit directement : elle ne fait plus elle-même ces requêtes depuis Node, où TikTok les bloquait (« Failed to retrieve Room ID from all sources » alors que le live était lancé). Hors live constaté : aucune requête au service de signature.
- **Fenêtre Chromium invisible** : la recherche du live ouvre d'abord la page du live dans une fenêtre cachée (bac à sable, sans Node ni preload, son coupé, images et vidéo bloquées, aucune permission, navigation limitée à tiktok.com, fermée après 20 s au plus) et lit les informations comme le site lui-même. Un « en live » trouvé par une méthode l'emporte sur un « terminé » d'une autre. Le nom du compte est repris de la réponse. Chaque étape (statut, identifiant du live, captcha…) apparaît dans « Détails techniques ».
- **Compte privé** : TikTok cache l'identifiant du live d'un compte privé aux visiteurs non connectés (statut « en live » mais identifiant vide, constaté sur un vrai live). Batlay ne le prend plus pour « pas en live » : il affiche « Live caché (compte privé) » et explique comment passer le compte en public.
- **Connexion facultative du compte TikTok** (pour un compte privé) : bouton « Se connecter à TikTok ». Il ouvre la page de connexion officielle de TikTok dans une fenêtre de Batlay (bac à sable, sans preload, https uniquement), où le code QR de l'appli TikTok marche aussi. Batlay ne voit jamais le mot de passe et ne lit que la présence du cookie de session, jamais sa valeur. La session reste dans une partition dédiée sur ce PC et sert uniquement aux requêtes vers tiktok.com : elle n'est jamais envoyée au service de signature tiers. « Se déconnecter de TikTok » efface toute cette partition. Dès la connexion, Batlay relance la recherche du live.
- « Live introuvable » (aucun identifiant de live, cas normal hors live) n'est plus pris pour un compte inexistant : Batlay attend et réessaie. Bouton **Réessayer maintenant**, et **Détails techniques** (message brut de la bibliothèque, copiable) en cas d'échec.
- Bibliothèque chargée à la demande : si elle manque ou plante, Batlay démarre quand même et l'indique dans la carte.
- `package.json` → `overrides` : `got` 14 sous `tiktok-live-connector` (`got` 15 exige Node 22, Electron 31 embarque Node 20).
- **Non testé sur un vrai live TikTok** (inaccessible depuis l'environnement de développement) : conversion des événements écrite d'après la documentation et le code source de la bibliothèque, testée avec de fausses données.

### Corrigé
- Deux tests anciens qui échouaient et auraient bloqué la publication automatique (`npm test` dans le workflow) : `twitch-chat-feed` (aller-retour des options) et `twitch-server` (`reloadClients`, attente de la fermeture des connexions précédentes).

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
- **TikTok** : TikTok ne propose pas d'API officielle pour les événements d'un live. Une **adresse locale à clé secrète** (`/api/alerts/hook/<clé>`, en GET ou POST) permet à un outil déjà connecté à TikTok (TikFinity, Streamer.bot…) de déclencher les alertes. Le débit est limité (20 alertes / 10 s) et la clé peut être régénérée.
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
- Le champ « Lien » de TikTok LIVE Studio refuse les adresses `localhost` et `127.0.0.1` (« Saisis l'URL correcte ») : la page Intégrations propose désormais pour TikTok une URL en **`http://batlay.test:<port>/…`**. Ce nom réservé (`.test`, RFC 6761) n'existe sur aucun DNS public : il ne pointe vers le PC qu'après l'ajout de la ligne `127.0.0.1 batlay.test` au fichier hosts de Windows, avec la marche à suivre et une vérification dans Batlay.
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
