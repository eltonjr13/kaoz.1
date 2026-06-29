import { NextResponse } from "next/server";
import { addLocalFlyCampaignJob, findLocalFlyCampaign, listLocalFlyCampaigns } from "@/lib/local-store";

export const dynamic = "force-dynamic";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type CampaignJobPatch = {
  key: string;
  jobId: string;
  type: "ad-creative" | "react-video";
  title: string | null;
  conceptName: string | null;
  index: number | null;
};

type ParsedPatch =
  | { ok: true; campaignId: string; job: CampaignJobPatch }
  | { ok: false; error: string };

type RequiredJobFields =
  | { ok: true; key: string; jobId: string; type: CampaignJobPatch["type"] }
  | { ok: false; error: string };

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseJobRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseJobType(value: unknown): CampaignJobPatch["type"] | null {
  if (value === "ad-creative") return value;
  if (value === "react-video") return value;
  return null;
}

function optionalInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseRequiredJobFields(job: Record<string, unknown>): RequiredJobFields {
  const key = requiredString(job.key);
  if (!key) return { ok: false, error: "Parametro 'job.key' e obrigatorio." };

  const jobId = requiredString(job.jobId);
  if (!jobId) return { ok: false, error: "Parametro 'job.jobId' e obrigatorio." };

  const type = parseJobType(job.type);
  if (!type) return { ok: false, error: "Parametro 'job.type' e invalido." };

  return { ok: true, key, jobId, type };
}

function parseCampaignJobPatch(body: Record<string, unknown> | null): ParsedPatch {
  const campaignId = requiredString(body?.campaignId);
  if (!campaignId) return { ok: false, error: "Parametro 'campaignId' e obrigatorio." };

  const job = parseJobRecord(body?.job);
  if (!job) return { ok: false, error: "Parametro 'job' valido e obrigatorio." };

  const requiredFields = parseRequiredJobFields(job);
  if (!requiredFields.ok) return { ok: false, error: requiredFields.error };

  return {
    ok: true,
    campaignId,
    job: {
      key: requiredFields.key,
      jobId: requiredFields.jobId,
      type: requiredFields.type,
      title: optionalString(job?.title),
      conceptName: optionalString(job?.conceptName),
      index: optionalInteger(job?.index)
    }
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get("campaignId");

    if (campaignId) {
      const campaign = await findLocalFlyCampaign(campaignId);
      if (!campaign) {
        return jsonError("Campanha Fly nao encontrada.", 404);
      }
      return NextResponse.json({ campaign });
    }

    const campaigns = await listLocalFlyCampaigns();
    return NextResponse.json({ campaigns });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return jsonError(`Erro ao buscar campanhas Fly: ${errMsg}`, 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    const parsedPatch = parseCampaignJobPatch(body);
    if (!parsedPatch.ok) {
      return jsonError(parsedPatch.error, 400);
    }

    const campaign = await addLocalFlyCampaignJob(parsedPatch.campaignId, parsedPatch.job);

    if (!campaign) {
      return jsonError("Campanha Fly nao encontrada.", 404);
    }

    return NextResponse.json({ success: true, campaign });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return jsonError(`Erro ao atualizar campanha Fly: ${errMsg}`, 500);
  }
}
