import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ToolHandler, ToolResult } from "../../tools/tool.types";
import type { ArtifactType } from "../orchestrator.types";
import { registerContentArtifact, registerExistingArtifact } from "../../artifacts/artifact.service.ts";

const execFileAsync = promisify(execFile);
const ARTIFACT_TYPES = new Set<ArtifactType>(["image", "video", "audio", "document", "markdown", "pdf", "json", "csv", "html", "text", "file"]);

function asArtifactType(value: unknown): ArtifactType | undefined {
  return typeof value === "string" && ARTIFACT_TYPES.has(value as ArtifactType) ? value as ArtifactType : undefined;
}

export async function normalizeSkillScriptResult(parsed: unknown): Promise<ToolResult> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { output: parsed };
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.artifacts)) return { output: parsed };

  const artifacts = await Promise.all(record.artifacts.map(async (candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Artefato ${index + 1} retornado pelo script é inválido.`);
    }
    const artifact = candidate as Record<string, unknown>;
    const name = typeof artifact.name === "string" && artifact.name.trim() ? artifact.name.trim() : `artifact-${index + 1}`;
    const type = asArtifactType(artifact.type);
    const mimeType = typeof artifact.mimeType === "string" ? artifact.mimeType : undefined;
    const metadata = artifact.metadata && typeof artifact.metadata === "object" && !Array.isArray(artifact.metadata)
      ? artifact.metadata as Record<string, unknown>
      : undefined;

    if (typeof artifact.path === "string" && artifact.path.trim()) {
      return registerExistingArtifact({ path: artifact.path.trim(), name, type, mimeType, metadata });
    }
    if (typeof artifact.content === "string") {
      return registerContentArtifact({ content: artifact.content, name, type, mimeType, metadata });
    }
    throw new Error(`Artefato ${name} não possui path ou content.`);
  }));

  return {
    output: Object.prototype.hasOwnProperty.call(record, "output") ? record.output : parsed,
    artifacts,
  };
}

/**
 * Cria um handler dinâmico para uma ferramenta que executa um script de uma skill.
 * @param scriptPath Caminho relativo (ex: "skills/meu-banco/scripts/query.js")
 */
export function createSkillScriptHandler(scriptPath: string): ToolHandler {
  return async (args) => {
    const absolutePath = path.join(process.cwd(), scriptPath);
    
    // Determinar o executável baseado na extensão
    const ext = path.extname(absolutePath).toLowerCase();
    let bin = "";
    
    if (ext === ".js" || ext === ".ts" || ext === ".mjs") {
        bin = "node";
        // Para TS no Next, tsx ou node --experimental-strip-types
        if (ext === ".ts") {
            bin = process.platform === "win32" ? "npx.cmd" : "npx";
        }
    } else if (ext === ".py") {
        bin = "python"; // Ou python3 dependendo do ambiente
    } else if (ext === ".sh") {
        bin = "bash";
    } else {
        throw new Error(`Extensão de script não suportada: ${ext}`);
    }

    // Como o script espera dados estruturados, podemos passar via variável de ambiente 
    // ou via stdin. Para simplificar, passamos como argumento em JSON stringified.
    // É responsabilidade do script fazer o parse desse argumento.
    const argsString = JSON.stringify(args);
    
    try {
        const cmdArgs = ext === ".ts" ? ["tsx", absolutePath, argsString] : [absolutePath, argsString];
        const { stdout, stderr } = await execFileAsync(bin, cmdArgs, {
            env: { ...process.env, KAOZ_SKILL_ARGS: argsString },
            timeout: 30000 // 30s timeout
        });
        
        if (stderr && stderr.trim().length > 0) {
            console.warn(`[Skill Script] stderr:`, stderr);
        }
        
        // Tentar parsear o stdout como JSON, ou retornar a string pura se não for JSON
        const outputStr = stdout.trim();
        let parsed: unknown;
        try {
            parsed = JSON.parse(outputStr);
        } catch {
            return { output: outputStr };
        }
        return await normalizeSkillScriptResult(parsed);
    } catch (error: any) {
        throw new Error(`Erro ao executar script da skill: ${error.message}\n${error.stderr || ''}`);
    }
  };
}
