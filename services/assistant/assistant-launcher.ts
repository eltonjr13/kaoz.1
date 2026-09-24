import { spawn } from "node:child_process";
import { stat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import { AssistantInputError } from "./assistant-errors.ts";

export interface AssistantTarget {
  id: string;
  label: string;
  description: string;
}

type LaunchSpec = AssistantTarget & { executable: string; args: string[]; workspace?: boolean };

export function getAssistantWorkspaceDir(): string {
  return path.join(getLocalDataDir(), "assistant-workspace");
}

async function isFile(filePath: string): Promise<boolean> {
  return (await stat(filePath).catch(() => null))?.isFile() === true;
}

async function launchSpecs(): Promise<LaunchSpec[]> {
  if (process.platform !== "win32") return [];
  const windowsDir = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
  const workspace = getAssistantWorkspaceDir();
  const candidates: LaunchSpec[] = [
    {
      id: "notepad",
      label: "Bloco de Notas",
      description: "Abrir o editor de texto do Windows.",
      executable: path.join(windowsDir, "System32", "notepad.exe"),
      args: [],
    },
    {
      id: "calculator",
      label: "Calculadora",
      description: "Abrir a Calculadora do Windows.",
      executable: path.join(windowsDir, "System32", "calc.exe"),
      args: [],
    },
    {
      id: "workspace-explorer",
      label: "Pasta de trabalho Kaoz.1",
      description: "Abrir a pasta de trabalho no Explorador de Arquivos.",
      executable: path.join(windowsDir, "explorer.exe"),
      args: [workspace],
      workspace: true,
    },
  ];

  const codeLocations = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs", "Microsoft VS Code", "Code.exe"),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, "Microsoft VS Code", "Code.exe"),
    process.env["ProgramFiles(x86)"] && path.join(process.env["ProgramFiles(x86)"], "Microsoft VS Code", "Code.exe"),
  ].filter((value): value is string => Boolean(value));
  const codePath = (await Promise.all(codeLocations.map(async (candidate) => (
    await isFile(candidate) ? candidate : null
  )))).find((value): value is string => value !== null);
  if (codePath) {
    candidates.push({
      id: "workspace-vscode",
      label: "Pasta de trabalho no VS Code",
      description: "Abrir a pasta de trabalho Kaoz.1 no Visual Studio Code.",
      executable: codePath,
      args: [workspace],
      workspace: true,
    });
  }
  const available = await Promise.all(candidates.map(async (candidate) => (
    await isFile(candidate.executable) ? candidate : null
  )));
  return available.filter((candidate): candidate is LaunchSpec => candidate !== null);
}

export async function listAssistantTargets(): Promise<AssistantTarget[]> {
  return (await launchSpecs()).map(({ id, label, description }) => ({ id, label, description }));
}

async function spawnKnownTarget(target: LaunchSpec): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const childEnv = { ...process.env };
    delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(target.executable, target.args, {
      detached: true,
      stdio: "ignore",
      shell: false,
      windowsHide: false,
      env: childEnv,
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function openAssistantTarget(targetId: string): Promise<{ targetId: string; message: string }> {
  const target = (await launchSpecs()).find((item) => item.id === targetId);
  if (!target) throw new AssistantInputError("Destino indisponível ou não permitido neste computador.");
  if (target.workspace) await mkdir(getAssistantWorkspaceDir(), { recursive: true });
  await spawnKnownTarget(target);
  return { targetId: target.id, message: `Solicitei a abertura de ${target.label}.` };
}

export async function openAssistantProjectInCode(folderPath: string): Promise<boolean> {
  const workspace = await realpath(getAssistantWorkspaceDir());
  const project = await realpath(folderPath);
  if (path.dirname(project).toLowerCase() !== workspace.toLowerCase()
    || !(await stat(project)).isDirectory()) {
    throw new AssistantInputError("Projeto fora da pasta de trabalho da Kaoz.1.");
  }
  const target = (await launchSpecs()).find((item) => item.id === "workspace-vscode");
  if (!target) return false;
  await spawnKnownTarget({ ...target, args: [project] });
  return true;
}
