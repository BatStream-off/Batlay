import { useCallback } from "react";
import { useToastStore } from "@/stores/useToastStore";

/**
 * Copie l'URL OBS d'un overlay et prévient l'utilisateur. Centralisé ici car
 * l'action est proposée à quatre endroits (barre latérale, tableau de bord,
 * liste des overlays, éditeur) : le message d'erreur (serveur arrêté...) doit
 * être le même partout.
 */
export function useCopyObsUrl() {
  const push = useToastStore((s) => s.push);
  return useCallback(
    async (overlayId: string): Promise<boolean> => {
      try {
        const url = await window.batlay.overlay.getUrl(overlayId);
        await navigator.clipboard.writeText(url);
        push("URL OBS copiée — collez-la dans une source « Navigateur » d'OBS.", "success");
        return true;
      } catch (err) {
        push(
          (err as Error).message || "Impossible de récupérer l'URL — le serveur d'overlay est-il démarré ?",
          "error"
        );
        return false;
      }
    },
    [push]
  );
}
