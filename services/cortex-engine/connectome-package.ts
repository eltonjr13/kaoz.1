/**
 * Carregamento e validação do pacote derivado do MaleCNS.
 *
 * O pacote anatômico é separado dos pesos aprendidos, mesmo quando distribuídos
 * juntos: trocar um exige verificação de compatibilidade com o outro
 * (plano, seção 5.4).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { hashBuffer, type SparseMatrix } from "./sparse-reservoir.ts";
import type {
  ConnectomeGeometry,
  ConnectomeNode,
  ConnectomePackageManifest,
  FallbackReason,
  ReadoutArtifact,
} from "./cortex-engine.types.ts";

export interface LoadedPackage {
  manifest: ConnectomePackageManifest;
  matrix: SparseMatrix;
  projection: SparseMatrix;
  nodes: ConnectomeNode[];
  geometry: ConnectomeGeometry;
  readout: ReadoutArtifact;
}

/** Erro de pacote com o motivo de fallback já classificado para o trace. */
export class PackageError extends Error {
  public readonly reason: FallbackReason;

  constructor(reason: FallbackReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "PackageError";
  }
}

async function readBinary(file: string): Promise<ArrayBuffer> {
  const buffer = await fs.readFile(file);
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );
}

export async function readManifest(dir: string): Promise<ConnectomePackageManifest> {
  try {
    const text = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
    const manifest = JSON.parse(text) as ConnectomePackageManifest;
    if (!manifest.datasetId || !manifest.csr || !manifest.stats) {
      throw new PackageError("package-invalid", "manifesto sem campos obrigatórios");
    }
    return manifest;
  } catch (error) {
    if (error instanceof PackageError) throw error;
    throw new PackageError(
      "package-missing",
      `pacote indisponível em ${dir}: ${(error as Error).message}`
    );
  }
}

/**
 * Confere o SHA-256 de cada insumo binário antes de carregar.
 *
 * O manifesto é a fonte dos hashes dos INSUMOS baixados; o próprio CSR é
 * verificado por `integrity.json`, gerado junto com os binários.
 */
export async function verifyIntegrity(dir: string): Promise<void> {
  const integrityPath = path.join(dir, "integrity.json");
  let expected: Record<string, string>;
  try {
    expected = JSON.parse(await fs.readFile(integrityPath, "utf8")) as Record<
      string,
      string
    >;
  } catch {
    throw new PackageError(
      "package-invalid",
      "integrity.json ausente: pacote não pode ser verificado"
    );
  }
  for (const [file, digest] of Object.entries(expected)) {
    const actual = await hashBuffer(await readBinary(path.join(dir, file)));
    if (actual !== digest) {
      throw new PackageError(
        "checksum-mismatch",
        `checksum divergente em ${file}: esperado ${digest}, obtido ${actual}`
      );
    }
  }
}

function int32View(buffer: ArrayBuffer): Int32Array {
  return new Int32Array(buffer);
}

function float32View(buffer: ArrayBuffer): Float32Array {
  return new Float32Array(buffer);
}

export async function loadMatrix(
  dir: string,
  size: number
): Promise<SparseMatrix> {
  const [indptrBuffer, indicesBuffer, weightsBuffer] = await Promise.all([
    readBinary(path.join(dir, "row-pointers.bin")),
    readBinary(path.join(dir, "column-indices.bin")),
    readBinary(path.join(dir, "weights.bin")),
  ]);
  const indptr = int32View(indptrBuffer);
  const indices = int32View(indicesBuffer);
  const weights = float32View(weightsBuffer);
  if (indptr.length !== size + 1) {
    throw new PackageError(
      "dimension-mismatch",
      `row-pointers tem ${indptr.length} entradas; esperado ${size + 1}`
    );
  }
  if (indices.length !== weights.length) {
    throw new PackageError(
      "dimension-mismatch",
      `column-indices (${indices.length}) e weights (${weights.length}) divergem`
    );
  }
  return { indptr, indices, weights, size };
}

export async function loadNodes(dir: string): Promise<ConnectomeNode[]> {
  const text = await fs.readFile(path.join(dir, "nodes.json"), "utf8");
  const nodes = JSON.parse(text) as Array<Omit<ConnectomeNode, "index">>;
  return nodes.map((node, index) => ({ ...node, index }));
}

export async function loadGeometry(dir: string): Promise<ConnectomeGeometry> {
  const metaPath = path.join(dir, "geometry", "levels.json");
  const meta = JSON.parse(await fs.readFile(metaPath, "utf8")) as {
    nodeCount: number;
    transform: string;
    units: string;
    levels: Record<string, number[]>;
  };
  const positions = new Float32Array(
    await readBinary(path.join(dir, "geometry", "positions.bin"))
  );
  return {
    positions,
    nodeCount: meta.nodeCount,
    transform: meta.transform,
    units: meta.units,
    levels: Object.values(meta.levels),
  };
}

export async function loadReadout(file: string): Promise<ReadoutArtifact> {
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as {
    version: string;
    dimension: number;
    featureNames: string[];
    weights: number[];
    bias: number;
    normalization: { mean: number[]; std: number[] };
    training: ReadoutArtifact["training"];
  };
  const dimension = raw.dimension;
  if (raw.featureNames.length !== dimension) {
    throw new PackageError(
      "dimension-mismatch",
      `featureNames (${raw.featureNames.length}) diverge de dimension (${dimension})`
    );
  }
  return {
    version: raw.version,
    dimension,
    featureNames: raw.featureNames,
    weights: Float32Array.from(raw.weights),
    bias: raw.bias,
    normalization: {
      mean: Float32Array.from(raw.normalization.mean),
      std: Float32Array.from(raw.normalization.std),
    },
    training: raw.training,
  };
}

/**
 * A projeção é reconstruída a partir da seed registrada, não persistida: a mesma
 * seed e a mesma dimensão produzem os mesmos pesos, e o custo de disco é zero.
 */
export function projectionFromManifest(
  manifest: ConnectomePackageManifest,
  build: (size: number, dimension: number, seed: number) => SparseMatrix,
  nodeCount: number,
  inputDimension: number
): SparseMatrix {
  const seed = Number(manifest.tooling.projectionSeed ?? 20260911);
  return build(nodeCount, inputDimension, seed);
}
