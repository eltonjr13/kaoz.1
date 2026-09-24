import { mkdir, rename, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getAssistantWorkspaceDir, openAssistantProjectInCode } from "./assistant-launcher.ts";
import { AssistantInputError } from "./assistant-errors.ts";

export interface AssistantProject {
  id: string;
  title: string;
  idea: string;
  folderPath: string;
  briefPath: string;
  createdAt: string;
  openedInCode: boolean;
}

type ProjectInput = { title: unknown; idea: unknown; openInCode?: unknown };
type ProjectOptions = {
  workspaceDir?: string;
  openCode?: (folderPath: string) => Promise<boolean>;
};

function normalizedTitle(value: unknown): string {
  if (typeof value !== "string") throw new AssistantInputError("Título do projeto inválido.");
  const title = value.replace(/\s+/g, " ").trim();
  if (!title || title.length > 120) throw new AssistantInputError("O título deve ter entre 1 e 120 caracteres.");
  return title;
}

function normalizedIdea(value: unknown): string {
  if (typeof value !== "string") throw new AssistantInputError("Ideia do projeto inválida.");
  const idea = value.trim();
  if (!idea || idea.length > 20_000 || idea.includes("\0")) {
    throw new AssistantInputError("A ideia deve ter entre 1 e 20.000 caracteres, sem caracteres nulos.");
  }
  return idea;
}

function projectSlug(title: string): string {
  const core = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)
    .replace(/-$/g, "");
  return `ideia-${core || "projeto"}`;
}

async function reserveProjectFolder(workspaceDir: string, baseName: string): Promise<{ id: string; folderPath: string }> {
  await mkdir(workspaceDir, { recursive: true });
  for (let attempt = 1; attempt <= 1_000; attempt++) {
    const id = attempt === 1 ? baseName : `${baseName}-${attempt}`;
    const folderPath = path.join(workspaceDir, id);
    try {
      await mkdir(folderPath);
      return { id, folderPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new AssistantInputError("Há muitos projetos com o mesmo título. Escolha outro título.");
}

export async function createAssistantProject(
  input: ProjectInput,
  options: ProjectOptions = {},
): Promise<{ project: AssistantProject; message: string }> {
  const title = normalizedTitle(input.title);
  const idea = normalizedIdea(input.idea);
  if (input.openInCode !== undefined && typeof input.openInCode !== "boolean") {
    throw new AssistantInputError("Opção de abrir no VS Code inválida.");
  }
  const workspaceDir = options.workspaceDir ?? getAssistantWorkspaceDir();
  const openCode = options.openCode ?? openAssistantProjectInCode;
  const { id, folderPath } = await reserveProjectFolder(workspaceDir, projectSlug(title));
  const briefPath = path.join(folderPath, "README.md");
  const temporary = path.join(folderPath, ".README.md.tmp");
  const createdAt = new Date().toISOString();
  const brief = `# ${title}\n\nCriado em: ${createdAt}\n\n## Ideia original\n\n${idea}\n\n## Notas e próximos passos\n\n`;
  try {
    await writeFile(temporary, brief, { encoding: "utf8", flag: "wx" });
    await rename(temporary, briefPath);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    await rmdir(folderPath).catch(() => undefined);
    throw error;
  }

  let openedInCode = false;
  let message = "Projeto criado com briefing editável na pasta de trabalho da Kaoz.1.";
  if (input.openInCode) {
    try {
      openedInCode = await openCode(folderPath);
      message = openedInCode
        ? "Projeto criado; solicitei a abertura no VS Code."
        : "Projeto criado; o VS Code não foi encontrado neste computador.";
    } catch {
      message = "Projeto criado; não foi possível abrir o VS Code.";
    }
  }
  return { project: { id, title, idea, folderPath, briefPath, createdAt, openedInCode }, message };
}
