/**
 * Carregamento e validação do pacote derivado do MaleCNS.
 *
 * O pacote anatômico é separado dos pesos aprendidos, mesmo quando distribuídos
 * juntos: trocar um exige verificação de compatibilidade com o outro
 * (plano, seção 5.4).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { hashBuffer } from "./sparse-reservoir.mjs";
/** Erro de pacote com o motivo de fallback já classificado para o trace. */
export class PackageError extends Error {
    reason;
    constructor(reason, message) {
        super(message);
        this.reason = reason;
        this.name = "PackageError";
    }
}
/**
 * Constrói o erro de pacote sem parameter properties, que o modo strip-only do
 * Node não aceita.
 */
export function packageError(reason, message) {
    return new PackageError(reason, message);
}
async function readBinary(file) {
    const buffer = await fs.readFile(file);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
export async function readManifest(dir) {
    try {
        const text = await fs.readFile(path.join(dir, "manifest.json"), "utf8");
        const manifest = JSON.parse(text);
        if (!manifest.datasetId || !manifest.csr || !manifest.stats) {
            throw new PackageError("package-invalid", "manifesto sem campos obrigatórios");
        }
        return manifest;
    }
    catch (error) {
        if (error instanceof PackageError)
            throw error;
        throw new PackageError("package-missing", `pacote indisponível em ${dir}: ${error.message}`);
    }
}
/**
 * Confere o SHA-256 de cada insumo binário antes de carregar.
 *
 * O manifesto é a fonte dos hashes dos INSUMOS baixados; o próprio CSR é
 * verificado por `integrity.json`, gerado junto com os binários.
 */
export async function verifyIntegrity(dir) {
    const integrityPath = path.join(dir, "integrity.json");
    let expected;
    try {
        expected = JSON.parse(await fs.readFile(integrityPath, "utf8"));
    }
    catch {
        throw new PackageError("package-invalid", "integrity.json ausente: pacote não pode ser verificado");
    }
    for (const [file, digest] of Object.entries(expected)) {
        const actual = await hashBuffer(await readBinary(path.join(dir, file)));
        if (actual !== digest) {
            throw new PackageError("checksum-mismatch", `checksum divergente em ${file}: esperado ${digest}, obtido ${actual}`);
        }
    }
}
function int32View(buffer) {
    return new Int32Array(buffer);
}
function float32View(buffer) {
    return new Float32Array(buffer);
}
export async function loadMatrix(dir, size) {
    const [indptrBuffer, indicesBuffer, weightsBuffer] = await Promise.all([
        readBinary(path.join(dir, "row-pointers.bin")),
        readBinary(path.join(dir, "column-indices.bin")),
        readBinary(path.join(dir, "weights.bin")),
    ]);
    const indptr = int32View(indptrBuffer);
    const indices = int32View(indicesBuffer);
    const weights = float32View(weightsBuffer);
    if (indptr.length !== size + 1) {
        throw new PackageError("dimension-mismatch", `row-pointers tem ${indptr.length} entradas; esperado ${size + 1}`);
    }
    if (indices.length !== weights.length) {
        throw new PackageError("dimension-mismatch", `column-indices (${indices.length}) e weights (${weights.length}) divergem`);
    }
    return { indptr, indices, weights, size, columns: size };
}
export async function loadNodes(dir) {
    const text = await fs.readFile(path.join(dir, "nodes.json"), "utf8");
    const nodes = JSON.parse(text);
    return nodes.map((node, index) => ({ ...node, index }));
}
export async function loadGeometry(dir) {
    const metaPath = path.join(dir, "geometry", "levels.json");
    const meta = JSON.parse(await fs.readFile(metaPath, "utf8"));
    const positions = new Float32Array(await readBinary(path.join(dir, "geometry", "positions.bin")));
    return {
        positions,
        nodeCount: meta.nodeCount,
        transform: meta.transform,
        units: meta.units,
        levels: Object.values(meta.levels),
    };
}
export async function loadReadout(file) {
    const raw = JSON.parse(await fs.readFile(file, "utf8"));
    const dimension = raw.dimension;
    if (raw.featureNames.length !== dimension) {
        throw new PackageError("dimension-mismatch", `featureNames (${raw.featureNames.length}) diverge de dimension (${dimension})`);
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
export function projectionFromManifest(manifest, build, nodeCount, inputDimension) {
    const seed = Number(manifest.tooling.projectionSeed ?? 20260911);
    return build(nodeCount, inputDimension, seed);
}
