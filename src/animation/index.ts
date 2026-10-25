/**
 * Moteur d'animations commun de Batlay (overlay musique, chat Twitch, et
 * demain alertes / widgets). Quatre couches, chacune utilisable seule :
 *   - config.ts   : identifiants, valeurs par défaut, validation, combinaisons (pur) ;
 *   - effects.ts  : bibliothèque d'effets = images clés Web Animations (pur) ;
 *   - swap.ts / presence.ts : machines d'état des transitions et des listes (pur) ;
 *   - engine.ts   : lecture via element.animate, annulation, mouvement réduit ;
 *   - react.tsx   : AnimationProvider, AnimatedSwap, useListItemMotion.
 * Documentation : docs/DEVELOPPEMENT.md §6nonies.
 */
export * from "./config";
export * from "./effects";
export * from "./engine";
export * from "./swap";
export * from "./presence";
