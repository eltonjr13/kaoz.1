import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";

import { getLocalDataDir, getRuntimeDataRoot } from "@/lib/runtime-paths";

export type VideoRenderSettings = {
  version: 1;
  cacheDirectory: string;
  cacheBudgetGb: 5 | 20 | 50 | 100;
};

const SETTINGS_PATH = path.join(getLocalDataDir(), "davinci-resolve-free", "render-settings.json");
const CACHE_BUDGETS = new Set([5, 20, 50, 100]);

function defaults(): VideoRenderSettings {
  return {
    version: 1,
    cacheDirectory: path.join(getRuntimeDataRoot(), "video-cache"),
    cacheBudgetGb: 20,
  };
}

export function readVideoRenderSettingsSync(): VideoRenderSettings {
  try {
    if (!existsSync(SETTINGS_PATH)) return defaults();
    const raw = JSON.parse(readFileSync(SETTINGS_PATH, "utf8")) as Partial<VideoRenderSettings>;
    const cacheDirectory = typeof raw.cacheDirectory === "string" && path.isAbsolute(raw.cacheDirectory)
      ? path.resolve(raw.cacheDirectory)
      : defaults().cacheDirectory;
    const cacheBudgetGb = CACHE_BUDGETS.has(Number(raw.cacheBudgetGb))
      ? Number(raw.cacheBudgetGb) as VideoRenderSettings["cacheBudgetGb"]
      : 20;
    return { version: 1, cacheDirectory, cacheBudgetGb };
  } catch {
    return defaults();
  }
}

export async function readVideoRenderSettings() {
  return readVideoRenderSettingsSync();
}

export async function saveVideoRenderSettings(rawInput: Record<string, unknown>) {
  const current = readVideoRenderSettingsSync();
  const cacheDirectory = typeof rawInput.cacheDirectory === "string" && path.isAbsolute(rawInput.cacheDirectory)
    ? path.resolve(rawInput.cacheDirectory.trim())
    : current.cacheDirectory;
  const requestedBudget = Number(rawInput.cacheBudgetGb);
  const cacheBudgetGb = CACHE_BUDGETS.has(requestedBudget)
    ? requestedBudget as VideoRenderSettings["cacheBudgetGb"]
    : current.cacheBudgetGb;
  await mkdir(cacheDirectory, { recursive: true });
  await mkdir(path.dirname(SETTINGS_PATH), { recursive: true });
  const settings: VideoRenderSettings = { version: 1, cacheDirectory, cacheBudgetGb };
  const temporary = `${SETTINGS_PATH}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  await rename(temporary, SETTINGS_PATH);
  return settings;
}
