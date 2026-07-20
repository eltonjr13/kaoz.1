/* eslint-disable complexity */
import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { getFlowGeneratedDir, getFlowTempUploadsDir } from "@/lib/runtime-paths";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const filePathParam = searchParams.get("path");

    if (!filePathParam) {
      return jsonError("Parâmetro path é obrigatório.", 400);
    }

    // Normalize path to use platform-specific separators
    const normalizedParam = filePathParam.replace(/[/\\]/g, path.sep);
    
    // Extract the relative path if it contains the allowed storage directory name
    const storageMarkerGenerated = `${path.sep}storage${path.sep}generated${path.sep}`;
    const storageMarkerTemp = `${path.sep}storage${path.sep}temp_uploads${path.sep}`;
    const markerGeneratedIndex = normalizedParam.toLowerCase().indexOf(storageMarkerGenerated.toLowerCase());
    const markerTempIndex = normalizedParam.toLowerCase().indexOf(storageMarkerTemp.toLowerCase());
    
    const generatedRoot = getFlowGeneratedDir();
    const tempRoot = getFlowTempUploadsDir();
    let targetPath = filePathParam;
    if (markerGeneratedIndex >= 0) {
      const relativePart = normalizedParam.substring(markerGeneratedIndex + storageMarkerGenerated.length);
      targetPath = path.join(generatedRoot, relativePart);
    } else if (markerTempIndex >= 0) {
      const relativePart = normalizedParam.substring(markerTempIndex + storageMarkerTemp.length);
      targetPath = path.join(tempRoot, relativePart);
    } else if (normalizedParam.toLowerCase().startsWith(`storage${path.sep}generated${path.sep}`)) {
      targetPath = path.join(generatedRoot, normalizedParam.substring(`storage${path.sep}generated${path.sep}`.length));
    } else if (normalizedParam.toLowerCase().startsWith(`storage${path.sep}temp_uploads${path.sep}`)) {
      targetPath = path.join(tempRoot, normalizedParam.substring(`storage${path.sep}temp_uploads${path.sep}`.length));
    }

    // Resolve path to check file availability
    const absolutePath = path.resolve(targetPath);

    // Security check: ensure the file resides inside our allowed storage paths
    const allowedRoots = [
      generatedRoot,
      tempRoot
    ];
    
    const isWindows = process.platform === "win32";
    const normAbsolute = isWindows ? absolutePath.toLowerCase() : absolutePath;
    
    const isAllowed = allowedRoots.some(allowedRoot => {
      const normAllowed = isWindows ? allowedRoot.toLowerCase() : allowedRoot;
      // Ensure we check with a trailing separator to prevent partial folder name matching
      const allowedPrefix = normAllowed.endsWith(path.sep) ? normAllowed : normAllowed + path.sep;
      return normAbsolute.startsWith(allowedPrefix);
    });

    if (!isAllowed) {
      return jsonError("Acesso negado fora do diretório de armazenamento.", 403);
    }

    if (!fs.existsSync(absolutePath)) {
      return jsonError("Arquivo não encontrado.", 404);
    }

    const fileBuffer = fs.readFileSync(absolutePath);
    const ext = path.extname(absolutePath).toLowerCase();
    
    let contentType = "application/octet-stream";
    if (ext === ".png") contentType = "image/png";
    else if (ext === ".jpg" || ext === ".jpeg") contentType = "image/jpeg";
    else if (ext === ".webp") contentType = "image/webp";
    else if (ext === ".mp4") contentType = "video/mp4";
    else if (ext === ".glb") contentType = "model/gltf-binary";
    else if (ext === ".gltf") contentType = "model/gltf+json";
    else if (ext === ".obj") contentType = "model/obj";
    else if (ext === ".fbx") contentType = "application/octet-stream";

    const shouldDownload = searchParams.get("download") === "true";
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": fileBuffer.length.toString()
    };

    if (shouldDownload) {
      headers["Content-Disposition"] = `attachment; filename="${path.basename(absolutePath)}"`;
    }

    return new NextResponse(fileBuffer, { headers });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API FLOW MEDIA] Erro ao servir arquivo:", err);
    return jsonError(`Erro ao obter arquivo: ${errMsg}`, 500);
  }
}
