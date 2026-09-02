export type RenderPreviewJob = {
  id: string;
  planId: string;
  kind: "proxy" | "spot-preview" | "export" | "batch-export";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  resultPath?: string;
};

export function latestCompletedExportJob<T extends RenderPreviewJob>(
  jobs: T[],
  planId?: string,
) {
  if (!planId) return undefined;
  return jobs.find((job) =>
    job.planId === planId
    && job.kind === "export"
    && job.status === "completed"
    && Boolean(job.resultPath),
  );
}

export function renderedPreviewSelection<T extends RenderPreviewJob>(
  jobs: T[],
  finalJobId: string | null,
  spotJobId: string | null,
) {
  const finalJob = jobs.find((job) =>
    job.id === finalJobId
    && job.kind === "export"
    && job.status === "completed"
    && Boolean(job.resultPath),
  );
  const spotJob = jobs.find((job) =>
    job.id === spotJobId
    && job.kind === "spot-preview"
    && job.status === "completed"
    && Boolean(job.resultPath),
  );
  return {
    finalJob,
    spotJob,
    activeJob: finalJob || spotJob,
  };
}
