import type { AnimationConfig, OverlayComponentConfig, OverlayConfig, OverlayTheme, PresetId } from "@/types/overlay";
import { COMPONENT_TYPES } from "@/utils/overlay-model";
import { getPreset, listPresetIds } from "@/presets";

/**
 * Import d'un overlay exporté depuis « Exporter (.json) » (fonctions pures,
 * testées dans tests/overlay-import.test.ts).
 *
 * Un fichier importé est une donnée NON fiable : on vérifie sa forme avant de
 * l'ajouter à la liste, et on ne recopie que les champs connus. Surtout, on
 * ne garde JAMAIS l'`id` du fichier : l'id est aussi le lien OBS (voir
 * src/utils/obs-link.ts), donc réutiliser celui d'un export ferait partager
 * son lien à deux overlays.
 */

export type ImportResult = { ok: true; overlay: OverlayConfig } | { ok: false; reason: string };

/** Un overlay exporté pèse quelques Ko : au-delà, ce n'est pas un export Batlay. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

const MIN_CANVAS = 20;
const MAX_CANVAS = 7680;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCanvasSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_CANVAS && value <= MAX_CANVAS;
}

/**
 * « Nom », puis « Nom (2) », « Nom (3) »... : une importation ne doit pas créer
 * deux overlays indiscernables dans la liste.
 */
export function uniqueOverlayName(base: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const clean = base.trim() || "Overlay importé";
  if (!taken.has(clean.toLowerCase())) return clean;
  for (let i = 2; ; i++) {
    const candidate = `${clean} (${i})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function validateComponent(raw: unknown, index: number): string | null {
  const label = `Composant n°${index + 1}`;
  if (!isRecord(raw)) return `${label} : format invalide.`;
  if (typeof raw.id !== "string" || raw.id === "") return `${label} : identifiant manquant.`;
  if (typeof raw.type !== "string" || !(COMPONENT_TYPES as string[]).includes(raw.type)) {
    return `${label} : type « ${String(raw.type)} » inconnu.`;
  }
  if (!isRecord(raw.transform)) return `${label} : position et taille manquantes.`;
  const { x, y, width, height } = raw.transform;
  for (const n of [x, y, width, height]) {
    if (typeof n !== "number" || !Number.isFinite(n)) return `${label} : position ou taille invalide.`;
  }
  if (!isRecord(raw.style)) return `${label} : style manquant.`;
  return null;
}

/**
 * Lit le texte d'un fichier .json et le convertit en overlay prêt à être
 * ajouté (nouvel id, dates d'aujourd'hui, nom unique).
 *
 * @param makeId  générateur d'id (nanoid en production, déterministe en test)
 * @param now     horodatage posé sur `createdAt` / `updatedAt`
 */
export function parseOverlayImport(
  text: string,
  existingNames: readonly string[],
  makeId: () => string,
  now: number = Date.now()
): ImportResult {
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, reason: "Ce fichier est trop volumineux pour être un overlay Batlay." };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "Ce fichier n'est pas un JSON valide." };
  }

  if (!isRecord(data)) return { ok: false, reason: "Ce fichier ne contient pas d'overlay Batlay." };
  if (data.schemaVersion !== undefined && data.schemaVersion !== 1) {
    return { ok: false, reason: "Cet overlay vient d'une version de Batlay incompatible." };
  }
  if (!Array.isArray(data.components)) return { ok: false, reason: "Ce fichier ne contient pas de liste de composants." };
  if (!isRecord(data.theme) || !isCanvasSize(data.theme.canvasWidth) || !isCanvasSize(data.theme.canvasHeight)) {
    return { ok: false, reason: `La taille du canvas est absente ou hors limites (${MIN_CANVAS} à ${MAX_CANVAS} px).` };
  }

  for (let i = 0; i < data.components.length; i++) {
    const problem = validateComponent(data.components[i], i);
    if (problem) return { ok: false, reason: problem };
  }

  const blank = getPreset("blank");
  const presetId: PresetId = listPresetIds().includes(data.presetId as PresetId) ? (data.presetId as PresetId) : "blank";
  const name = typeof data.name === "string" ? data.name : "";

  const overlay: OverlayConfig = {
    schemaVersion: 1,
    id: makeId(),
    name: uniqueOverlayName(name, existingNames),
    presetId,
    components: data.components as OverlayComponentConfig[],
    // Les champs de thème absents (padding, gap...) reprennent ceux d'un overlay vide.
    theme: { ...blank.theme, ...(data.theme as unknown as OverlayTheme) },
    animations: isRecord(data.animations) ? { ...blank.animations, ...(data.animations as Partial<AnimationConfig>) } : blank.animations,
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, overlay };
}
