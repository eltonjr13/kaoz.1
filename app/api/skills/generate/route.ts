import { NextResponse } from "next/server";
import { queryConfiguredAgentCli } from "@/services/agent-llm/agent-llm.service";
import type { KaozSkill } from "@/services/skills/skill.types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ChatMessage = { role: "user" | "assistant"; content: string };
type GeneratedSkill = Pick<KaozSkill, "id" | "name" | "description" | "instructions"> & {
  references?: Array<{ name: string; content: string }>;
  scripts?: Array<{ name: string; content: string }>;
};

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

  const references: Array<{ name: string; content: string }> = [];
  if (Array.isArray(skill.references)) {
    for (const ref of skill.references) {
      if (ref && typeof ref === "object" && typeof ref.name === "string" && typeof ref.content === "string") {
        references.push({ name: ref.name, content: ref.content });
      }
    }
  }

  const scripts: Array<{ name: string; content: string }> = [];
  if (Array.isArray(skill.scripts)) {
    for (const scr of skill.scripts) {
      if (scr && typeof scr === "object" && typeof scr.name === "string" && typeof scr.content === "string") {
        scripts.push({ name: scr.name, content: scr.content });
      }
    }
  }

  return {
    id: skill.id as string,
    name: skill.name as string,
    description: skill.description as string,
    instructions: skill.instructions as string,
    references,
    scripts
  };
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

Quando houver contexto suficiente, crie a skill seguindo o padrão Higgsfield.ai:
- id em lowercase kebab-case, com até 64 caracteres;
- name humano e claro;
- description contendo o que faz E os pedidos/contextos que devem ativá-la;
- instructions em Markdown, no imperativo, contendo o fluxo e regras essenciais de orquestração do SKILL.md.
- references: Opcional. Se as instruções contiverem playbooks, limites de plataformas, templates específicos ou detalhes de configuração extensos, coloque esses detalhes em arquivos separados nesta lista. Cada item deve ter { "name": "nome_do_arquivo.md", "content": "conteúdo em markdown" }. No SKILL.md principal, use "See references/nome_do_arquivo.md" para ligar as referências.
- scripts: Opcional. Se a skill precisar de scripts permanentes auxiliares em JavaScript/TypeScript ou Python, coloque-os nesta lista. Cada item deve ter { "name": "nome_do_script.js", "content": "código" }

Responda SOMENTE JSON válido em um destes formatos:
{"message":"pergunta ou orientação ao usuário","ready":false,"skill":null}
ou
{"message":"resumo curto do que foi criado","ready":true,"skill":{"id":"...","name":"...","description":"...","instructions":"...","references":[{"name":"...","content":"..."}],"scripts":[{"name":"...","content":"..."}]}}

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
