import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.campaignGoal !== "string" || !Array.isArray(body.questions) || !Array.isArray(body.answers)) {
      return NextResponse.json(
        { error: "Parâmetros 'campaignGoal', 'questions' e 'answers' são obrigatórios." },
        { status: 400 }
      );
    }

    const { campaignGoal, questions, answers, avatarId, model } = body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY não configurada no servidor." },
        { status: 500 }
      );
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const ai = new GoogleGenAI({ apiKey });

    const qnaString = questions.map((q: string, idx: number) => {
      const ans = answers[idx] || "Não especificado";
      return `Pergunta: ${q}\nResposta: ${ans}`;
    }).join("\n\n");

    const prompt = `
Você é o Piloto Automático do MrChicken, um diretor de criação e estrategista de marketing digital avançado.
O usuário deseja planejar uma campanha otimizada de criativos e vídeos com base nos seguintes dados:

Briefing Inicial da Campanha: "${campaignGoal}"

Respostas do Questionário de Diagnóstico:
${qnaString}

Sua tarefa é planejar, estruturar e coordenar as melhores decisões criativas para gerar o **Plano de Campanha Otimizado Definitivo**.

O plano deve conter:
1. Nome da Campanha e Slogan atraente.
2. Perfil detalhado do Público-alvo (demográfica, principais dores e desejos).
3. Proposta de Valor central.
4. Raciocínio de recomendação do avatar.
5. Recomendações de Criativos de Anúncio de Imagem (Exatamente 4 conceitos). Para cada um, defina:
   - Um nome de conceito curto (ex: "Visual Showcase", "Pain Relief")
   - Copy/Texto do criativo (frase curta e magnética para aparecer sobre a imagem)
   - Prompt visual detalhado em inglês para o gerador de imagens (ImageFX). O prompt deve ser focado em um único assunto/personagem/objeto, com iluminação de estúdio profissional, estilo premium ("depth of field", "cinematic lighting") e especificação exata de onde e como o texto (copyText) deve ser desenhado na imagem em inglês de forma integrada (ex: "with a clean bold sans-serif text overlay in the top area reading '...'").
   - Breve explicação estratégica do porquê esse conceito funciona.
6. Recomendações de Vídeos de React (Exatamente 2 conceitos). Para cada um, defina:
   - Título marcante do vídeo.
   - Um gancho de atenção curto para os primeiros 3 segundos.
   - Assunto de pesquisa/reação (o termo de busca ou tipo de vídeo que o avatar irá reagir e comentar).
   - Roteiro sugerido de no máximo 15 segundos em português, simulando a fala do avatar reagindo e vendendo/chamando para ação.
   - Breve justificativa estratégica.
7. Legendas Sociais (Exatamente 2 opções de legenda com emojis, hashtags e chamada para ação clara).

Responda RIGOROSAMENTE em formato JSON seguindo exatamente esta estrutura:
{
  "campaignName": "Nome da Campanha",
  "tagline": "Slogan da Campanha",
  "objective": "Objetivo original resumido",
  "targetAudience": {
    "demographic": "Perfil demográfico geral",
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
      "explanation": "Explicação da estratégia"
    }
  ],
  "recommendedReactVideos": [
    {
      "title": "Título do Vídeo 1",
      "topic": "Assunto ou nicho do vídeo fonte para reagir",
      "hook": "Gancho inicial de 3 segundos",
      "voiceoverScript": "Roteiro do react em português (limite de 15 segundos de fala)",
      "explanation": "Por que esse react converte"
    }
  ],
  "socialCaptions": [
    {
      "platform": "Instagram / TikTok",
      "captionText": "Texto completo da legenda",
      "callToAction": "Chamada para ação"
    }
  ]
}

IMPORTANTE: Não inclua nenhuma marcação de bloco de código (\`\`\`json). Retorne exclusivamente o JSON bruto validável.
`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text || "{}";
    let planData;
    try {
      const cleaned = responseText.replace(/```json|```/g, "").trim();
      planData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Falha ao analisar JSON do plano de campanha:", responseText);
      return NextResponse.json({ error: "Falha na resposta do servidor de IA." }, { status: 500 });
    }

    // Force inject the actual avatarId if passed
    if (avatarId && planData.avatarRecommendation) {
      planData.avatarRecommendation.avatarId = avatarId;
    }

    return NextResponse.json({
      success: true,
      plan: planData
    });

  } catch (err: any) {
    console.error("[API FLY PLAN] Erro no endpoint:", err);
    return NextResponse.json(
      { error: `Falha ao gerar plano: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}
