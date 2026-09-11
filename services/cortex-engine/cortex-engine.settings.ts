/**
 * Configuração do motor Cortex. Modos, limites e persistência local.
 *
 * O modo padrão permanece `legacy` durante o desenvolvimento: a promoção a
 * padrão depende dos critérios de qualidade do plano (seção 15.3).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import type { CortexEngineMode } from "./cortex-engine.types.ts";

export interface CortexEngineSettings {
  mode: CortexEngineMode;
  /** Orçamento de candidatos por consulta. `Recall@128` é medido antes do reranking. */
  maxCandidates: number;
  /** Timeout do caminho novo, após candidatos/embeddings disponíveis. */
  deadlineMs: number;
  /** Orçamento do worker em `shadow` para não disputar com a resposta principal. */
  shadowDeadlineMs: number;
  /** TTL do vetor de estado em RAM, em minutos de inatividade. */
  taskStateTtlMinutes: number;
  /** Amostragem de atividade para o trace; limitada para não persistir matrizes. */
  activitySampleSize: number;
  /** Tamanho máximo da fila do worker. */
  maxQueue: number;
  /** Máximo de traces retidos. */
  maxTraces: number;
}

export const DEFAULT_SETTINGS: CortexEngineSettings = {
  mode: "legacy",
  maxCandidates: 128,
  deadlineMs: 250,
  shadowDeadlineMs: 120,
  taskStateTtlMinutes: 30,
  activitySampleSize: 256,
  maxQueue: 64,
  maxTraces: 200,
};

export function getCortexEngineDir(): string {
  return path.join(getLocalDataDir(), "cortex-engine");
}

export function getSettingsPath(): string {
  return path.join(getCortexEngineDir(), "settings.json");
}

export function getPackagesDir(): string {
  return path.join(getCortexEngineDir(), "packages");
}

export function getIndexesDir(): string {
  return path.join(getCortexEngineDir(), "indexes");
}

export function getStateDir(): string {
  return path.join(getCortexEngineDir(), "state");
}

export function getTracesDir(): string {
  return path.join(getCortexEngineDir(), "traces");
}

const MODES: CortexEngineMode[] = ["legacy", "shadow", "malecns"];

/** Valida modos e limites; nenhum caminho de arquivo arbitrário entra por aqui. */
export function sanitizeSettings(input: unknown): Partial<CortexEngineSettings> {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const out: Partial<CortexEngineSettings> = {};
  if (typeof raw.mode === "string" && MODES.includes(raw.mode as CortexEngineMode)) {
    out.mode = raw.mode as CortexEngineMode;
  }
  assignBounded(raw, out, "maxCandidates", 4, 512);
  assignBounded(raw, out, "deadlineMs", 20, 5_000);
  assignBounded(raw, out, "shadowDeadlineMs", 20, 5_000);
  assignBounded(raw, out, "taskStateTtlMinutes", 1, 24 * 60);
  assignBounded(raw, out, "activitySampleSize", 0, 4_096);
  assignBounded(raw, out, "maxQueue", 1, 1_024);
  assignBounded(raw, out, "maxTraces", 10, 10_000);
  return out;
}

function assignBounded(
  raw: Record<string, unknown>,
  out: Partial<CortexEngineSettings>,
  key: NumericSettingKey,
  min: number,
  max: number
): void {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return;
  out[key] = Math.min(max, Math.max(min, Math.round(value)));
}

type NumericSettingKey =
  | "maxCandidates"
  | "deadlineMs"
  | "shadowDeadlineMs"
  | "taskStateTtlMinutes"
  | "activitySampleSize"
  | "maxQueue"
  | "maxTraces";

export async function loadSettings(): Promise<CortexEngineSettings> {
  try {
    const text = await fs.readFile(getSettingsPath(), "utf8");
    return { ...DEFAULT_SETTINGS, ...sanitizeSettings(JSON.parse(text)) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Escrita atômica: temporário único + rename, reutilizando o padrão do projeto. */
export async function saveSettings(
  patch: Partial<CortexEngineSettings>
): Promise<CortexEngineSettings> {
  const current = await loadSettings();
  const next = { ...current, ...sanitizeSettings(patch) };
  const target = getSettingsPath();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(temp, target);
  return next;
}
