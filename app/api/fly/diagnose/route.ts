import { NextResponse } from "next/server";
import { generateFlyJson, parseFlyAiModel } from "@/lib/ai/fly-json";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body.campaignGoal !== "string") {
      return NextResponse.json(
        { error: "Parametro 'campaignGoal' e obrigatorio e deve ser uma string." },
        { status: 400 }
      );
    }

    const { campaignGoal } = body;
    const model = parseFlyAiModel(body.model);

    const prompt = `
Voce e o Piloto Automatico do MrChicken, um estrategista digital avancado.
O usuario quer criar uma campanha de anuncios/criativos com o seguinte objetivo: "${campaignGoal}".

Para coordenar as melhores decisoes e gerar o plano estrategico definitivo para esta campanha, formule exatamente 3 perguntas diagnosticas curtas, diretas e de alto impacto sobre o produto, publico-alvo ou diferencial competitivo. Elas devem ajudar a calibrar os prompts de anuncios e os roteiros dos videos de reacao.

Responda RIGOROSAMENTE em formato JSON com o seguinte formato de objeto:
{
  "questions": [
    "Pergunta 1 aqui",
    "Pergunta 2 aqui",
    "Pergunta 3 aqui"
  ]
}

IMPORTANTE: Nao retorne nenhuma marcacao markdown como \`\`\`json. Retorne exclusivamente o JSON bruto validavel.
`;

    const responseText = await generateFlyJson(model, prompt);
    let parsedJson;
    try {
      const cleaned = responseText.replace(/```json|```/g, "").trim();
      parsedJson = JSON.parse(cleaned);
    } catch {
      console.error("Falha ao fazer parse do JSON das perguntas:", responseText);
      parsedJson = {
        questions: [
          "Quem e o cliente ideal para este produto ou servico?",
          "Qual e o principal beneficio ou diferencial do seu produto?",
          "Qual tom de voz prefere para a campanha (ex: engracado, serio, informativo)?"
        ]
      };
    }

    return NextResponse.json({
      success: true,
      model,
      questions: Array.isArray(parsedJson.questions) ? parsedJson.questions : []
    });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLY DIAGNOSE] Erro no endpoint:", err);
    return NextResponse.json(
      { error: `Falha ao processar diagnostico: ${errMsg}` },
      { status: 500 }
    );
  }
}
