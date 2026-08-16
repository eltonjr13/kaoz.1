import fs from "node:fs";
import { statfs } from "node:fs/promises";
import path from "node:path";
import ffmpegStaticPath from "ffmpeg-static";
import { getLocalDataDir, getRuntimeDataRoot } from "@/lib/runtime-paths";
import { getPublicApiProviderConfigs } from "@/services/api-providers/api-provider.settings";
import { McpManager } from "@/services/mcp/mcp.manager";
import { listSpeechModels } from "@/services/speech/speech-model.service";
import { getWhisperCppHardwareStatus } from "@/services/speech/speech-whisper-cpp-runtime";
import { overallFromChecks, overallSummary } from "./system-health.summary";
import type { SystemHealthCheck, SystemHealthReport } from "./system-health.types";

export type { SystemHealthCheck, SystemHealthReport, SystemHealthState } from "./system-health.types";

function exists(filePath: string | undefined): filePath is string {
  return Boolean(filePath && fs.existsSync(filePath));
}

function executableCandidates(name: "ffmpeg" | "ffprobe"): string[] {
  const envName = name === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH";
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const bundled = name === "ffmpeg" ? ffmpegStaticPath : null;
  return [
    process.env[envName]?.trim(),
    bundled || undefined,
    path.join(process.resourcesPath || "", "server", "node_modules", "ffmpeg-static", executable),
    path.join(process.cwd(), "node_modules", "ffmpeg-static", executable),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function resolveExecutable(name: "ffmpeg" | "ffprobe"): string | null {
  return executableCandidates(name).find(exists) || null;
}

function pythonCandidates(): string[] {
  const executable = process.platform === "win32" ? "python.exe" : "python";
  return [
    process.env.STT_PARAKEET_PYTHON_PATH?.trim(),
    process.env.STT_PYTHON_PATH?.trim(),
    path.join(process.resourcesPath || "", "parakeet-runtime", "python", executable),
    path.join(process.cwd(), "build", "runtime", "parakeet", "python", executable),
    process.env.PYTHON_PATH?.trim(),
  ].filter((candidate): candidate is string => Boolean(candidate));
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

export async function getSystemHealthReport(): Promise<SystemHealthReport> {
  const [models, hardware, providers, mcpResult, diskResult] = await Promise.all([
    listSpeechModels(),
    getWhisperCppHardwareStatus(),
    getPublicApiProviderConfigs(),
    getMcpHealth(),
    getDiskHealth(),
  ]);

  const ffmpeg = resolveExecutable("ffmpeg");
  const ffprobe = resolveExecutable("ffprobe");
  const python = pythonCandidates().find(exists);
  const readyModels = models.filter((model) => model.state === "ready");
  const failedModels = models.filter((model) => model.state === "error");
  const configuredProviders = providers.filter((provider) => provider.configured);
  const checks: SystemHealthCheck[] = [
    {
      id: "ffmpeg",
      label: "FFmpeg",
      state: ffmpeg ? "healthy" : "error",
      detail: ffmpeg ? "Binário local encontrado para renderização e conversão." : "FFmpeg não foi encontrado. Configure FFMPEG_PATH ou reinstale o aplicativo.",
    },
    {
      id: "ffprobe",
      label: "FFprobe",
      state: ffprobe ? "healthy" : "warning",
      detail: ffprobe ? "Binário local encontrado para leitura de metadados." : "FFprobe não foi localizado. Algumas leituras de mídia podem ficar limitadas.",
    },
    {
      id: "python-runtime",
      label: "Runtime Python local",
      state: python ? "healthy" : "warning",
      detail: python ? "Runtime disponível para Parakeet e serviços locais." : "Runtime Python local não encontrado; a transcrição Parakeet não poderá iniciar.",
    },
    {
      id: "vulkan",
      label: "GPU / Vulkan",
      state: hardware.vulkanAvailable ? "healthy" : "warning",
      detail: hardware.message,
    },
    {
      id: "speech-models",
      label: "Modelos de transcrição",
      state: failedModels.length > 0 ? "error" : readyModels.length > 0 ? "healthy" : "warning",
      detail: failedModels.length > 0
        ? `${failedModels.length} modelo(s) com erro de instalação.`
        : readyModels.length > 0
          ? `${readyModels.length} modelo(s) local(is) pronto(s).`
          : "Nenhum modelo local instalado. Baixe um modelo antes de transcrever offline.",
    },
    {
      id: "api-providers",
      label: "Provedores de IA",
      state: configuredProviders.length > 0 ? "healthy" : "warning",
      detail: configuredProviders.length > 0
        ? `${configuredProviders.length} de ${providers.length} provedor(es) configurado(s), sem expor chaves.`
        : "Nenhum provedor de API configurado.",
    },
    ...mcpResult.checks,
    diskResult,
    {
      id: "desktop-mode",
      label: "Aplicativo Windows",
      state: process.env.KAOZ1_DESKTOP === "1" || process.env.MRCHICKEN_DESKTOP === "1" ? "healthy" : "info",
      detail: process.env.KAOZ1_DESKTOP === "1" || process.env.MRCHICKEN_DESKTOP === "1"
        ? "Executando no ambiente desktop do Kaoz.1."
        : "Executando no modo web/desenvolvimento.",
    },
  ];

  const overall = overallFromChecks(checks);
  return {
    checkedAt: new Date().toISOString(),
    overall,
    summary: overallSummary(overall),
    groups: [
      { id: "runtime", label: "Runtimes locais", checks: checks.slice(0, 4) },
      { id: "services", label: "Modelos e integrações", checks: checks.slice(4, 7) },
      { id: "environment", label: "Ambiente", checks: checks.slice(7) },
    ],
  };
}

async function getMcpHealth(): Promise<{ checks: SystemHealthCheck[] }> {
  try {
    const manager = await McpManager.getInstance();
    const settings = manager.getSettings();
    const enabled = settings.servers.filter((server) => server.enabled);
    const statuses = manager.getStatuses();
    const connected = statuses.filter((status) => status.connected).length;
    return {
      checks: [{
        id: "mcp",
        label: "Servidores MCP",
        state: enabled.length === 0 ? "info" : connected === enabled.length ? "healthy" : connected > 0 ? "warning" : "error",
        detail: enabled.length === 0
          ? "Nenhum servidor MCP está habilitado."
          : `${connected} de ${enabled.length} servidor(es) MCP habilitado(s) conectado(s).`,
      }],
    };
  } catch {
    return { checks: [{ id: "mcp", label: "Servidores MCP", state: "error", detail: "Não foi possível ler o estado dos servidores MCP." }] };
  }
}

async function getDiskHealth(): Promise<SystemHealthCheck> {
  try {
    const disk = await statfs(getRuntimeDataRoot());
    const available = Number(disk.bavail) * Number(disk.bsize);
    return {
      id: "disk",
      label: "Espaço em disco",
      state: available < 2 * 1024 ** 3 ? "error" : available < 10 * 1024 ** 3 ? "warning" : "healthy",
      detail: `${formatBytes(available)} disponíveis para modelos, mídia e renders locais.`,
    };
  } catch {
    return {
      id: "disk",
      label: "Espaço em disco",
      state: "warning",
      detail: `Não foi possível medir o disco de dados em ${getLocalDataDir()}.`,
    };
  }
}
