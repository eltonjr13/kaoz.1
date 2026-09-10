import { JsonStorageProvider } from '../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import type { GraphNode, GraphEdge } from '../../../../lib/cognitive-memory/types/graph.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();

    const nodes: GraphNode[] = data.semantic?.nodes || [];
    const edges: GraphEdge[] = data.semantic?.edges || [];

    return apiSuccess({ nodes, edges }, 200, { nodes, edges });
  } catch (err: any) {
    console.error('[Graph API GET] Falha ao ler grafo:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno ao ler grafo.', 500);
  }
}

function validateNodeInput(node: any): string | null {
  const type = node?.type || node?.nodeType;
  if (!node?.id || !node?.label || !type) {
    return 'Campos obrigatórios: id, label, type';
  }
  return null;
}

function validateEdgeInput(edge: Partial<GraphEdge>): string | null {
  if (!edge?.id || !edge?.source || !edge?.target || !edge?.relation) {
    return 'Campos obrigatórios: id, source, target, relation';
  }
  return null;
}

function upsertNodeInMemory(nodes: GraphNode[], nodeData: any): GraphNode {
  const prepared: GraphNode = {
    ...nodeData,
    type: nodeData.type || nodeData.nodeType || 'concept',
    lastObserved: new Date().toISOString(),
    metadata: nodeData.metadata || {}
  };
  const idx = nodes.findIndex((n) => n.id === prepared.id);
  if (idx >= 0) {
    nodes[idx] = { ...nodes[idx], ...prepared };
    return nodes[idx];
  }
  nodes.push(prepared);
  return prepared;
}

function upsertEdgeInMemory(edges: GraphEdge[], edgeData: GraphEdge): GraphEdge {
  const now = new Date().toISOString();
  const idx = edges.findIndex((e) => e.id === edgeData.id);
  if (idx >= 0) {
    const existing = edges[idx];
    const alpha = 0.15;
    const newWeight = Math.min(1.0, existing.weight + alpha * (1.0 - existing.weight));
    const updated: GraphEdge = {
      ...existing,
      ...edgeData,
      weight: newWeight,
      occurrences: (existing.occurrences || 1) + 1,
      lastReinforced: now
    };
    edges[idx] = updated;
    return updated;
  }
  const created: GraphEdge = {
    ...edgeData,
    occurrences: edgeData.occurrences ?? 1,
    weight: edgeData.weight ?? 0.5,
    confidenceScore: edgeData.confidenceScore ?? 0.5,
    lastReinforced: now
  };
  edges.push(created);
  return created;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || !body.type || !body.data) {
      return apiError(ApiErrorCode.INVALID_REQUEST, 'Corpo da requisição inválido. "type" e "data" são obrigatórios.', 400);
    }

    const storage = new JsonStorageProvider();

    if (body.type === 'node') {
      const error = validateNodeInput(body.data);
      if (error) return apiError(ApiErrorCode.INVALID_PARAMETERS, error, 400);
      const node = await storage.updateMemory((data) => upsertNodeInMemory(data.semantic.nodes, body.data));
      return apiSuccess({ node }, 200, { ok: true, node });
    }

    if (body.type === 'edge') {
      const error = validateEdgeInput(body.data);
      if (error) return apiError(ApiErrorCode.INVALID_PARAMETERS, error, 400);
      const edge = await storage.updateMemory((data) => upsertEdgeInMemory(data.semantic.edges, body.data));
      return apiSuccess({ edge }, 200, { ok: true, edge });
    }

    return apiError(ApiErrorCode.INVALID_PARAMETERS, 'type deve ser "node" ou "edge"', 400);
  } catch (err: any) {
    console.error('[Graph API POST] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno ao salvar dados do grafo.', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const entityType = searchParams.get('type') || 'node';

    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Parâmetro "id" é obrigatório.', 400);
    }

    if (entityType !== 'node' && entityType !== 'edge') {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'type deve ser "node" ou "edge"', 400);
    }

    const storage = new JsonStorageProvider();
    const deleted = await storage.updateMemory((data) => {
      if (entityType === 'node') {
        const prev = data.semantic.nodes.length;
        data.semantic.nodes = data.semantic.nodes.filter((n) => n.id !== id);
        data.semantic.edges = data.semantic.edges.filter((e) => e.source !== id && e.target !== id);
        return prev > data.semantic.nodes.length;
      }
      const prev = data.semantic.edges.length;
      data.semantic.edges = data.semantic.edges.filter((e) => e.id !== id);
      return prev > data.semantic.edges.length;
    });

    return apiSuccess({ deleted, id, type: entityType }, 200, { ok: true, deleted });
  } catch (err: any) {
    console.error('[Graph API DELETE] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno ao remover do grafo.', 500);
  }
}

function updateNodeAction(node: GraphNode, action: string, updates: any): GraphNode {
  if (action === 'resolve') {
    return {
      ...node,
      type: 'concept',
      confidenceScore: 0.5,
      lastObserved: new Date().toISOString(),
      metadata: { ...node.metadata, resolvedAt: new Date().toISOString() }
    };
  }
  return {
    ...node,
    ...(updates || {}),
    lastObserved: new Date().toISOString()
  };
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body?.id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'Parâmetro "id" é obrigatório.', 400);
    }

    const storage = new JsonStorageProvider();
    const updated = await storage.updateMemory((data) => {
      const idx = data.semantic.nodes.findIndex((n) => n.id === body.id);
      if (idx < 0) return null;
      data.semantic.nodes[idx] = updateNodeAction(data.semantic.nodes[idx], body.action, body.updates);
      return data.semantic.nodes[idx];
    });

    if (!updated) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Nó não encontrado.', 404);
    }

    return apiSuccess({ node: updated }, 200, { ok: true, node: updated });
  } catch (err: any) {
    console.error('[Graph API PATCH] Erro:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno ao atualizar nó.', 500);
  }
}
