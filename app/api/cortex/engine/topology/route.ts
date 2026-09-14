/**
 * Topologia do recorte: manifesto público seguro, índices e geometria.
 *
 * Não serve o CSR nem os pesos treinados: apenas o que a interface precisa para
 * desenhar anatomia autêntica e distinguir o que está no modelo.
 */

import { apiError, apiSuccess, ApiErrorCode } from '../../../../../lib/cortex/api-response.ts';
import {
  loadGeometry,
  loadNodes,
  PackageError,
  readManifest,
} from '../../../../../services/cortex-engine/connectome-package.ts';
import { defaultPackageDir } from '../../../../../services/cortex-engine/engine-status.ts';
import type { ConnectomeNode } from '../../../../../services/cortex-engine/cortex-engine.types.ts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    const level = parseLevel(request);
    const dir = defaultPackageDir();
    const manifest = await readManifest(dir);
    const [nodes, geometry] = await Promise.all([loadNodes(dir), loadGeometry(dir)]);
    const indices = selectLevel(geometry.levels, level, nodes);
    return apiSuccess({
      manifest: publicManifest(manifest),
      level,
      levelCount: geometry.levels?.length ?? 1,
      transform: geometry.transform,
      units: geometry.units,
      nodes: indices.map((index) => nodes[index]).filter(Boolean),
      positions: slicePositions(geometry.positions, indices),
    });
  } catch (err: any) {
    return topologyError(err);
  }
}

function parseLevel(request: Request): number {
  const raw = new URL(request.url).searchParams.get('level');
  const parsed = Number(raw ?? '0');
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Nível de detalhe reduzido: evita trafegar todos os nós em todo poll. */
function selectLevel(
  levels: number[][] | undefined,
  level: number,
  nodes: ConnectomeNode[]
): number[] {
  if (levels && levels[level]) return levels[level];
  return nodes.map((node) => node.index);
}

function slicePositions(positions: Float32Array, indices: number[]): number[] {
  const out = new Float32Array(indices.length * 3);
  indices.forEach((nodeIndex, slot) => {
    out.set(positions.subarray(nodeIndex * 3, nodeIndex * 3 + 3), slot * 3);
  });
  return Array.from(out);
}

/** Manifesto com apenas o que é público: sem hashes de insumo nem tooling. */
function publicManifest(manifest: Awaited<ReturnType<typeof readManifest>>) {
  return {
    datasetId: manifest.datasetId,
    datasetVersion: manifest.datasetVersion,
    license: manifest.license,
    attribution: manifest.attribution,
    stats: manifest.stats,
    selection: manifest.selection,
    activityScale: manifest.activityScale,
    csr: manifest.csr,
  };
}

/** Pacote ausente é estado esperado; o resto é falha de verdade. */
function ehPacoteAusente(err: any): boolean {
  if (err instanceof PackageError) return true;
  // Reserva para erros que não são de pacote mas descrevem ausência.
  return /indisponível|ausente|não encontrado|pacote/i.test(err?.message || '');
}

/**
 * Traduz a falha da topologia em resposta.
 *
 * "Pacote não preparado" é um estado ESPERADO — a interface pede a topologia em
 * cada poll e trata o 404 como vazio. Registrá-lo em nível de erro com stack
 * trace enche o log de ruído e esconde falha de verdade, então esse caso fica em
 * nível informativo e sem stack. Só o inesperado (500) vira erro.
 */
function topologyError(err: any) {
  if (ehPacoteAusente(err)) {
    console.info(
      '[API Cortex Engine] GET topology: pacote não preparado (404 esperado):',
      err?.reason ?? 'package-missing'
    );
    return apiError(
      ApiErrorCode.NOT_FOUND,
      err?.message || 'Pacote do recorte ainda não preparado.',
      404
    );
  }
  console.error('[API Cortex Engine] GET topology:', err);
  return apiError(
    ApiErrorCode.INTERNAL_ERROR,
    err?.message || 'Erro ao carregar a topologia do recorte.',
    500
  );
}
