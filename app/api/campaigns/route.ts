import { NextResponse } from "next/server";
import { campaignProductionService } from "@/services/campaign-production/campaign-production.service";

export const runtime = "nodejs";

export async function GET() {
  try {
    const jobs = await campaignProductionService.listCampaignProductionJobs();
    return NextResponse.json({
      success: true,
      jobs,
    });
  } catch (error: any) {
    console.error("[CampaignsListRoute] Erro inesperado:", error);
    return NextResponse.json({ success: false, error: error?.message || "Erro ao listar campanhas." }, { status: 500 });
  }
}
