import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.campaignGoal !== "string") {
      return NextResponse.json(
        { error: "Parâmetro 'campaignGoal' é obrigatório e deve ser uma string." },
        { status: 400 }
      );
    }

    const { campaignGoal } = body;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "GEMINI_API_KEY não configurada no servidor." },
        { status: 500 }
      );
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const ai = new GoogleGenAI({ apiKey });

    const prompt = `
Você é o Piloto Automático do MrChicken, um estrategista digital avançado.
O usuário quer criar uma campanha de anúncios/criativos com o seguinte objetivo: "${campaignGoal}".

Para coordenar as melhores decisões e gerar o plano estratégico definitivo para esta campanha, formule exatamente 3 perguntas diagnósticas curtas, diretas e de alto impacto sobre o produto, público-alvo ou diferencial competitivo. Elas devem ajudar a calibrar os prompts de anúncios e os roteiros dos vídeos de reação.

Responda RIGOROSAMENTE em formato JSON com o seguinte formato de objeto:
{
  "questions": [
    "Pergunta 1 aqui",
    "Pergunta 2 aqui",
    "Pergunta 3 aqui"
  ]
}

IMPORTANTE: Não retorne nenhuma marcação markdown como \`\`\`json. Retorne exclusivamente o JSON bruto validável.
`;

    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json"
      }
    });

    const responseText = response.text || "{}";
    let parsedJson;
    try {
      const cleaned = responseText.replace(/```json|```/g, "").trim();
      parsedJson = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("Falha ao fazer parse do JSON das perguntas do Gemini:", responseText);
      parsedJson = {
        questions: [
          "Quem é o cliente ideal para este produto ou serviço?",
          "Qual é o principal benefício ou diferencial do seu produto?",
          "Qual tom de voz prefere para a campanha (ex: engraçado, sério, informativo)?"
        ]
      };
    }

    return NextResponse.json({
      success: true,
      questions: parsedJson.questions || []
    });

  } catch (err: any) {
    console.error("[API FLY DIAGNOSE] Erro no endpoint:", err);
    return NextResponse.json(
      { error: `Falha ao processar diagnóstico: ${err.message || String(err)}` },
      { status: 500 }
    );
  }
}
