/**
 * Worker do motor Cortex.
 *
 * Executa a dinâmica e o readout FORA do processo principal, de modo que o
 * runtime possa interromper computação de verdade (`worker.terminate()`), e não
 * apenas abandonar uma Promise (plano, seção 15.3).
 *
 * Compilado para JavaScript por `scripts/cortex/build-worker.mjs`: o Node do
 * Electron NÃO executa TypeScript da mesma forma que o runner de testes do
 * repositório.
 */
import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import { loadGeometry, loadMatrix, loadNodes, readManifest, } from "./connectome-package.mjs";
import { buildProjection, ReservoirError, runSteps, } from "./sparse-reservoir.mjs";
import { extractFeatures, scoreWithReadout } from "./readout.mjs";
let state = null;
let readoutWeights = null;
let readoutBias = 0;
async function init() {
    const config = workerData;
    const manifest = await readManifest(config.packageDir);
    const size = manifest.stats.neurons;
    const matrix = await loadMatrix(config.packageDir, size);
    const nodes = await loadNodes(config.packageDir);
    const geometry = await loadGeometry(config.packageDir);
    const seed = Number(manifest.tooling.projectionSeed ?? 20260911);
    const projection = buildProjection(size, config.dimension, seed);
    const readoutRaw = JSON.parse(await import("node:fs/promises").then((fs) => fs.readFile(path.join(config.readoutPath), "utf8")));
    readoutWeights = Float32Array.from(readoutRaw.weights);
    readoutBias = readoutRaw.bias;
    state = {
        matrix,
        projection,
        nodes,
        geometry,
        dimension: config.dimension,
        sampleSize: config.sampleSize,
    };
}
function classify(error) {
    if (error instanceof ReservoirError) {
        return error.kind === "dimension" ? "dimension-mismatch" : "nan-or-infinity";
    }
    return "engine-error";
}
function rank(request) {
    const started = Date.now();
    if (!state) {
        return { requestId: request.requestId, ok: false, error: "package-missing" };
    }
    const { matrix, projection, dimension } = state;
    const count = request.candidateIds.length;
    if (request.candidateVectors.length !== count * dimension) {
        return { requestId: request.requestId, ok: false, error: "dimension-mismatch" };
    }
    try {
        // Estado de referência único: TODOS os candidatos partem dele, em cópia
        // isolada. O estado persistente da tarefa nunca é atualizado aqui.
        const reference = request.withTaskState ? request.taskVector : undefined;
        const samples = [];
        const scores = new Float32Array(count);
        const readout = buildReadout();
        for (let row = 0; row < count; row++) {
            const vector = request.candidateVectors.subarray(row * dimension, (row + 1) * dimension);
            const { state: candidateState, samples: rowSamples } = runSteps(matrix, projection, { alpha: 0.5, steps: 6, seed: 20260911, rowGain: 0.9, inputDimension: dimension }, vector, reference, request.sampleActivity && row < 4, state.sampleSize);
            if (request.sampleActivity && row < 4)
                samples.push(...rowSamples);
            const candidateBase = request.baselineScores[row] ?? 0;
            const features = extractFeatures({
                baselineScore: candidateBase,
                semanticDot: candidateBase,
                recencyDays: 0,
                explicit: false,
                confidenceScore: 0.5,
                occurrences: 1,
                queryState: request.queryVector,
                candidateState,
                readoutEnergy: energy(candidateState),
            });
            scores[row] = scoreWithReadout(request.candidateIds[row], features, readout).score;
        }
        return {
            requestId: request.requestId,
            ok: true,
            scores,
            activitySamples: samples,
            timings: { totalMs: Date.now() - started },
        };
    }
    catch (error) {
        return { requestId: request.requestId, ok: false, error: classify(error) };
    }
}
function energy(vector) {
    let sum = 0;
    for (let i = 0; i < vector.length; i++)
        sum += vector[i] * vector[i];
    return Math.sqrt(sum / Math.max(1, vector.length));
}
function buildReadout() {
    return {
        version: "worker",
        dimension: readoutWeights?.length ?? 0,
        featureNames: [],
        weights: readoutWeights ?? new Float32Array(0),
        bias: readoutBias,
        normalization: {
            mean: new Float32Array(readoutWeights?.length ?? 0),
            std: new Float32Array(readoutWeights?.length ?? 0).fill(1),
        },
        training: {
            algorithm: "loaded",
            learningRate: 0,
            epochs: 0,
            seed: 0,
            l2: 0,
            trainSize: 0,
            validationSize: 0,
            testSize: 0,
            validationMetric: { name: "n/a", value: 0 },
        },
    };
}
/** Prontidão explícita: o runtime só envia trabalho após `ready`. */
async function main() {
    if (!parentPort)
        return;
    try {
        await init();
        parentPort.postMessage({ kind: "ready" });
    }
    catch (error) {
        parentPort.postMessage({
            kind: "error",
            error: classify(error),
            detail: error.message,
        });
        return;
    }
    parentPort.on("message", (message) => {
        if (message.kind !== "rank")
            return;
        parentPort?.postMessage(rank(message));
    });
}
void main();
