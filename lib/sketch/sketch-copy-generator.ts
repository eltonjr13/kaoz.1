import { queryConfiguredAgentCli } from '../../services/agent-llm/agent-llm.service.ts';
import type { GenerateCopyRequest, GenerateCopyResponse } from '../../types/sketch.ts';

export function extractJsonPayload(text: string): Record<string, unknown> | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Retorna null para sinalizar formato inválido
  }
  return null;
}

export function parseGeneratedCopy(rawOutput: string): GenerateCopyResponse | null {
  const parsed = extractJsonPayload(rawOutput);
  if (!parsed) return null;

  const headline = typeof parsed.headline === 'string' ? parsed.headline.trim() : '';
  if (!headline) return null;

  return {
    headline,
    subheadline: typeof parsed.subheadline === 'string' ? parsed.subheadline.trim() : '',
    cta: typeof parsed.cta === 'string' ? parsed.cta.trim() : '',
    badge: typeof parsed.badge === 'string' ? parsed.badge.trim() : '',
    suggestedVisualPrompt:
      typeof parsed.suggestedVisualPrompt === 'string' ? parsed.suggestedVisualPrompt.trim() : '',
  };
}

function pushContextLines(lines: string[], req: GenerateCopyRequest): void {
  lines.push(`- Produto/Serviço: "${req.productDescription}"`);
  if (req.brandName) lines.push(`- Marca: "${req.brandName}"`);
  const audience = req.audience || req.targetAudience || 'público qualificado';
  const goal = req.goal || req.objective || 'conversão e vendas';
  lines.push(`- Público-Alvo: "${audience}"`);
  lines.push(`- Objetivo da Campanha: "${goal}"`);
  lines.push(`- Tom de Voz: "${req.tone || 'moderno, persuasivo e profissional'}"`);
}

function pushCreativeAttributes(lines: string[], req: GenerateCopyRequest): void {
  if (req.offer) lines.push(`- Oferta Oficial: "${req.offer}"`);
  if (req.keyBenefits && req.keyBenefits.length > 0) {
    lines.push(`- Benefícios Reais Informados: "${req.keyBenefits.join(', ')}"`);
  }
  if (req.visualStyle) lines.push(`- Estilo Visual: "${req.visualStyle}"`);
  if (req.colorPalette && req.colorPalette.length > 0) {
    lines.push(`- Paleta de Cores: "${req.colorPalette.join(', ')}"`);
  }
}

export function formatPromptBriefingLines(req: GenerateCopyRequest): string[] {
  const lines: string[] = [];
  pushContextLines(lines, req);
  pushCreativeAttributes(lines, req);
  return lines;
}

export function buildPrompt(req: GenerateCopyRequest): string {
  const lines = formatPromptBriefingLines(req);

  return `Você é um especialista sênior em copywriting publicitário para anúncios estáticos de alta conversão.
Crie a copy ideal e a sugestão de prompt visual para o seguinte anúncio:

${lines.join('\n')}

POLÍTICA RIGOROSA DE INTEGRIDADE E NÃO-INVENÇÃO (OBRIGATÓRIO):
1. NÃO invente fatos, preços não informados, percentuais de desconto falsos, depoimentos inexistentes ou benefícios não citados.
2. Baseie-se ESTRITAMENTE nas informações fornecidas. Se uma oferta ou desconto não foi informada, NÃO crie valores promocionais fictícios (ex: "50% OFF", "R$ 99").
3. Preserve a verdade do produto, valorizando exclusivamente os diferenciais informados.

Retorne ESTRITAMENTE um objeto JSON válido (sem markdown ou texto extra) no formato:
{
  "headline": "Título curto e impactante (máximo 7 palavras)",
  "subheadline": "Subtítulo explicando o benefício principal (1 a 2 linhas)",
  "cta": "Chamada para ação curta e clara (ex: Compre Agora, Conheça Mais, ou baseada na oferta real)",
  "badge": "Tag ou selo promocional curto (ex: Destaque, Edição Limitada, ou a oferta real informada)",
  "suggestedVisualPrompt": "Prompt visual detalhado em inglês para o gerador de imagem (foco em assunto comercial, iluminação, composição e estética limpa)"
}`;
}

function readStringField(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const val = obj[k];
    if (typeof val === 'string' && val.trim()) {
      return val.trim();
    }
  }
  return undefined;
}

function readStringArrayField(obj: Record<string, unknown>, keys: string[]): string[] | undefined {
  for (const k of keys) {
    const val = obj[k];
    if (Array.isArray(val)) {
      const filtered = val.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
      if (filtered.length > 0) return filtered;
    }
    if (typeof val === 'string' && val.trim()) {
      const split = val.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
      if (split.length > 0) return split;
    }
  }
  return undefined;
}

export function extractCopyRequest(body: unknown): GenerateCopyRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const productDescription = readStringField(b, ['productDescription', 'product', 'description']);
  if (!productDescription) return null;

  return {
    productDescription,
    brandName: readStringField(b, ['brandName', 'brand']),
    audience: readStringField(b, ['audience', 'targetAudience']),
    targetAudience: readStringField(b, ['targetAudience', 'audience']),
    goal: readStringField(b, ['goal', 'objective']),
    objective: readStringField(b, ['objective', 'goal']),
    offer: readStringField(b, ['offer']),
    keyBenefits: readStringArrayField(b, ['keyBenefits', 'benefits']),
    tone: readStringField(b, ['tone']),
    visualStyle: readStringField(b, ['visualStyle', 'style']),
    colorPalette: readStringArrayField(b, ['colorPalette', 'colors']),
  };
}

export interface GenerateAdCopyResult {
  success: boolean;
  statusCode: number;
  data?: GenerateCopyResponse;
  error?: string;
  headline?: string;
  subheadline?: string;
  cta?: string;
  badge?: string;
  suggestedVisualPrompt?: string;
}

async function defaultQueryLlm(prompt: string): Promise<string> {
  const res = await queryConfiguredAgentCli(prompt, {
    jsonMode: true,
    maxOutputTokens: 1000,
  });
  return res || '';
}

export async function generateAdCopy(
  req: GenerateCopyRequest,
  queryFn: (prompt: string) => Promise<string> = defaultQueryLlm
): Promise<GenerateAdCopyResult> {
  const prompt = buildPrompt(req);
  let rawResult = '';

  try {
    rawResult = await queryFn(prompt);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      statusCode: 502,
      error: `Falha na comunicação com o modelo de copy: ${msg}`,
    };
  }

  if (!rawResult || !rawResult.trim()) {
    return {
      success: false,
      statusCode: 502,
      error: 'O modelo de copy retornou uma resposta vazia ou indisponível.',
    };
  }

  const response = parseGeneratedCopy(rawResult);
  if (!response) {
    return {
      success: false,
      statusCode: 502,
      error: 'O modelo de copy retornou uma resposta em formato inválido ou sem título (headline).',
    };
  }

  return {
    success: true,
    statusCode: 200,
    data: response,
    ...response,
  };
}
