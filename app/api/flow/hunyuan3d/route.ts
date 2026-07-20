import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import path from "node:path";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import { getFlowGeneratedDir, getFlowTempUploadsDir } from "@/lib/runtime-paths";

export const dynamic = "force-dynamic";

function parseImagePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function parseStoredImagePackage(value?: string | null): Record<string, unknown> {
  if (!value) return {};
  const marker = "Imagens salvas em:";
  const jsonText = value.includes(marker) ? value.slice(value.indexOf(marker) + marker.length).trim() : value;

  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function resolveAllowedMediaPath(mediaPath: string): string | null {
  const absolutePath = path.resolve(mediaPath);
  const allowedRoots = [
    getFlowGeneratedDir(),
    getFlowTempUploadsDir()
  ];
  const isWindows = process.platform === "win32";
  const normalizedPath = isWindows ? absolutePath.toLowerCase() : absolutePath;

  const isAllowed = allowedRoots.some((root) => {
    const normalizedRoot = isWindows ? root.toLowerCase() : root;
    const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
    return normalizedPath.startsWith(prefix);
  });

  if (!isAllowed || !existsSync(absolutePath)) return null;
  return absolutePath;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      jobId?: unknown;
      imagePaths?: unknown;
    } | null;
    const jobId = typeof body?.jobId === "string" ? body.jobId.trim() : "";
    const imagePaths = parseImagePaths(body?.imagePaths);

    if (!jobId || imagePaths.length === 0) {
      return NextResponse.json({ error: "Parametros 'jobId' e 'imagePaths' sao obrigatorios." }, { status: 400 });
    }

    const resolvedImagePaths = imagePaths.map(resolveAllowedMediaPath);
    if (resolvedImagePaths.some((imagePath) => !imagePath)) {
      return NextResponse.json({ error: "Uma ou mais imagens 3D sao invalidas ou fora do diretorio permitido." }, { status: 400 });
    }

    const { findLocalJob, updateLocalJob, createLocalJobEvent } = await import("@/lib/local-store");
    const existingJob = await findLocalJob(jobId);
    if (!existingJob) {
      return NextResponse.json({ error: "Job nao encontrado." }, { status: 404 });
    }

    void (async () => {
      try {
        await updateLocalJob(jobId, { status: "researching", error_message: null });
        await createLocalJobEvent(jobId, "researching", "Enviando imagens aprovadas para o Hunyuan 3D pelo navegador.");
        const model3d = await flowProvider.generate3DObjectFromImages(resolvedImagePaths as string[], jobId);
        const storedPackage = parseStoredImagePackage(existingJob.source_video_transcription);
        await updateLocalJob(jobId, {
          status: "completed",
          final_video_path: existingJob.final_video_path || imagePaths[0],
          source_video_description: `${existingJob.source_video_description || "Pacote 3D"} + objeto 3D gerado no Hunyuan`,
          source_video_transcription: `Imagens salvas em: ${JSON.stringify({
            ...storedPackage,
            mode: storedPackage.mode || "turnaround3d",
            model3d
          })}`,
          error_message: null
        });
        await createLocalJobEvent(jobId, "completed", "Objeto 3D gerado no Hunyuan e baixado com sucesso.", model3d);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[API HUNYUAN 3D] Erro ao gerar objeto 3D para o job ${jobId}:`, err);
        await updateLocalJob(jobId, { status: "failed", error_message: errMsg });
        await createLocalJobEvent(jobId, "failed", `Falha ao gerar objeto 3D no Hunyuan: ${errMsg}`);
      }
    })();

    return NextResponse.json({
      success: true,
      jobId,
      message: "Geracao do objeto 3D iniciada no navegador."
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API HUNYUAN 3D] Erro geral:", err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
