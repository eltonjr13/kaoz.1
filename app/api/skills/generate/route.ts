import { NextResponse } from "next/server";
import { queryConfiguredAgentCli } from "@/services/agent-llm/agent-llm.service";
import { skillRegistry } from "@/services/skills/skill.registry";
import type { KaozSkill, SkillResourceFile, SkillToolDefinition } from "@/services/skills/skill.types";
import { toolRegistry } from "@/services/tools/tool.registry";
import type { ApprovalMode } from "@/services/orchestrator/orchestrator.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };
type GeneratedSkill = Omit<KaozSkill, "enabled">;

const allowedCapabilities = new Set(["web", "content", "system"]);
const allowedApprovalModes = new Set<ApprovalMode>(["never", "plan", "step"]);

function extractJson(text: string): Record<string, unknown> {
  const clean = text.replace(/^```json\s*|\s*```$/gi, "").trim();
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("O modelo não retornou uma resposta estruturada.");
  return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
}

function parseMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-12).flatMap((item): ChatMessage[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if ((candidate.role !== "user" && candidate.role !== "assistant") || typeof candidate.content !== "string") return [];
    return [{ role: candidate.role, content: candidate.content.slice(0, 8_000) }];
  });
}

function parseStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim())
    : [];
}

function parseResourceFiles(value: unknown): SkillResourceFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SkillResourceFile[] => {
    if (!item || typeof item !== "object") return [];
    const file = item as Record<string, unknown>;
    if (typeof file.name !== "string" || typeof file.content !== "string" || !file.name.trim() || !file.content.trim()) return [];
    return [{ name: file.name.trim(), content: file.content.trim() }];
  });
}

function parseTools(value: unknown): SkillToolDefinition[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SkillToolDefinition[] => {
    if (!item || typeof item !== "object") return [];
    const tool = item as Record<string, unknown>;
    if (typeof tool.id !== "string" || typeof tool.description !== "string" || typeof tool.script !== "string") return [];
    const inputSchema = tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
      ? tool.inputSchema as Record<string, unknown>
      : { type: "object" };
    return [{ id: tool.id.trim(), description: tool.description.trim(), script: tool.script.trim(), inputSchema }];
  });
}

function parseSkill(value: unknown): GeneratedSkill | null {
  if (!value || typeof value !== "object") return null;
  const skill = value as Record<string, unknown>;
  if (![skill.id, skill.name, skill.description, skill.instructions].every((field) => typeof field === "string" && field.trim())) return null;
  const id = (skill.id as string).trim();
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id) || id.length > 64) return null;

  const scripts = parseResourceFiles(skill.scripts);
  const scriptNames = new Set(scripts.map((script) => script.name));
  const tools = parseTools(skill.tools);
  for (const tool of tools) {
    const scriptName = tool.script.replace(/\\/g, "/").split("/").pop() || "";
    if (!tool.id.startsWith(`skill:${id}:`) || !scriptNames.has(scriptName)) return null;
  }

  const rawApprovalMode = typeof skill.approvalMode === "string" ? skill.approvalMode : "plan";
  const approvalMode: ApprovalMode = allowedApprovalModes.has(rawApprovalMode as ApprovalMode)
    ? rawApprovalMode as ApprovalMode
    : "plan";

  return {
    id,
    name: (skill.name as string).trim(),
    description: (skill.description as string).trim(),
    version: typeof skill.version === "string" && /^\d+\.\d+\.\d+$/.test(skill.version) ? skill.version : "1.0.0",
    instructions: (skill.instructions as string).trim(),
    preferredTools: parseStringArray(skill.preferredTools),
    requiredCapabilities: parseStringArray(skill.requiredCapabilities).filter((capability) => allowedCapabilities.has(capability)),
    approvalMode,
    tools,
    references: parseResourceFiles(skill.references),
    scripts,
  };
}

function builderContext(): string {
  const builder = skillRegistry.get("build-skills");
  if (!builder) throw new Error("A skill nativa build-skills não está instalada.");
  const references = (builder.references || [])
    .map((reference) => `\n\n[REFERÊNCIA: ${reference.name}]\n${reference.content}`)
    .join("");
  return `${builder.instructions}${references}`;
}

async function availableToolsContext(): Promise<string> {
  try {
    const tools = await toolRegistry.list();
    return JSON.stringify(tools.map((tool) => ({
      id: tool.id,
      description: tool.description,
      inputSchema: tool.inputSchema,
      effect: tool.effect,
      approvalMode: tool.approvalMode,
    }))).slice(0, 24_000);
  } catch (error) {
    console.warn("[BuildSkills] Não foi possível listar todas as ferramentas:", error);
    return "[]";
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { messages?: unknown };
    const messages = parseMessages(body.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ error: "Envie uma mensagem para o criador de skills." }, { status: 400 });
    }

    const transcript = messages.map((message) => `${message.role === "user" ? "USUÁRIO" : "ASSISTENTE"}: ${message.content}`).join("\n\n");
    const installedSkills = skillRegistry.getAll().map((skill) => ({ id: skill.id, name: skill.name, description: skill.description }));
    const availableTools = await availableToolsContext();
    const prompt = `Você está executando a skill Build Skills do MrChicken. Siga integralmente as instruções e referências abaixo.

[BUILD SKILLS]
${builderContext()}

[CONTEXTO REAL DO PROJETO]
Skills instaladas: ${JSON.stringify(installedSkills)}
Ferramentas disponíveis: ${availableTools}

[REGRAS DESTA CONVERSA]
- Converse em português do Brasil.
- Faça no máximo duas perguntas curtas por resposta e somente quando a resposta mudar a arquitetura.
- Se o pedido já estiver claro, produza imediatamente uma skill completa, com profundidade profissional comparável à referência fornecida pelo usuário.
- Não entregue esqueleto, lista de ideias ou instruções superficiais.
- Não invente ferramentas. Scripts próprios precisam ser entregues em scripts e ligados em tools.
- Todo conteúdo de SKILL.md e arquivos auxiliares deve vir integralmente no JSON, sem abreviações, reticências ou marcadores como "adicione aqui".
- Gere referências somente quando houver conteúdo especializado que justifique carregamento progressivo.
- Gere scripts somente quando adicionarem execução determinística real.

Responda SOMENTE JSON válido em um destes formatos:
{"message":"pergunta curta ou orientação ao usuário","ready":false,"skill":null}
ou
{"message":"resumo curto do pacote completo","ready":true,"skill":{"id":"lowercase-kebab-case","name":"Nome humano","description":"o que faz e quando ativar","version":"1.0.0","instructions":"Markdown integral do SKILL.md","preferredTools":["tool:id-existente"],"requiredCapabilities":["web|content|system"],"approvalMode":"never|plan|step","tools":[{"id":"skill:<id>:<acao>","description":"...","script":"scripts/arquivo.ts","inputSchema":{"type":"object","required":[],"properties":{}}}],"references":[{"name":"arquivo.md","content":"Markdown integral"}],"scripts":[{"name":"arquivo.ts","content":"código integral"}]}}

[CONVERSA]
${transcript}`;

    const output = await queryConfiguredAgentCli(prompt);
    if (!output) throw new Error("O provedor Browser não está disponível para este criador. Selecione um provedor CLI ou API em Agente LLM.");
    const parsed = extractJson(output);
    const ready = parsed.ready === true;
    const skill = ready ? parseSkill(parsed.skill) : null;
    if (ready && !skill) throw new Error("O modelo gerou um pacote inconsistente. Peça para revisar IDs, scripts e ferramentas do rascunho.");
    return NextResponse.json({
      message: typeof parsed.message === "string" ? parsed.message : "Continue descrevendo a skill.",
      ready: Boolean(skill),
      skill,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar o modelo." }, { status: 500 });
  }
}
