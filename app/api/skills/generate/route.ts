import { NextResponse } from "next/server";
import { queryConfiguredAgentCli } from "@/services/agent-llm/agent-llm.service";
import type { KaozSkill } from "@/services/skills/skill.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };
type GeneratedSkill = Pick<KaozSkill, "id" | "name" | "description" | "instructions">;

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
    return [{ role: candidate.role, content: candidate.content.slice(0, 6000) }];
  });
}

function parseSkill(value: unknown): GeneratedSkill | null {
  if (!value || typeof value !== "object") return null;
  const skill = value as Record<string, unknown>;
  if (![skill.id, skill.name, skill.description, skill.instructions].every((field) => typeof field === "string" && field.trim())) return null;
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(skill.id as string) || (skill.id as string).length > 64) return null;
  return { id: skill.id as string, name: skill.name as string, description: skill.description as string, instructions: skill.instructions as string };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { messages?: unknown };
    const messages = parseMessages(body.messages);
    if (!messages.length || messages[messages.length - 1].role !== "user") {
      return NextResponse.json({ error: "Envie uma mensagem para o criador de skills." }, { status: 400 });
    }

    const transcript = messages.map((message) => `${message.role === "user" ? "USUÁRIO" : "ASSISTENTE"}: ${message.content}`).join("\n\n");
    const prompt = `Você é um arquiteto de Skills do MrChicken. Converse em português do Brasil para entender a capacidade que o usuário quer criar.

Faça no máximo duas perguntas curtas por resposta e só pergunte o que muda materialmente a skill. Se o pedido já estiver claro, produza o rascunho imediatamente. Seja conciso: Skills compartilham contexto e não devem ensinar conhecimentos óbvios ao modelo.

Quando houver contexto suficiente, crie:
- id em lowercase kebab-case, com até 64 caracteres;
- name humano e claro;
- description contendo o que faz E os pedidos/contextos que devem ativá-la;
- instructions em Markdown, no imperativo, com fluxo, regras, validação e uso de ferramentas sem inventar ferramentas inexistentes.

Responda SOMENTE JSON válido em um destes formatos:
{"message":"pergunta ou orientação ao usuário","ready":false,"skill":null}
ou
{"message":"resumo curto do que foi criado","ready":true,"skill":{"id":"...","name":"...","description":"...","instructions":"..."}}

CONVERSA:
${transcript}`;

    const output = await queryConfiguredAgentCli(prompt);
    if (!output) throw new Error("O provedor Browser não está disponível para este criador. Selecione um provedor CLI ou API em Agente LLM.");
    const parsed = extractJson(output);
    const ready = parsed.ready === true;
    const skill = ready ? parseSkill(parsed.skill) : null;
    if (ready && !skill) throw new Error("O modelo gerou uma skill inválida. Tente pedir para ele revisar o rascunho.");
    return NextResponse.json({ message: typeof parsed.message === "string" ? parsed.message : "Continue descrevendo a skill.", ready: Boolean(skill), skill });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Falha ao consultar o modelo." }, { status: 500 });
  }
}
