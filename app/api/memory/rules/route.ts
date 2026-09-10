import { JsonStorageProvider } from '../../../../lib/cognitive-memory/storage/JsonStorageProvider.ts';
import type { ProceduralRule } from '../../../../lib/cognitive-memory/types/memory.ts';
import { apiSuccess, apiError, ApiErrorCode } from '../../../../lib/cortex/api-response.ts';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const storage = new JsonStorageProvider();
    const data = await storage.readMemory();
    const rules = data.procedural?.rules || [];
    return apiSuccess({ rules }, 200, { rules });
  } catch (err: any) {
    console.error('[Rules API GET] Erro ao listar regras:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno ao listar regras.', 500);
  }
}

function extractTriggerPattern(body: any): string {
  if (body?.triggerPattern) return body.triggerPattern;
  if (body?.condition) return body.condition;
  return 'general';
}

function extractInstruction(body: any): string {
  if (body?.instruction) return body.instruction;
  if (body?.action) return body.action;
  return '';
}

function parseRuleNumericFields(body: any) {
  const confidenceScore = Number.isFinite(body?.confidenceScore) ? Number(body.confidenceScore) : 0.8;
  const successCount = Number.isFinite(body?.successCount) ? Number(body.successCount) : 0;
  const failureCount = Number.isFinite(body?.failureCount) ? Number(body.failureCount) : 0;
  return { confidenceScore, successCount, failureCount };
}

function parseRuleIdentityFields(body: any) {
  const id = body?.id ? String(body.id) : `rule:manual-${crypto.randomUUID().slice(0, 8)}`;
  const avatarId = body?.avatarId ? String(body.avatarId) : 'kaoz1-system';
  const scope = body?.scope ? body.scope : 'general';
  const actionType = body?.actionType ? body.actionType : 'modify_prompt';
  return { id, avatarId, scope, actionType };
}

function buildRulePayload(body: any): ProceduralRule & { condition?: string; action?: string } {
  const now = new Date().toISOString();
  const triggerPattern = extractTriggerPattern(body);
  const instruction = extractInstruction(body);
  const numeric = parseRuleNumericFields(body);
  const identity = parseRuleIdentityFields(body);

  return {
    id: identity.id,
    avatarId: identity.avatarId,
    projectId: body?.projectId,
    timestamp: now,
    scope: identity.scope,
    triggerPattern,
    actionType: identity.actionType,
    instruction,
    condition: triggerPattern,
    action: instruction,
    confidenceScore: numeric.confidenceScore,
    successCount: numeric.successCount,
    failureCount: numeric.failureCount,
    lastUpdated: now
  };
}

function upsertProceduralRuleInMemory(rules: ProceduralRule[], rule: ProceduralRule): ProceduralRule {
  const existingIdx = rules.findIndex((r) => r.id === rule.id);
  if (existingIdx >= 0) {
    rules[existingIdx] = { ...rules[existingIdx], ...rule };
    return rules[existingIdx];
  }
  rules.push(rule);
  return rule;
}

async function handleRuleFeedback(body: any, storage: JsonStorageProvider) {
  const updated = await storage.updateMemory((data) => {
    const rules = data.procedural?.rules || [];
    const rule = rules.find((r) => r.id === body.ruleId);
    if (!rule) return null;
    if (body.feedback === 'reinforce') {
      rule.successCount = (rule.successCount || 0) + 1;
      rule.confidenceScore = Math.min(1.0, (rule.confidenceScore || 0.8) + 0.05);
    } else {
      rule.failureCount = (rule.failureCount || 0) + 1;
      rule.confidenceScore = Math.max(0.1, (rule.confidenceScore || 0.8) - 0.1);
    }
    rule.lastUpdated = new Date().toISOString();
    return rule;
  });

  if (!updated) {
    return apiError(ApiErrorCode.NOT_FOUND, 'Regra não encontrada.', 404);
  }
  return apiSuccess({ rule: updated, feedback: body.feedback }, 200, { ok: true, rule: updated });
}

async function handleRuleCreate(body: any, storage: JsonStorageProvider) {
  const instruction = body.instruction || body.action;
  if (!instruction) {
    return apiError(ApiErrorCode.INVALID_PARAMETERS, 'O campo "instruction" ou "action" é obrigatório.', 400);
  }

  const rule = buildRulePayload(body);
  const saved = await storage.updateMemory((data) => upsertProceduralRuleInMemory(data.procedural.rules, rule));
  return apiSuccess({ rule: saved }, 201, { ok: true, rule: saved });
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return apiError(ApiErrorCode.INVALID_REQUEST, 'Corpo da requisição inválido.', 400);
    }

    const storage = new JsonStorageProvider();

    if (body.ruleId && (body.feedback === 'reinforce' || body.feedback === 'penalize')) {
      return await handleRuleFeedback(body, storage);
    }

    return await handleRuleCreate(body, storage);
  } catch (err: any) {
    console.error('[Rules API POST] Erro ao salvar regra:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err?.message ?? 'Erro interno ao salvar regra.', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return apiError(ApiErrorCode.INVALID_PARAMETERS, 'O parâmetro "id" é obrigatório.', 400);
    }

    const storage = new JsonStorageProvider();
    const deleted = await storage.updateMemory((data) => {
      const exists = data.procedural.rules.some((r) => r.id === id);
      if (!exists) return false;
      data.procedural.rules = data.procedural.rules.filter((r) => r.id !== id);
      return true;
    });

    if (!deleted) {
      return apiError(ApiErrorCode.NOT_FOUND, 'Regra não encontrada.', 404);
    }

    return apiSuccess({ deleted: true, id }, 200, { ok: true, deleted: true });
  } catch (err: any) {
    console.error('[Rules API DELETE] Erro ao remover regra:', err);
    return apiError(ApiErrorCode.INTERNAL_ERROR, err.message || 'Erro interno ao remover regra.', 500);
  }
}
