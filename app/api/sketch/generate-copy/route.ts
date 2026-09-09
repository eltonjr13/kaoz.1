import { NextResponse } from 'next/server';
import { queryConfiguredAgentCli } from '@/services/agent-llm/agent-llm.service';
import type { GenerateCopyRequest, GenerateCopyResponse } from '@/types/sketch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function extractJsonPayload(text: string): Record<string, unknown> | null {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // Falha silenciosa para tentar fallback
  }
  return null;
}

function resolveFallbackSubheadline(keyBenefits?: string[]): string {
  if (keyBenefits && keyBenefits.length > 0) {
    return keyBenefits.slice(0, 2).join(' • ');
  }
  return 'Qualidade e inovação desenvolvidas exclusivamente para elevar os seus resultados.';
}

function buildFallbackCopy(req: GenerateCopyRequest): GenerateCopyResponse {
  const cleanProduct = req.productDescription.slice(0, 40) || 'Produto';
  const hasOffer = Boolean(req.offer && req.offer.trim());
  const offerText = hasOffer ? req.offer!.trim().slice(0, 24) : 'Destaque';
  const ctaText = hasOffer ? 'Garantir Oferta' : 'Conheça Mais';
  const subheadline = resolveFallbackSubheadline(req.keyBenefits);

  return {
    headline: `Descubra a Excelência de ${cleanProduct}`,
    subheadline,
    cta: ctaText,
    badge: offerText,
    suggestedVisualPrompt: `Clean modern commercial photograph of ${cleanProduct}, premium studio lighting, elegant composition, minimal background, high aesthetic finish.`
  };
}

function getField(obj: Record<string, unknown> | null, key: string, fallback: string): string {
  if (!obj) return fallback;
  const val = obj[key];
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function parseGeneratedCopy(rawOutput: string, req: GenerateCopyRequest): GenerateCopyResponse {
  const parsed = extractJsonPayload(rawOutput);
  if (!parsed) return buildFallbackCopy(req);

  const fallback = buildFallbackCopy(req);
  return {
    headline: getField(parsed, 'headline', fallback.headline),
    subheadline: getField(parsed, 'subheadline', fallback.subheadline),
    cta: getField(parsed, 'cta', fallback.cta),
    badge: getField(parsed, 'badge', fallback.badge),
    suggestedVisualPrompt: getField(
      parsed,
      'suggestedVisualPrompt',
      fallback.suggestedVisualPrompt
    )
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

function formatPromptBriefingLines(req: GenerateCopyRequest): string[] {
  const lines: string[] = [];
  pushContextLines(lines, req);
  pushCreativeAttributes(lines, req);
  return lines;
}

function buildPrompt(req: GenerateCopyRequest): string {
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

async function requestAgentCopy(prompt: string): Promise<string> {
  try {
    const cliResult = await queryConfiguredAgentCli(prompt, {
      jsonMode: true,
      maxOutputTokens: 1000
    });
    return cliResult || '';
  } catch (agentErr) {
    console.warn('[API SKETCH] Agente LLM CLI falhou, gerando resposta fallback:', agentErr);
    return '';
  }
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

function extractCopyRequest(body: unknown): GenerateCopyRequest | null {
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const copyReq = extractCopyRequest(body);

    if (!copyReq) {
      return NextResponse.json(
        { error: 'A descrição do produto ou anúncio é obrigatória.' },
        { status: 400 }
      );
    }

    const prompt = buildPrompt(copyReq);
    const rawResult = await requestAgentCopy(prompt);
    const response = parseGeneratedCopy(rawResult, copyReq);
    return NextResponse.json({ success: true, data: response, ...response });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API SKETCH] Erro ao gerar copy:', err);
    return NextResponse.json({ error: `Erro ao gerar copy: ${message}` }, { status: 500 });
  }
}
