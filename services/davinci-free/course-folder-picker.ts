import crypto from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdir,
  readFile,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type CourseFolderPickerOptions = Readonly<{
  pickerDirectory: string;
  runScript?: (scriptPath: string, resultPath: string) => Promise<void>;
  responseTimeoutMs?: number;
  pollIntervalMs?: number;
}>;

export async function normalizeExistingLocalCourseDirectory(
  value: unknown,
): Promise<string> {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || !path.win32.isAbsolute(raw)) {
    throw new Error("A pasta do curso deve usar um caminho local absoluto.");
  }
  const normalized = path.win32.normalize(raw);
  if (normalized.startsWith("\\\\")) {
    throw new Error("A pasta do curso deve usar um caminho local absoluto.");
  }
  const info = await stat(normalized).catch(() => null);
  if (!info?.isDirectory() && !info?.isFile()) {
    throw new Error("O arquivo ou pasta selecionada não foi encontrada.");
  }
  return normalized;
}

export async function chooseCourseFolder(
  options: CourseFolderPickerOptions,
) {
  if (process.platform !== "win32") {
    throw new Error("O seletor está disponível somente no Windows.");
  }
  const pickerDirectory = options.pickerDirectory;
  await mkdir(pickerDirectory, { recursive: true });
  const token = crypto.randomBytes(12).toString("hex");
  const scriptPath = path.join(pickerDirectory, `${token}.vbs`);
  const resultPath = path.join(pickerDirectory, `${token}.result`);
  const escapedResultPath = resultPath.replaceAll('"', '""');
  const script = [
    "Option Explicit",
    "Dim shell, folder, fso, output",
    'Set shell = CreateObject("Shell.Application")',
    'Set folder = shell.BrowseForFolder(0, "Selecione a pasta ou vídeo da aula", &H4041, 0)',
    'Set fso = CreateObject("Scripting.FileSystemObject")',
    `Set output = fso.CreateTextFile("${escapedResultPath}", True, True)`,
    "If folder Is Nothing Then",
    '  output.Write "CANCEL"',
    "Else",
    "  output.Write folder.Self.Path",
    "End If",
    "output.Close",
  ].join("\r\n");
  await writeFile(scriptPath, `\uFEFF${script}`, "utf16le");
  try {
    const runScript = options.runScript ?? runCourseFolderPickerScript;
    await runScript(scriptPath, resultPath);
    const responseTimeoutMs = options.responseTimeoutMs ?? 10 * 60_000;
    const pollIntervalMs = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + responseTimeoutMs;
    let selected = "";
    while (Date.now() < deadline) {
      const raw = await readFile(resultPath, "utf16le").catch(() => "");
      if (raw) {
        selected = raw.replace(/^\uFEFF/, "").trim();
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    if (!selected) {
      throw new Error("O seletor de pasta expirou sem resposta.");
    }
    if (selected === "CANCEL") {
      return { canceled: true, folderPath: null };
    }
    return {
      canceled: false,
      folderPath: await normalizeExistingLocalCourseDirectory(selected),
    };
  } finally {
    await Promise.all([
      unlink(scriptPath).catch(() => undefined),
      unlink(resultPath).catch(() => undefined),
    ]);
  }
}

async function runCourseFolderPickerScript(scriptPath: string) {
  await execFileAsync("wscript.exe", [scriptPath], {
    timeout: 10 * 60_000,
    windowsHide: false,
  });
}
