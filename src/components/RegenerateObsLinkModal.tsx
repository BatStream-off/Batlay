import { RefreshCw } from "lucide-react";
import { Button, Modal } from "@/components/ui";

interface RegenerateObsLinkModalProps {
  /** Nom de l'overlay concerné ; absent = tous les overlays. */
  overlayName?: string;
  /** Nombre d'overlays concernés quand on les régénère tous. */
  count?: number;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Confirmation avant de régénérer un lien OBS. L'action est immédiate et sans
 * retour : l'ancien lien s'arrête à l'instant, donc la source « Navigateur »
 * d'OBS reste vide tant que le nouveau lien n'y est pas collé. D'où la
 * confirmation, partagée entre la page Overlays (un lien) et les Paramètres
 * (tous les liens) pour que le message soit le même partout.
 */
export function RegenerateObsLinkModal({ overlayName, count = 0, onConfirm, onClose }: RegenerateObsLinkModalProps) {
  const single = overlayName !== undefined;
  const title = single ? "Régénérer le lien OBS" : "Régénérer tous les liens OBS";

  return (
    <Modal title={title} onClose={onClose}>
      <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
      <p className="mt-2 text-sm text-fg">
        {single
          ? `Un nouveau lien va être créé pour « ${overlayName} ».`
          : `Un nouveau lien va être créé pour ${count === 1 ? "votre overlay" : `chacun de vos ${count} overlays`}.`}
      </p>
      <p className="mt-1 text-sm text-muted">
        {single ? "L'ancien lien cessera" : "Les anciens liens cesseront"} de fonctionner immédiatement. Tant que le
        nouveau lien n'est pas collé dans la source « Navigateur » d'OBS, l'overlay ne s'y affiche plus.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Annuler</Button>
        <Button variant="danger" onClick={onConfirm}>
          <RefreshCw size={14} /> Régénérer
        </Button>
      </div>
    </Modal>
  );
}
