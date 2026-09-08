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

function buildFallbackCopy(product: string): GenerateCopyResponse {
  const cleanProduct = product.slice(0, 40) || 'Produto';
  return {
    headline: `Descubra a Nova Era de ${cleanProduct}`,
    subheadline: 'Qualidade premium e resultados reais pensados exclusivamente para transformar a sua rotina.',
    cta: 'Garantir com Desconto',
    badge: 'Oferta Especial',
    suggestedVisualPrompt: `Clean modern advertisement photograph of ${cleanProduct}, professional studio lighting, warm elegant tones, minimal aesthetic background, sharp product focus.`
  };
}

function getField(obj: Record<string, unknown> | null, key: string, fallback: string): string {
  if (!obj) return fallback;
  const val = obj[key];
  return typeof val === 'string' && val.trim() ? val.trim() : fallback;
}

function parseGeneratedCopy(rawOutput: string, product: string): GenerateCopyResponse {
  const parsed = extractJsonPayload(rawOutput);
  if (!parsed) return buildFallbackCopy(product);

  return {
    headline: getField(parsed, 'headline', `Descubra ${product.slice(0, 30)}`),
    subheadline: getField(parsed, 'subheadline', 'Qualidade comprovada para resultados extraordinários.'),
    cta: getField(parsed, 'cta', 'Compre Agora'),
    badge: getField(parsed, 'badge', 'Destaque'),
    suggestedVisualPrompt: getField(
      parsed,
      'suggestedVisualPrompt',
      `Studio commercial shot of ${product}, crisp lighting, high quality advertising photography.`
    )
  };
}

function buildPrompt(req: GenerateCopyRequest): string {
  const tone = req.tone || 'moderno, persuasivo e profissional';
  const audience = req.audience || 'público geral qualificado';
  const goal = req.goal || 'conversão e vendas';

  return `Você é um especialista sênior em copywriting publicitário para anúncios estáticos de alta conversão.
Crie a copy ideal e a sugestão de prompt visual para o seguinte anúncio:

- Produto/Serviço: "${req.productDescription}"
- Público-Alvo: "${audience}"
- Objetivo do Anúncio: "${goal}"
- Tom de Voz: "${tone}"

Retorne ESTRITAMENTE um objeto JSON válido (sem markdown em volta) no formato:
{
  "headline": "Título curto e impactante (máximo 7 palavras)",
  "subheadline": "Subtítulo explicando o benefício principal (1 a 2 linhas)",
  "cta": "Chamada para ação curta e clara (ex: Comprar Agora, Garanta o Seu)",
  "badge": "Tag ou selo promocional curto (ex: 20% OFF, Edição Limitada, Frete Grátis)",
  "suggestedVisualPrompt": "Prompt visual detalhado em inglês para o gerador de imagem (foco em assunto, iluminação, composição e estilo comercial limpo)"
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

function extractCopyRequest(body: unknown): GenerateCopyRequest | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const productDescription = typeof b.productDescription === 'string' ? b.productDescription.trim() : '';
  if (!productDescription) return null;

  return {
    productDescription,
    audience: typeof b.audience === 'string' ? b.audience.trim() : undefined,
    goal: typeof b.goal === 'string' ? b.goal.trim() : undefined,
    tone: typeof b.tone === 'string' ? b.tone.trim() : undefined,
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
    const response = parseGeneratedCopy(rawResult, copyReq.productDescription);
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[API SKETCH] Erro ao gerar copy:', err);
    return NextResponse.json({ error: `Erro ao gerar copy: ${message}` }, { status: 500 });
  }
}
