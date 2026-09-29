/**
 * Mises à jour de Batlay depuis les « Releases » GitHub (module pur, sans
 * dépendance : partagé par le process principal et l'interface).
 *
 * `UPDATE_REPO` est le dépôt GitHub où vous
 * publiez les versions. La même valeur doit figurer dans `package.json`
 * (build.publish) : tests/updater.test.ts vérifie qu'elles concordent.
 */

export const UPDATE_REPO_PLACEHOLDER = "VOTRE-PSEUDO-GITHUB";

export const UPDATE_REPO = {
  owner: "BatStream-off",
  repo: "Batlay",
};

export type UpdateRepo = { owner: string; repo: string };

/** Faux tant que le pseudo GitHub n'a pas été remplacé : la recherche est alors désactivée. */
export function isUpdateRepoConfigured(target: UpdateRepo = UPDATE_REPO): boolean {
  return target.owner.trim() !== "" && target.owner !== UPDATE_REPO_PLACEHOLDER && target.repo.trim() !== "";
}

export function releasesUrl(target: UpdateRepo = UPDATE_REPO): string {
  return `https://github.com/${target.owner}/${target.repo}/releases`;
}

/** État de la mise à jour, poussé du process principal vers l'interface. */
export type UpdateStatus =
  | { state: "unavailable"; reason: "dev" | "not-configured" }
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date" }
  | { state: "available"; version: string }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

/** Message lisible pour une erreur réseau / GitHub (jamais la pile technique brute). */
export function describeUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? "");
  if (/ENOTFOUND|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|net::ERR|getaddrinfo/i.test(raw)) {
    return "Impossible de joindre GitHub. Vérifiez votre connexion Internet.";
  }
  if (/404|latest\.yml|Cannot find|No published versions/i.test(raw)) {
    return "Aucune version publiée trouvée sur GitHub pour ce dépôt.";
  }
  if (/403|rate limit/i.test(raw)) {
    return "GitHub limite temporairement les requêtes. Réessayez dans quelques minutes.";
  }
  const firstLine = raw.split("\n")[0].trim();
  return firstLine ? firstLine.slice(0, 200) : "Erreur inconnue pendant la mise à jour.";
}
