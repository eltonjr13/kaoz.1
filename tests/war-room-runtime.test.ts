import assert from "node:assert/strict";
import test from "node:test";
import {
  createWarRoomSession,
  isWarRoomCommand,
  extractWarRoomTopic,
  buildSyntheticAgentTurn,
  formatWarRoomEvent,
  WAR_ROOM_AGENT_PROFILES,
  type WarRoomSession,
} from "../services/agents/index.ts";

test("reconhece comandos de sala de guerra e extrai tópicos", () => {
  assert.equal(isWarRoomCommand("/warroom Lançamento do novo produto"), true);
  assert.equal(isWarRoomCommand("/war-room Campanha de Black Friday"), true);
  assert.equal(isWarRoomCommand("/brainstorm Estratégia de Reels"), true);
  assert.equal(isWarRoomCommand("/saladeguerra Automação de Conteúdo"), true);
  assert.equal(isWarRoomCommand("Como fazer um bolo de chocolate?"), false);

  assert.equal(
    extractWarRoomTopic("/warroom Lançamento do novo produto"),
    "Lançamento do novo produto"
  );
  assert.equal(
    extractWarRoomTopic("/brainstorm   Estratégia de Reels  "),
    "Estratégia de Reels"
  );
});

test("inicializa sessão de Sala de Guerra com os 6 agentes especialistas", () => {
  const session = createWarRoomSession("Campanha SaaS Fitness");
  assert.ok(session.id.startsWith("war-room-"));
  assert.equal(session.topic, "Campanha SaaS Fitness");
  assert.equal(session.status, "initializing");
  assert.equal(session.participants.length, 6);
  assert.equal(session.currentStageIndex, 0);
  assert.equal(session.messages.length, 0);
  assert.equal(session.artifacts.length, 0);

  const roles = session.participants.map((p) => p.role);
  assert.deepEqual(roles, [
    "campaign-director",
    "audience-strategist",
    "brand-governance",
    "copywriter",
    "visual-director",
    "creative-reviewer",
  ]);
});

test("executa ciclo completo de rodadas entre os agentes gerando artefatos e consenso", () => {
  let session: WarRoomSession = createWarRoomSession("Curso de Inteligência Artificial");
  const turnResults = [];

  for (let i = 0; i < WAR_ROOM_AGENT_PROFILES.length; i++) {
    const result = buildSyntheticAgentTurn(session, i, session.topic);
    turnResults.push(result);
    session = result.updatedSession;
  }

  assert.equal(session.status, "completed");
  assert.equal(session.currentStageIndex, 6);
  assert.equal(session.messages.length, 6);
  assert.equal(session.artifacts.length, 6);
  assert.ok(session.completedAt);

  // Valida a contribuição de cada especialista
  assert.equal(session.messages[0].agentRole, "campaign-director");
  assert.equal(session.messages[0].artifactsProduced?.[0].name, "01_Briefing_Estrategico.md");

  assert.equal(session.messages[1].agentRole, "audience-strategist");
  assert.equal(session.messages[1].artifactsProduced?.[0].name, "02_Mapeamento_Audiencia.md");

  assert.equal(session.messages[2].agentRole, "brand-governance");
  assert.equal(session.messages[2].artifactsProduced?.[0].name, "03_Diretrizes_Marca.md");

  assert.equal(session.messages[3].agentRole, "copywriter");
  assert.equal(session.messages[3].artifactsProduced?.[0].name, "04_Copys_e_Roteiros.md");

  assert.equal(session.messages[4].agentRole, "visual-director");
  assert.equal(session.messages[4].artifactsProduced?.[0].name, "05_Direcao_Visual_e_Prompts.md");

  assert.equal(session.messages[5].agentRole, "creative-reviewer");
  assert.equal(session.messages[5].status, "consensus");
  assert.equal(session.messages[5].artifactsProduced?.[0].name, "06_Sintese_Executiva_Aprovada.md");
});

test("formata eventos SSE da Sala de Guerra com protocolo padronizado", () => {
  const rawEvent = formatWarRoomEvent({
    type: "war_room_turn",
    sessionId: "war-123",
    payload: { agent: "Alex Vance", stage: 1 },
    timestamp: "2026-08-17T12:00:00.000Z",
  });

  assert.match(rawEvent, /^event: war_room_turn\n/);
  assert.match(rawEvent, /data: \{"agent":"Alex Vance","stage":1\}\n\n$/);
});

test("executa buildAgentTurn com sintetizador LLM real", async () => {
  const session = createWarRoomSession("Fone Bluetooth Gamer");
  const mockLlm = async (prompt: string) => {
    return JSON.stringify({
      thought: "Análise estratégica aprofundada para nicho gamer de alta performance.",
      content: "### Estratégia de Alto Impacto Gamer\nFoco em latência zero e cancelamento ativo.",
      artifactName: "01_Estrategia_Gamer.md",
      artifactContent: "# Estratégia Fone Gamer\n\n- Posicionamento: Latência Zero\n- KPI: CTR > 5%",
    });
  };

  const { buildAgentTurn } = await import("../services/agents/index.ts");
  const result = await buildAgentTurn(session, 0, "Fone Bluetooth Gamer", mockLlm);

  assert.equal(result.message.agentName, "Alex Vance");
  assert.match(result.message.thought || "", /Análise estratégica aprofundada/);
  assert.match(result.message.content, /Estratégia de Alto Impacto Gamer/);
  assert.equal(result.artifactReference?.name, "01_Estrategia_Gamer.md");
  assert.match(result.artifactReference?.content || "", /Posicionamento: Latência Zero/);
});
