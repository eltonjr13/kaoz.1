import { NextResponse } from "next/server";
import { createLocalJobEvent, findLocalJob, updateLocalJob } from "@/lib/local-store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { jobId?: unknown } | null;
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";

    if (!jobId) {
      return NextResponse.json({ error: "jobId obrigatorio." }, { status: 400 });
    }

    const job = await findLocalJob(jobId);
    if (!job) {
      return NextResponse.json({ error: "Job nao encontrado." }, { status: 404 });
    }

    if (job.status === "completed" || job.status === "failed") {
      return NextResponse.json({ success: true, job });
    }

    const errorMessage = "Cancelado pelo usuario.";
    const updatedJob = await updateLocalJob(jobId, {
      status: "failed",
      error_message: errorMessage
    });

    await createLocalJobEvent(jobId, "failed", errorMessage);

    return NextResponse.json({ success: true, job: updatedJob });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
