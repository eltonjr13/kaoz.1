export type WarRoomAgentRole =
  | "campaign-director"
  | "audience-strategist"
  | "brand-governance"
  | "copywriter"
  | "visual-director"
  | "creative-reviewer";

export interface WarRoomBrief {
  readonly schemaVersion: "1.0";
  readonly topic: string;
  readonly objective: string;
  readonly targetAudience?: string;
  readonly offer?: string;
  readonly channels: readonly string[];
  readonly constraints: readonly string[];
}

export interface WarRoomRubricCriterion {
  readonly id: "strategy" | "audience" | "brand" | "copy" | "visual";
  readonly label: string;
  readonly score: number;
  readonly maxScore: 20;
  readonly passed: boolean;
  readonly feedback: string;
}

export interface WarRoomReviewDecision {
  readonly status: "approved" | "needs_revision";
  readonly score: number;
  readonly minimumScore: 80;
  readonly criteria: readonly WarRoomRubricCriterion[];
  readonly blockingIssues: readonly string[];
  readonly summary: string;
}

export interface WarRoomAgentContribution {
  readonly thought: string;
  readonly content: string;
  readonly artifactName: string;
  readonly artifactContent: string;
  readonly review?: WarRoomReviewDecision;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} deve ser um texto não vazio.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new Error(`${field} excede o limite de ${maxLength} caracteres.`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, field, maxLength);
}

function textList(value: unknown, field: string, maxItems = 20): readonly string[] {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > maxItems) {
    throw new Error(`${field} deve ser uma lista com no máximo ${maxItems} itens.`);
  }
  return Object.freeze(value.map((item, index) => requiredText(item, `${field}[${index}]`, 500)));
}

export function parseWarRoomBrief(value: unknown): WarRoomBrief {
  if (typeof value === "string") {
    const topic = requiredText(value, "brief.topic", 2_000);
    return Object.freeze({
      schemaVersion: "1.0",
      topic,
      objective: topic,
      channels: Object.freeze([]),
      constraints: Object.freeze([]),
    });
  }
  if (!isRecord(value)) throw new Error("Briefing da Sala de Guerra inválido.");
  const topic = requiredText(value.topic, "brief.topic", 2_000);
  return Object.freeze({
    schemaVersion: "1.0",
    topic,
    objective: optionalText(value.objective, "brief.objective", 4_000) || topic,
    targetAudience: optionalText(value.targetAudience, "brief.targetAudience", 2_000),
    offer: optionalText(value.offer, "brief.offer", 2_000),
    channels: textList(value.channels, "brief.channels"),
    constraints: textList(value.constraints, "brief.constraints"),
  });
}

const RUBRIC_META: ReadonlyArray<Pick<WarRoomRubricCriterion, "id" | "label">> = [
  { id: "strategy", label: "Estratégia e objetivos mensuráveis" },
  { id: "audience", label: "Público, dores e objeções" },
  { id: "brand", label: "Tom de voz e guardrails" },
  { id: "copy", label: "Roteiro estruturado em cenas" },
  { id: "visual", label: "Prompts visuais estruturados por cena" },
];

function parseCriterion(value: unknown, expected: (typeof RUBRIC_META)[number]): WarRoomRubricCriterion {
  if (!isRecord(value) || value.id !== expected.id) {
    throw new Error(`Critério de revisão ausente ou fora de ordem: ${expected.id}.`);
  }
  const score = Number(value.score);
  if (!Number.isFinite(score) || score < 0 || score > 20) {
    throw new Error(`Pontuação inválida para o critério ${expected.id}.`);
  }
  return Object.freeze({
    id: expected.id,
    label: expected.label,
    score,
    maxScore: 20,
    passed: score >= 16,
    feedback: requiredText(value.feedback, `review.criteria.${expected.id}.feedback`, 1_000),
  });
}

export function parseWarRoomReviewDecision(value: unknown): WarRoomReviewDecision {
  if (!isRecord(value) || !Array.isArray(value.criteria)) {
    throw new Error("Decisão de revisão da Sala de Guerra inválida.");
  }
  const criteriaInput = value.criteria;
  const criteria = Object.freeze(RUBRIC_META.map((meta, index) => parseCriterion(criteriaInput[index], meta)));
  const score = criteria.reduce((total, criterion) => total + criterion.score, 0);
  const blockingIssues = textList(value.blockingIssues, "review.blockingIssues");
  const approved = score >= 80 && blockingIssues.length === 0 && criteria.every((criterion) => criterion.passed);
  return Object.freeze({
    status: approved ? "approved" : "needs_revision",
    score,
    minimumScore: 80,
    criteria,
    blockingIssues,
    summary: requiredText(value.summary, "review.summary", 2_000),
  });
}

export function parseWarRoomAgentContribution(value: unknown, role: WarRoomAgentRole): WarRoomAgentContribution {
  if (!isRecord(value)) throw new Error("Contribuição do agente deve ser um objeto JSON.");
  const contribution: WarRoomAgentContribution = {
    thought: requiredText(value.thought, "contribution.thought", 4_000),
    content: requiredText(value.content, "contribution.content", 30_000),
    artifactName: requiredText(value.artifactName, "contribution.artifactName", 180),
    artifactContent: requiredText(value.artifactContent, "contribution.artifactContent", 100_000),
    review: role === "creative-reviewer" ? parseWarRoomReviewDecision(value.review) : undefined,
  };
  return Object.freeze(contribution);
}

export function buildEvidenceBasedReview(
  artifacts: ReadonlyArray<{ readonly role: WarRoomAgentRole; readonly content: string }>,
): WarRoomReviewDecision {
  const byRole = new Map(artifacts.map((artifact) => [artifact.role, artifact.content]));
  const checks: Array<{ meta: (typeof RUBRIC_META)[number]; role: WarRoomAgentRole; pattern: RegExp; feedback: string }> = [
    { meta: RUBRIC_META[0], role: "campaign-director", pattern: /(?:objetivo|kpi|meta|convers[aã]o)/i, feedback: "Estratégia deve declarar objetivo e indicadores." },
    { meta: RUBRIC_META[1], role: "audience-strategist", pattern: /(?:persona|p[uú]blico|dor|obje[cç][aã]o)/i, feedback: "Audiência deve incluir dores ou objeções verificáveis." },
    { meta: RUBRIC_META[2], role: "brand-governance", pattern: /(?:tom de voz|guardrail|proibido|evitar)/i, feedback: "Marca deve definir tom e limites de comunicação." },
    { meta: RUBRIC_META[3], role: "copywriter", pattern: /#{1,4}\s*(?:Cena|Scene)\s*1/i, feedback: "Copy deve estar estruturada em cenas numeradas." },
    { meta: RUBRIC_META[4], role: "visual-director", pattern: /#{1,4}\s*(?:Prompt|Cena)\s*1/i, feedback: "Direção visual deve trazer prompts numerados por cena." },
  ];
  const criteria = Object.freeze(checks.map(({ meta, role, pattern, feedback }) => {
    const content = byRole.get(role) || "";
    const passed = content.length >= 120 && pattern.test(content);
    return Object.freeze({
      id: meta.id,
      label: meta.label,
      score: passed ? 20 : content ? 10 : 0,
      maxScore: 20 as const,
      passed,
      feedback: passed ? "Critério atendido com evidência estrutural." : feedback,
    });
  }));
  const blockingIssues = Object.freeze(criteria.filter((criterion) => !criterion.passed).map((criterion) => criterion.feedback));
  const score = criteria.reduce((total, criterion) => total + criterion.score, 0);
  const approved = score >= 80 && blockingIssues.length === 0;
  return Object.freeze({
    status: approved ? "approved" : "needs_revision",
    score,
    minimumScore: 80,
    criteria,
    blockingIssues,
    summary: approved
      ? "A campanha atingiu a rubrica mínima e está pronta para aprovação humana antes da produção."
      : "A campanha precisa de revisão antes de seguir para produção.",
  });
}
