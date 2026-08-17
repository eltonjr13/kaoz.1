import { NextResponse } from "next/server";
import { campaignProductionService } from "@/services/campaign-production/campaign-production.service";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const params = await props.params;
    const { id } = params;

    if (!id) {
      return NextResponse.json({ success: false, error: "ID da campanha não informado." }, { status: 400 });
    }

    const job = await campaignProductionService.getCampaignProductionJob(id);
    if (!job) {
      return NextResponse.json({ success: false, error: "Campanha não encontrada." }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      job,
    });
  } catch (error: any) {
    console.error("[CampaignGetRoute] Erro inesperado:", error);
    return NextResponse.json({ success: false, error: error?.message || "Erro ao consultar campanha." }, { status: 500 });
  }
}
