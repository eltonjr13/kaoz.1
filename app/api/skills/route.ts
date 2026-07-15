import { NextRequest, NextResponse } from "next/server";
import { skillRegistry } from "../../../services/skills/skill.registry";
import type { ApprovalMode } from "../../../services/orchestrator/orchestrator.types";
import type { SkillResourceFile, SkillToolDefinition } from "../../../services/skills/skill.types";
import { normalizeScriptPolicy } from "../../../services/skills/skill.policy";
import { skillMetricsStore } from "../../../services/skills/skill.metrics";

function parseResourceFiles(value: unknown): SkillResourceFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): SkillResourceFile[] => {
    if (!item || typeof item !== "object") return [];
    const file = item as Record<string, unknown>;
    if (typeof file.name !== "string" || typeof file.content !== "string") return [];
    return [{ name: file.name, content: file.content }];
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
    const effect = ["read", "write", "external", "destructive"].includes(String(tool.effect))
      ? tool.effect as SkillToolDefinition["effect"] : "write";
    const approvalMode = ["never", "plan", "step"].includes(String(tool.approvalMode))
      ? tool.approvalMode as SkillToolDefinition["approvalMode"] : "plan";
    const policy = normalizeScriptPolicy(tool.policy && typeof tool.policy === "object" ? tool.policy : undefined);
    return [{ id: tool.id, description: tool.description, script: tool.script, inputSchema, effect, approvalMode, policy }];
  });
}

export async function GET(req: NextRequest) {
  try {
    const params = new URL(req.url).searchParams;
    const full = params.get("full") === "true";
    const revisionsFor = params.get("revisions");
    if (revisionsFor) return NextResponse.json({ revisions: skillRegistry.listRevisions(revisionsFor) });
    const metricsFor = params.get("metrics");
    if (metricsFor) return NextResponse.json({ metrics: await skillMetricsStore.list(metricsFor, Number(params.get("limit") || 100)) });
    const skills = full ? skillRegistry.getAll() : skillRegistry.list();
    return NextResponse.json({
      skills: full ? skills : skills.map(({ id, name, description }) => ({ id, name, description })),
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao carregar skills." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.id || !body.name || !body.description || !body.instructions) {
      return NextResponse.json({ error: "ID, nome, descrição e instruções são obrigatórios." }, { status: 400 });
    }

    const approvalMode: ApprovalMode = ["never", "plan", "step"].includes(body.approvalMode)
      ? body.approvalMode
      : "plan";
    const existingSkill = skillRegistry.getAll().find((skill) => skill.id === String(body.id).trim());
    const skillToSave = {
      id: String(body.id).trim(),
      name: String(body.name).trim(),
      description: String(body.description).trim(),
      version: typeof body.version === "string" ? body.version : "1.0.0",
      instructions: String(body.instructions).trim(),
      preferredTools: Array.isArray(body.preferredTools) ? body.preferredTools.filter((item: unknown): item is string => typeof item === "string") : [],
      requiredCapabilities: Array.isArray(body.requiredCapabilities) ? body.requiredCapabilities.filter((item: unknown): item is string => typeof item === "string") : [],
      approvalMode,
      enabled: body.enabled !== false,
      tools: parseTools(body.tools),
      references: body.references === undefined ? existingSkill?.references || [] : parseResourceFiles(body.references),
      scripts: body.scripts === undefined ? existingSkill?.scripts || [] : parseResourceFiles(body.scripts),
    };

    skillRegistry.save(skillToSave);
    return NextResponse.json({ success: true, skill: skillRegistry.get(skillToSave.id, true) || skillToSave, revisions: skillRegistry.listRevisions(skillToSave.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar skill." }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { id?: unknown; revisionId?: unknown };
    if (typeof body.id !== "string" || typeof body.revisionId !== "string") {
      return NextResponse.json({ error: "ID da skill e revisão são obrigatórios." }, { status: 400 });
    }
    const skill = skillRegistry.rollback(body.id.trim(), body.revisionId.trim());
    return NextResponse.json({ success: true, skill, revisions: skillRegistry.listRevisions(skill.id) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao restaurar revisão." }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "O ID da skill é obrigatório." }, { status: 400 });
    }
    skillRegistry.delete(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao excluir skill." }, { status: 400 });
  }
}
