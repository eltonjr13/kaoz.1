import { NextRequest, NextResponse } from "next/server";
import { skillRegistry } from "../../../services/skills/skill.registry";
import type { ApprovalMode } from "../../../services/orchestrator/orchestrator.types";

export async function GET(req: NextRequest) {
  try {
    const full = new URL(req.url).searchParams.get("full") === "true";
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

    const approvalMode: ApprovalMode = ["never", "plan", "always"].includes(body.approvalMode)
      ? body.approvalMode
      : "plan";
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
      tools: Array.isArray(body.tools) ? body.tools : [],
    };

    skillRegistry.save(skillToSave);
    return NextResponse.json({ success: true, skill: skillToSave });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao salvar skill." }, { status: 400 });
  }
}
