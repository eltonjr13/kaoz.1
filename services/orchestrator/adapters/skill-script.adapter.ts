import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { ToolHandler } from "../../tools/tool.types";

const execFileAsync = promisify(execFile);

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
            bin = "npx";
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
        try {
            return { output: JSON.parse(outputStr) };
        } catch (e) {
            return { output: outputStr };
        }
    } catch (error: any) {
        throw new Error(`Erro ao executar script da skill: ${error.message}\n${error.stderr || ''}`);
    }
  };
}
