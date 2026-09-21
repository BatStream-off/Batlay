import { ProgressClock } from "@/utils/progress-clock";

/**
 * Horloge de progression unique du renderer (Dashboard, éditeur...).
 * Alimentée par useMusicStore à chaque état émis par le provider ; les
 * composants ne font que la LIRE (voir src/components/LiveProgress.tsx).
 * La page overlay d'OBS, qui est un autre bundle, possède sa propre
 * instance alimentée par le WebSocket, avec exactement la même logique.
 */
export const playbackClock = new ProgressClock();
