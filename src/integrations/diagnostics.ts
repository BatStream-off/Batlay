import type { IntegrationPlatform } from "./platforms";

/**
 * Vérifications affichées sur la page Intégrations (fonction pure, testée dans
 * tests/integrations.test.ts). Elles ne s'appuient que sur des faits que Batlay
 * mesure lui-même : serveurs démarrés, sources réellement connectées en
 * WebSocket. Une source « connectée » prouve à la fois que le logiciel a pu
 * joindre 127.0.0.1, exécuter la page, et ouvrir le canal des mises à jour en direct.
 */

export type CheckStatus = "ok" | "warn" | "error" | "info";

export interface DiagnosticCheck {
  id: string;
  status: CheckStatus;
  label: string;
  hint?: string;
}

export interface DiagnosticInput {
  platform: Pick<IntegrationPlatform, "id" | "name" | "sourceName">;
  musicServerRunning: boolean;
  musicPort: number | null;
  overlayCount: number;
  /** Total des sources connectées aux overlays musicaux ; `null` = inconnu (mesure indisponible). */
  musicClients: number | null;
  chatServerRunning: boolean;
  chatPort: number;
  chatClients: number;
}

/** « 1 source musicale connectée » / « 2 sources musicales connectées ». */
const plural3 = (n: number, ...words: string[]) => `${n} ${words.map((w) => `${w}${n > 1 ? "s" : ""}`).join(" ")}`;

export function buildDiagnostics(input: DiagnosticInput): DiagnosticCheck[] {
  const checks: DiagnosticCheck[] = [];
  const where = `une source « ${input.platform.sourceName} » de ${input.platform.name}`;

  checks.push(
    input.musicServerRunning
      ? { id: "music-server", status: "ok", label: `Serveur d'overlay musical en ligne${input.musicPort ? ` (port ${input.musicPort})` : ""}` }
      : {
          id: "music-server",
          status: "error",
          label: "Serveur d'overlay musical arrêté",
          hint: "Le port est probablement pris par une autre application : changez-le dans Paramètres → Serveur d'overlay, puis recopiez les URL.",
        }
  );

  if (input.overlayCount === 0) {
    checks.push({
      id: "music-overlays",
      status: "warn",
      label: "Aucun overlay musical",
      hint: "Créez-en un dans Overlays : son URL apparaîtra ici.",
    });
  }

  if (input.musicServerRunning && input.overlayCount > 0) {
    if (input.musicClients === null) {
      checks.push({ id: "music-clients", status: "info", label: "Sources musicales connectées : mesure indisponible" });
    } else if (input.musicClients > 0) {
      checks.push({
        id: "music-clients",
        status: "ok",
        label: plural3(input.musicClients, "source", "musicale", "connectée"),
        hint: "La page est chargée et reçoit les mises à jour en direct.",
      });
    } else {
      checks.push({
        id: "music-clients",
        status: "info",
        label: "Aucune source musicale connectée",
        hint: `Collez l'URL dans ${where} : ce compteur passe à 1 dès que la page est chargée et sa connexion temps réel ouverte.`,
      });
    }
  }

  checks.push(
    input.chatServerRunning
      ? { id: "chat-server", status: "ok", label: `Serveur du chat en ligne (port ${input.chatPort})` }
      : {
          id: "chat-server",
          status: "error",
          label: "Serveur du chat arrêté",
          hint: `Le port ${input.chatPort} est probablement pris par une autre application : fermez-la puis relancez Batlay.`,
        }
  );

  if (input.chatServerRunning) {
    checks.push(
      input.chatClients > 0
        ? {
            id: "chat-clients",
            status: "ok",
            label: `${plural3(input.chatClients, "source")} de chat ${input.chatClients > 1 ? "connectées" : "connectée"}`,
          }
        : { id: "chat-clients", status: "info", label: "Aucune source de chat connectée", hint: "Normal si vous n'utilisez pas l'overlay Chat." }
    );
  }

  if (input.platform.id === "tiktok-live-studio") {
    checks.push({
      id: "tiktok-fallback",
      status: "info",
      label: "Si le compteur reste à 0 après l'ajout de la source Link",
      hint: "1) Copiez la variante 127.0.0.1 ; 2) activez « Ajuster à la source » ; 3) passez par la caméra virtuelle d'OBS (méthode de secours ci-dessus).",
    });
  }

  return checks;
}
