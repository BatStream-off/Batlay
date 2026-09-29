# Changelog

Toutes les évolutions notables de Batlay. Le numéro de version suit `package.json`
(vérifié par `tests/version.test.ts`).

<<<<<<< HEAD
## 0.3.0

### Ajouté (mises à jour)
- **Paramètres → Mises à jour** : recherche, téléchargement puis « Installer et redémarrer » depuis les Releases GitHub
  (`electron-updater`), pastille dans la barre latérale, recherche discrète au démarrage. Voir README §13.
- Workflow GitHub Actions de publication ; l'installateur s'appelle désormais `Batlay-Setup-<version>.exe`.
=======
## 0.2.0
>>>>>>> 961f5a43fac0db67de2259d44ddaadc0ce6db13e

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
<<<<<<< HEAD
- **Nouvelle icône** : chauve-souris avec une note de musique (`assets/icon.svg`, `icon.png`, `icon.ico`),
  utilisée comme icône de l’application ; la barre latérale garde les trois barres d’égaliseur animées.
=======
>>>>>>> 961f5a43fac0db67de2259d44ddaadc0ce6db13e
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
