/**
 * Resolução do estado do motor: disponibilidade real do pacote e do readout.
 *
 * O estado reportado é sempre verdadeiro: nunca anunciamos capacidade
 * inexistente nem dizemos "MaleCNS processou" quando o fallback respondeu.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import type { CortexEngineSettings } from "./cortex-engine.settings.ts";
import { readManifest } from "./connectome-package.ts";
import type { CortexEngineStatus } from "./cortex-engine.types.ts";

export interface EngineStatusPayload {
  configuredMode: CortexEngineSettings["mode"];
  effectiveMode: CortexEngineSettings["mode"];
  status: CortexEngineStatus;
  packageAvailable: boolean;
  packageVersion: string | null;
  packageDatasetId: string | null;
  readoutAvailable: boolean;
  readoutVersion: string | null;
  readoutVariant: string | null;
  attribution: string;
  license: string;
  /** Deixa explícito que é um recorte, não o CNS inteiro (plano, seção 5.3). */
  scopeNotice: string;
  packageDir: string;
  lastFallback: string | null;
}

/** Pacote distribuído com a aplicação; a preparação explícita o substitui. */
export function defaultPackageDir(): string {
  const override = process.env.KAOZ1_CORTEX_PACKAGE_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(getLocalDataDir(), "cortex-engine", "packages", "male-cns-v1.0");
}

export function defaultReadoutPath(): string {
  const override = process.env.KAOZ1_CORTEX_READOUT?.trim();
  if (override) return path.resolve(override);
  return path.join(defaultPackageDir(), "readout.json");
}

/**
 * Anatomia COMPLETA do CNS — camada de visualização, não de computação.
 *
 * É um artefato separado do pacote de propósito: o motor computa sobre um
 * recorte de 1.536 neurônios, enquanto este conjunto (todos os neurônios com
 * posição real) existe apenas para desenhar a referência anatômica.
 */
export function defaultAnatomyDir(): string {
  const override = process.env.KAOZ1_CORTEX_ANATOMY_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(getLocalDataDir(), "cortex-engine", "anatomy", "male-cns-v1.0");
}

export async function engineStatus(
  settings: CortexEngineSettings
): Promise<EngineStatusPayload> {
  const dir = defaultPackageDir();
  const manifest = await tryReadManifest(dir);
  const readout = await readReadoutInfo(defaultReadoutPath());
  const ready = manifest !== null && readout.available;
  return {
    configuredMode: settings.mode,
    effectiveMode: ready ? settings.mode : "legacy",
    status: resolveStatus(settings.mode, ready),
    attribution: manifest?.attribution ?? "",
    license: manifest?.license ?? "",
    scopeNotice: describeScope(manifest),
    packageDir: dir,
    lastFallback: null,
    ...describeArtifacts(manifest, readout),
  };
}

/** Disponibilidade e versionamento dos dois artefatos do pacote. */
function describeArtifacts(
  manifest: Awaited<ReturnType<typeof readManifest>> | null,
  readout: { available: boolean; version: string | null; variant: string | null }
) {
  return {
    packageAvailable: manifest !== null,
    packageVersion: manifest?.datasetVersion ?? null,
    packageDatasetId: manifest?.datasetId ?? null,
    readoutAvailable: readout.available,
    readoutVersion: readout.version,
    readoutVariant: readout.variant,
  };
}

/** Ausência de pacote não é erro: é um estado honesto do produto. */
async function tryReadManifest(
  dir: string
): Promise<Awaited<ReturnType<typeof readManifest>> | null> {
  try {
    return await readManifest(dir);
  } catch {
    return null;
  }
}

function resolveStatus(
  mode: CortexEngineSettings["mode"],
  ready: boolean
): CortexEngineStatus {
  if (mode === "legacy") return "disabled";
  return ready ? "ready" : "fallback";
}

/**
 * Deixa explícito que é um RECORTE, não o CNS inteiro nem uma simulação de
 * todos os neurônios (plano, seção 5.3).
 */
function describeScope(
  manifest: Awaited<ReturnType<typeof readManifest>> | null
): string {
  if (!manifest) return "Pacote do recorte ainda não preparado.";
  return `Recorte de ${manifest.stats.neurons} neurônios (${manifest.stats.cellTypes} tipos) do cérebro central. Não é o CNS inteiro nem uma simulação de todos os neurônios.`;
}

export async function readReadoutInfo(
  readoutPath: string
): Promise<{ available: boolean; version: string | null; variant: string | null }> {
  try {
    const raw = JSON.parse(await fs.readFile(readoutPath, 'utf8')) as {
      version?: string;
      variant?: string;
    };
    return {
      available: true,
      version: raw.version ?? null,
      variant: raw.variant ?? null,
    };
  } catch {
    return { available: false, version: null, variant: null };
  }
}
