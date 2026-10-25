import { forwardRef, type CSSProperties } from "react";
import { renderAlertText, type AlertEvent, type AlertStyle } from "../../electron/shared/alerts";

/**
 * Rendu d'une alerte, partagé par la page OBS (alerts/) et l'aperçu du tableau
 * de bord. Styles INLINE uniquement (la page OBS n'embarque pas Tailwind).
 * Tous les textes sont rendus comme du texte React : un pseudo ou un message
 * de spectateur ne peut jamais injecter de balise.
 */

const FONT = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';

export interface AlertCardProps {
  event: AlertEvent;
  style: AlertStyle;
  /** Adresse d'une image importée (URL du serveur dans OBS, data URL dans l'aperçu). */
  imageUrl: string | null;
}

export const AlertCard = forwardRef<HTMLDivElement, AlertCardProps>(function AlertCard({ event, style, imageUrl }, ref) {
  const side = style.layout === "side";
  const title = renderAlertText(style.title, event);
  const subtitle = renderAlertText(style.subtitle, event);
  const box: CSSProperties = {
    display: "flex",
    flexDirection: side ? "row" : "column",
    alignItems: "center",
    gap: side ? "0.6em" : "0.35em",
    maxWidth: "90vw",
    padding: style.card ? "0.55em 0.9em" : 0,
    borderRadius: "0.5em",
    background: style.card ? "rgba(10, 10, 15, 0.72)" : undefined,
    boxShadow: style.card ? `0 0.4em 1.4em rgba(0, 0, 0, 0.45), 0 0 0 0.06em ${style.accentColor}66` : undefined,
    color: style.textColor,
    fontFamily: FONT,
    fontSize: style.fontSize,
    lineHeight: 1.15,
    textAlign: side ? "left" : "center",
    textShadow: "0 0.05em 0.2em rgba(0, 0, 0, 0.85)",
    willChange: "transform, opacity",
  };
  return (
    <div ref={ref} style={box} role="status" aria-live="polite">
      {imageUrl && (
        <img
          src={imageUrl}
          alt=""
          style={{ display: "block", maxHeight: side ? "3.2em" : "5em", maxWidth: side ? "5em" : "12em", objectFit: "contain", borderRadius: "0.25em" }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        {title && <div style={{ fontWeight: 800, color: style.accentColor, overflowWrap: "anywhere" }}>{title}</div>}
        {subtitle && <div style={{ fontWeight: 600, fontSize: "0.62em", marginTop: "0.15em", overflowWrap: "anywhere" }}>{subtitle}</div>}
        {event.kind === "resub" && event.message && (
          <div style={{ fontWeight: 500, fontStyle: "italic", fontSize: "0.48em", marginTop: "0.35em", opacity: 0.9, overflowWrap: "anywhere" }}>
            « {event.message} »
          </div>
        )}
      </div>
    </div>
  );
});
