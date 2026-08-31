import test from "node:test";
import assert from "node:assert/strict";
import type { ChatMemoryRecord } from "../lib/cognitive-memory/types/memory.ts";
import {
  calculateConfidenceLevel,
  toPersonalModelItem,
  buildPersonalModelSnapshot,
  resolveMemoryEvidence,
  formatPersonalModelContext,
} from "../lib/model-p/personal-model.service.ts";
import { compileAgentPersonality } from "../lib/agent-personality/compiler.ts";

function createMockRecord(partial: Partial<ChatMemoryRecord>): ChatMemoryRecord {
  const base: ChatMemoryRecord = {
    id: "mem-default",
    userId: "local-user",
    kind: "user_fact",
    scope: "user",
    content: "Fato de teste",
    confidenceScore: 0.85,
    occurrences: 1,
    evidence: [],
    evidenceRefs: [],
    source: "flow_chat",
    status: "active",
    explicit: false,
    canonicalKey: "canonical-key-default",
    tags: [],
    createdAt: "2026-08-30T10:00:00.000Z",
    updatedAt: "2026-08-30T10:00:00.000Z",
    lastReinforcedAt: "2026-08-30T10:00:00.000Z",
  };
  return Object.assign(base, partial);
}

test("Model P calcula os níveis de confiança corretamente (high, medium, low)", () => {
  assert.equal(calculateConfidenceLevel(0.95), "high");
  assert.equal(calculateConfidenceLevel(0.8), "high");
  assert.equal(calculateConfidenceLevel(0.79), "medium");
  assert.equal(calculateConfidenceLevel(0.5), "medium");
  assert.equal(calculateConfidenceLevel(0.49), "low");
  assert.equal(calculateConfidenceLevel(0.1), "low");
});

test("Model P categoriza memórias cognitivas existentes nas 4 dimensões visuais", () => {
  const records: ChatMemoryRecord[] = [
    createMockRecord({
      id: "fact-1",
      kind: "user_fact",
      content: "O usuário é desenvolvedor Fullstack",
      confidenceScore: 0.9,
      updatedAt: "2026-08-30T12:00:00.000Z",
    }),
    createMockRecord({
      id: "pref-1",
      kind: "user_preference",
      content: "Prefere código limpo com TypeScript e Tailwind",
      confidenceScore: 0.85,
      updatedAt: "2026-08-30T13:00:00.000Z",
    }),
    createMockRecord({
      id: "pref-2",
      kind: "creative_preference",
      content: "Gosta de designs escuros e minimalistas",
      confidenceScore: 0.75,
      updatedAt: "2026-08-30T14:00:00.000Z",
    }),
    createMockRecord({
      id: "work-1",
      kind: "workflow_rule",
      content: "Sempre rodar os testes antes de dar o deploy",
      confidenceScore: 0.95,
      updatedAt: "2026-08-30T15:00:00.000Z",
    }),
    createMockRecord({
      id: "work-2",
      kind: "project_fact",
      content: "O projeto principal atual é Kaoz.1",
      confidenceScore: 0.88,
      updatedAt: "2026-08-30T16:00:00.000Z",
    }),
    createMockRecord({
      id: "sig-1",
      kind: "correction",
      content: "Não usar frameworks legados de estilos",
      confidenceScore: 0.6,
      updatedAt: "2026-08-30T17:00:00.000Z",
    }),
  ];

  const snapshot = buildPersonalModelSnapshot(records);

  // Assert counts & metrics
  assert.equal(snapshot.summary.totalMemories, 6);
  assert.equal(snapshot.summary.factsCount, 1);
  assert.equal(snapshot.summary.preferencesCount, 2);
  assert.equal(snapshot.summary.workRulesCount, 2);
  assert.equal(snapshot.summary.correctionsCount, 1);
  assert.equal(snapshot.summary.lastUpdatedAt, "2026-08-30T17:00:00.000Z");

  // Assert category members
  assert.equal(snapshot.facts[0].id, "fact-1");
  assert.equal(snapshot.facts[0].confidenceLevel, "high");

  assert.equal(snapshot.preferences.length, 2);
  assert.ok(snapshot.preferences.some((p) => p.id === "pref-1"));
  assert.ok(snapshot.preferences.some((p) => p.id === "pref-2"));

  assert.equal(snapshot.workStyles.length, 2);
  assert.ok(snapshot.workStyles.some((w) => w.id === "work-1"));
  assert.ok(snapshot.workStyles.some((w) => w.id === "work-2"));

  assert.equal(snapshot.behavioralSignals.length, 1);
  assert.equal(snapshot.behavioralSignals[0].id, "sig-1");
  assert.equal(snapshot.behavioralSignals[0].confidenceLevel, "medium");
});

test("Model P ignora memórias inativas ou arquivadas", () => {
  const records: ChatMemoryRecord[] = [
    createMockRecord({ id: "active-1", kind: "user_fact", status: "active" }),
    createMockRecord({ id: "rejected-1", kind: "user_fact", status: "rejected" }),
    createMockRecord({ id: "superseded-1", kind: "user_preference", status: "superseded" }),
  ];

  const snapshot = buildPersonalModelSnapshot(records);
  assert.equal(snapshot.summary.totalMemories, 1);
  assert.equal(snapshot.facts.length, 1);
  assert.equal(snapshot.facts[0].id, "active-1");
  assert.equal(snapshot.preferences.length, 0);
});

test("Model P não apresenta memórias pendentes de revisão como fatos ativos", () => {
  const records: ChatMemoryRecord[] = [
    createMockRecord({ id: "active-1", status: "active" }),
    createMockRecord({ id: "pending-1", status: "pending_review" }),
  ];

  const snapshot = buildPersonalModelSnapshot(records);
  assert.deepEqual(snapshot.facts.map((item) => item.id), ["active-1"]);
});

test("Model P não inventa dados quando não existem memórias (empty states íntegros)", () => {
  const snapshot = buildPersonalModelSnapshot([]);
  assert.equal(snapshot.summary.totalMemories, 0);
  assert.equal(snapshot.summary.factsCount, 0);
  assert.equal(snapshot.summary.preferencesCount, 0);
  assert.equal(snapshot.summary.workRulesCount, 0);
  assert.equal(snapshot.summary.correctionsCount, 0);
  assert.equal(snapshot.summary.averageConfidence, 0);
  assert.equal(snapshot.summary.lastUpdatedAt, null);
  assert.deepEqual(snapshot.facts, []);
  assert.deepEqual(snapshot.preferences, []);
  assert.deepEqual(snapshot.workStyles, []);
  assert.deepEqual(snapshot.behavioralSignals, []);
  assert.deepEqual(snapshot.recentMemories, []);
});

test("Model P preserva e resolve evidências textuais e referências a mensagens", () => {
  const record = createMockRecord({
    id: "mem-with-evidence",
    kind: "user_preference",
    content: "Prefere café sem açúcar",
    confidenceScore: 0.92,
    evidence: ["Usuário disse: Eu nunca tomo café com açúcar"],
    evidenceRefs: [
      { conversationId: "conv-123", messageId: "msg-456" },
    ],
  });

  const detail = resolveMemoryEvidence(record);
  assert.equal(detail.memoryId, "mem-with-evidence");
  assert.equal(detail.confidenceLevel, "high");
  assert.equal(detail.evidenceTexts.length, 1);
  assert.equal(detail.evidenceTexts[0], "Usuário disse: Eu nunca tomo café com açúcar");
  // Se as mensagens não estiverem no sqlite mockado, o array é seguro e vazio sem dar crash
  assert.ok(Array.isArray(detail.referencedMessages));
});

test("Model P gera contexto de prompt conciso e determinístico", () => {
  const records: ChatMemoryRecord[] = [
    createMockRecord({ kind: "user_fact", content: "Nome é Elton" }),
    createMockRecord({ kind: "user_preference", content: "Respostas concisas e diretas" }),
    createMockRecord({ kind: "workflow_rule", content: "Usar TypeScript e Node 24" }),
    createMockRecord({ kind: "correction", content: "Evitar jargões corporativos" }),
  ];

  const snapshot = buildPersonalModelSnapshot(records);
  const context = formatPersonalModelContext(snapshot, 500);

  assert.ok(context.includes("[MODELO DO USUARIO (MODEL P)]"));
  assert.ok(context.includes("Nome é Elton"));
  assert.ok(context.includes("Respostas concisas e diretas"));
  assert.ok(context.includes("Usar TypeScript e Node 24"));
  assert.ok(context.includes("Evitar jargões corporativos"));
});

test("Model P permanece desacoplado do Agent Personality (schemas independentes)", () => {
  const userModelRecords: ChatMemoryRecord[] = [
    createMockRecord({
      kind: "user_preference",
      content: "O usuário prefere arquiteturas limpas e sem dependências pesadas",
      confidenceScore: 0.9,
    }),
  ];

  const snapshot = buildPersonalModelSnapshot(userModelRecords);
  assert.equal(snapshot.preferences[0].content, "O usuário prefere arquiteturas limpas e sem dependências pesadas");

  // O compilador de personalidade do agente continua gerando seu prompt de forma isolada
  const personalityPrompt = compileAgentPersonality({
    profile: {
      id: "kaoz-default",
      version: 1,
      name: "Kaoz.1",
      identity: {
        role: "Agente Inteligente",
        mission: "Ajudar na produção",
        principles: ["Objetividade", "Precisão"],
      },
      communication: {
        tone: "direct",
        verbosity: 0.2,
        humor: 0.1,
        warmth: 0.4,
        technicalDepth: 0.8,
      },
      behavior: {
        initiative: 0.7,
        curiosity: 0.5,
        creativity: 0.5,
        willingnessToDisagree: 0.6,
        askBeforeRiskyActions: true,
      },
      adaptation: {
        enabled: true,
        allowedMemoryKinds: ["creative_preference", "correction"],
        maximumDrift: 0.3,
      },
      boundaries: ["Não inventar dados"],
    },
    relationship: {
      version: 1,
      userId: "user-1",
      turnCount: 5,
      familiarity: 0.6,
      rapport: 0.5,
      playfulness: 0.2,
      importantMoments: [],
      lastInteractionAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
    session: {
      sessionId: "session-1",
      mode: "focused",
      energy: 0.5,
      warmth: 0.5,
      seriousness: 0.7,
      playfulness: 0.2,
      updatedAt: "2026-08-30T10:00:00Z",
    },
    activeMemories: userModelRecords,
  });

  // O prompt de personalidade trata de [IDENTIDADE CENTRAL DO PERSONAGEM], e não do Model P
  assert.ok(personalityPrompt.includes("[IDENTIDADE CENTRAL DO PERSONAGEM]"));
  assert.ok(personalityPrompt.includes("Voce e Kaoz.1"));
});
