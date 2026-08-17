import { NextResponse } from "next/server";
import { campaignProductionService } from "@/services/campaign-production/campaign-production.service";
import type { ProduceCampaignRequest } from "@/services/campaign-production/campaign-production.types";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ProduceCampaignRequest & { sync?: boolean };

    if (!body.artifacts?.length && !body.artifactIds?.length && !body.customScenes?.length) {
      return jsonError("Informe pelo menos um artefato, ID de artefato ou lista de cenas para produzir.");
    }

    const job = await campaignProductionService.createCampaignProductionJob(body);

    if (body.sync === true) {
      const completed = await campaignProductionService.executeCampaignProduction(job.id);
      return NextResponse.json({
        success: true,
        job: completed,
        message: "Produção de campanha concluída com sucesso.",
      });
    }

    // Execute in background
    void campaignProductionService.executeCampaignProduction(job.id).catch((err) => {
      console.error(`[CampaignProduceRoute] Erro na execução da campanha ${job.id}:`, err);
    });

    return NextResponse.json({
      success: true,
      job,
      message: "Produção de campanha iniciada com sucesso.",
    });
  } catch (error: any) {
    console.error("[CampaignProduceRoute] Erro inesperado:", error);
    return jsonError(error?.message || "Erro ao processar solicitação de produção.", 500);
  }
}
