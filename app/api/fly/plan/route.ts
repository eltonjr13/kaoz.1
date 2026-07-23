import { NextResponse } from "next/server";
import { generateFlyJson, parseFlyAiModel } from "@/lib/ai/fly-json";
import { createLocalFlyCampaign } from "@/lib/local-store";

export const dynamic = "force-dynamic";

type FlyPlanRequest = {
  campaignGoal: string;
  questions: string[];
  answers: string[];
  avatarId: string | null;
  model: ReturnType<typeof parseFlyAiModel>;
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parsePlanRequest(body: Record<string, unknown> | null): FlyPlanRequest | null {
  if (!body || typeof body.campaignGoal !== "string" || !Array.isArray(body.questions) || !Array.isArray(body.answers)) {
    return null;
  }

  return {
    campaignGoal: body.campaignGoal,
    questions: stringArray(body.questions),
    answers: stringArray(body.answers),
    avatarId: typeof body.avatarId === "string" && body.avatarId.trim() ? body.avatarId.trim() : null,
    model: parseFlyAiModel(body.model)
  };
}

function parsePlanJson(responseText: string): Record<string, unknown> | null {
  try {
    const cleaned = responseText.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    console.error("Falha ao analisar JSON do plano de campanha:", responseText);
    return null;
  }
}

function applyAvatarId(planData: Record<string, unknown>, avatarId: string | null) {
  if (!avatarId || !planData.avatarRecommendation || typeof planData.avatarRecommendation !== "object") {
    return planData;
  }

  return {
    ...planData,
    avatarRecommendation: {
      ...(planData.avatarRecommendation as Record<string, unknown>),
      avatarId
    }
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const parsedRequest = parsePlanRequest(body);
    if (!parsedRequest) {
      return NextResponse.json(
        { error: "Parametros 'campaignGoal', 'questions' e 'answers' sao obrigatorios." },
        { status: 400 }
      );
    }

    const { campaignGoal, questions, answers, avatarId, model } = parsedRequest;

    const qnaString = questions.map((q: string, idx: number) => {
      const ans = answers[idx] || "Nao especificado";
      return `Pergunta: ${q}\nResposta: ${ans}`;
    }).join("\n\n");

    const prompt = `
Voce e o Piloto Automatico do Kaoz.1, um diretor de criacao e estrategista de marketing digital avancado.
O usuario deseja planejar uma campanha otimizada de criativos e videos com base nos seguintes dados:

Briefing Inicial da Campanha: "${campaignGoal}"

Respostas do Questionario de Diagnostico:
${qnaString}

Sua tarefa e planejar, estruturar e coordenar as melhores decisoes criativas para gerar o Plano de Campanha Otimizado Definitivo.

O plano deve conter:
1. Nome da Campanha e slogan atraente.
2. Perfil detalhado do publico-alvo (demografica, principais dores e desejos).
3. Proposta de valor central.
4. Raciocinio de recomendacao do avatar.
5. Recomendacoes de criativos de anuncio de imagem (exatamente 4 conceitos). Para cada um, defina:
   - Um nome de conceito curto (ex: "Visual Showcase", "Pain Relief")
   - Copy/texto do criativo (frase curta e magnetica para aparecer sobre a imagem)
   - Prompt visual detalhado em ingles para o gerador de imagens (ImageFX). O prompt deve ser focado em um unico assunto/personagem/objeto, com iluminacao de estudio profissional, estilo premium ("depth of field", "cinematic lighting") e especificacao exata de onde e como o texto (copyText) deve ser desenhado na imagem em ingles de forma integrada (ex: "with a clean bold sans-serif text overlay in the top area reading '...'").
   - Breve explicacao estrategica do porque esse conceito funciona.
6. Recomendacoes de videos de react (exatamente 2 conceitos). Para cada um, defina:
   - Titulo marcante do video.
   - Um gancho de atencao curto para os primeiros 3 segundos.
   - Assunto de pesquisa/reacao (o termo de busca ou tipo de video que o avatar ira reagir e comentar).
   - Roteiro sugerido de no maximo 15 segundos em portugues, simulando a fala do avatar reagindo e vendendo/chamando para acao.
   - Breve justificativa estrategica.
7. Legendas sociais (exatamente 2 opcoes de legenda com emojis, hashtags e chamada para acao clara).

Responda RIGOROSAMENTE em formato JSON seguindo exatamente esta estrutura:
{
  "campaignName": "Nome da Campanha",
  "tagline": "Slogan da Campanha",
  "objective": "Objetivo original resumido",
  "targetAudience": {
    "demographic": "Perfil demografico geral",
    "painPoints": ["dor 1", "dor 2"],
    "desires": ["desejo 1", "desejo 2"]
  },
  "valueProposition": "Proposta de valor central",
  "avatarRecommendation": {
    "avatarId": "ID do avatar recomendado",
    "rationale": "Por que este avatar foi selecionado e qual postura ele deve adotar"
  },
  "recommendedAdCreatives": [
    {
      "conceptName": "Conceito 1",
      "copyText": "Texto a ser colocado na imagem",
      "visualPrompt": "Detailed visual prompt in English for image generator...",
      "explanation": "Explicacao da estrategia"
    }
  ],
  "recommendedReactVideos": [
    {
      "title": "Titulo do Video 1",
      "topic": "Assunto ou nicho do video fonte para reagir",
      "hook": "Gancho inicial de 3 segundos",
      "voiceoverScript": "Roteiro do react em portugues (limite de 15 segundos de fala)",
      "explanation": "Por que esse react converte"
    }
  ],
  "socialCaptions": [
    {
      "platform": "Instagram / TikTok",
      "captionText": "Texto completo da legenda",
      "callToAction": "Chamada para acao"
    }
  ]
}

IMPORTANTE: Nao inclua nenhuma marcacao de bloco de codigo (\`\`\`json). Retorne exclusivamente o JSON bruto validavel.
`;

    const responseText = await generateFlyJson(model, prompt);
    const parsedPlanData = parsePlanJson(responseText);
    if (!parsedPlanData) {
      return NextResponse.json({ error: "Falha na resposta do servidor de IA." }, { status: 500 });
    }
    const planData = applyAvatarId(parsedPlanData, avatarId);

    const campaign = await createLocalFlyCampaign({
      campaignGoal,
      questions,
      answers,
      avatarId,
      model,
      plan: planData
    });

    return NextResponse.json({
      success: true,
      model,
      campaignId: campaign.id,
      campaign,
      plan: planData
    });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLY PLAN] Erro no endpoint:", err);
    return NextResponse.json(
      { error: `Falha ao gerar plano: ${errMsg}` },
      { status: 500 }
    );
  }
}
