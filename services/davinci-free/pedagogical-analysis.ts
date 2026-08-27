import {
  INTELLIGENT_PEDAGOGICAL_ANALYSIS_VERSION,
  type IntelligentPedagogicalAnalysis,
  type IntelligentPedagogicalItem,
  type IntelligentPedagogicalItemKind,
  type TimedTranscriptSegment,
} from "./intelligent-edit.types.ts";

const DEFAULT_CHUNK_CHARACTERS = 8_000;
const PEDAGOGICAL_ITEM_KINDS = new Set<IntelligentPedagogicalItemKind>([
  "objective",
  "prerequisite",
  "promise",
  "chapter",
  "concept",
  "definition",
  "process-step",
  "example",
  "demonstration",
  "warning",
  "common-error",
  "exercise",
  "action",
  "summary",
  "previous-link",
  "next-link",
]);

export type PedagogicalTranscriptChunk = {
  index: number;
  start: number;
  end: number;
  characters: number;
  segments: TimedTranscriptSegment[];
};

type PedagogicalAgentQuery = (prompt: string) => Promise<string | null>;

type AnalyzePedagogicalTranscriptInput = {
  segments: TimedTranscriptSegment[];
  courseName?: string;
  moduleName: string;
  useAgent: boolean;
  queryAgent?: PedagogicalAgentQuery;
  maxChunkCharacters?: number;
};

function cleanText(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maximum) : "";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalized(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function extractJsonObject(value: string) {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced || value.slice(value.indexOf("{"), value.lastIndexOf("}") + 1);
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function chunkText(chunk: PedagogicalTranscriptChunk) {
  return chunk.segments
    .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
    .join("\n");
}

export function buildPedagogicalTranscriptChunks(
  segments: TimedTranscriptSegment[],
  maxCharacters = DEFAULT_CHUNK_CHARACTERS,
) {
  const limit = Math.max(1_000, maxCharacters);
  const groups: TimedTranscriptSegment[][] = [];
  let current: TimedTranscriptSegment[] = [];
  let characters = 0;
  for (const segment of segments) {
    const serializedLength = chunkText({
      index: 0,
      start: segment.start,
      end: segment.end,
      characters: 0,
      segments: [segment],
    }).length;
    if (current.length && characters + serializedLength > limit) {
      groups.push(current);
      current = [];
      characters = 0;
    }
    current.push(segment);
    characters += serializedLength;
  }
  if (current.length) groups.push(current);
  return groups.map((group, index): PedagogicalTranscriptChunk => ({
    index,
    start: group[0].start,
    end: group[group.length - 1].end,
    characters: group.reduce((sum, segment) => sum + segment.text.length, 0),
    segments: group,
  }));
}

function evidenceFor(chunk: PedagogicalTranscriptChunk, start: number, end: number) {
  return cleanText(
    chunk.segments
      .filter((segment) => segment.end >= start && segment.start <= end)
      .map((segment) => segment.text)
      .join(" ") || chunk.segments[0]?.text,
    280,
  );
}

function boundedTime(value: unknown, fallback: number, minimum: number, maximum: number) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? clamp(numeric, minimum, maximum) : fallback;
}

function agentEvidence(
  value: unknown,
  chunk: PedagogicalTranscriptChunk,
  start: number,
  end: number,
) {
  const requested = cleanText(value, 280);
  if (requested && normalized(chunkText(chunk)).includes(normalized(requested))) return requested;
  return evidenceFor(chunk, start, end);
}

function agentImportance(value: unknown): IntelligentPedagogicalItem["importance"] {
  return ["low", "medium", "high"].includes(String(value))
    ? value as IntelligentPedagogicalItem["importance"]
    : "medium";
}

function agentConfidence(value: unknown) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 0.7;
}

function itemId(kind: IntelligentPedagogicalItemKind, start: number, index: number) {
  return `ped-${kind}-${Math.round(start * 1_000)}-${index + 1}`;
}

function normalizeAgentItems(
  value: unknown,
  chunk: PedagogicalTranscriptChunk,
): IntelligentPedagogicalItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => normalizeAgentItem(candidate, index, chunk));
}

function normalizeAgentItem(
  candidate: unknown,
  index: number,
  chunk: PedagogicalTranscriptChunk,
): IntelligentPedagogicalItem[] {
  if (!candidate || typeof candidate !== "object") return [];
  const raw = candidate as Record<string, unknown>;
  const kind = String(raw.kind || "") as IntelligentPedagogicalItemKind;
  const title = cleanText(raw.title, 120);
  if (!PEDAGOGICAL_ITEM_KINDS.has(kind) || !title) return [];
  const start = boundedTime(raw.start, chunk.start, chunk.start, chunk.end);
  const fallbackEnd = Math.max(
    start,
    chunk.segments.find((segment) => segment.end >= start)?.end || start,
  );
  const end = boundedTime(raw.end, fallbackEnd, start, chunk.end);
  const item: IntelligentPedagogicalItem = {
    id: itemId(kind, start, index),
    kind,
    title,
    start,
    end,
    evidence: agentEvidence(raw.evidence, chunk, start, end),
    importance: agentImportance(raw.importance),
    confidence: agentConfidence(raw.confidence),
    editorialSuggestion: cleanText(raw.editorialSuggestion, 280)
      || "Revisar este ponto antes de transformar em recurso visual.",
    status: "suggested",
    source: "chunk-agent",
  };
  const detail = cleanText(raw.detail, 360);
  if (detail) item.detail = detail;
  return [item];
}

function fallbackItem(
  kind: IntelligentPedagogicalItemKind,
  segment: TimedTranscriptSegment,
  index: number,
  title: string,
  editorialSuggestion: string,
  importance: IntelligentPedagogicalItem["importance"] = "medium",
): IntelligentPedagogicalItem {
  return {
    id: itemId(kind, segment.start, index),
    kind,
    title: cleanText(title, 120),
    start: segment.start,
    end: segment.end,
    evidence: cleanText(segment.text, 280),
    importance,
    confidence: 0.58,
    editorialSuggestion,
    status: "suggested",
    source: "chunk-fallback",
  };
}

function deterministicChunkItems(
  chunk: PedagogicalTranscriptChunk,
  totalChunks: number,
) {
  const items: IntelligentPedagogicalItem[] = [];
  const first = chunk.segments[0];
  if (!first) return items;
  if (chunk.index === 0) {
    items.push(fallbackItem(
      "objective",
      first,
      items.length,
      cleanText(first.text, 100),
      "Apresentar o objetivo da aula de forma breve e verificável.",
      "high",
    ));
  }
  for (const segment of chunk.segments) {
    const text = normalized(segment.text);
    for (const rule of DETERMINISTIC_RULES) {
      if (!rule.pattern.test(text)) continue;
      items.push(fallbackItem(
        rule.kind,
        segment,
        items.length,
        segment.text,
        rule.suggestion,
        rule.importance,
      ));
    }
  }
  if (chunk.index === totalChunks - 1 && !items.some((item) => item.kind === "summary")) {
    const last = chunk.segments[chunk.segments.length - 1];
    items.push(fallbackItem(
      "summary",
      last,
      items.length,
      cleanText(last.text, 100),
      "Revisar como possível síntese ou fechamento da aula.",
    ));
  }
  return items;
}

const DETERMINISTIC_RULES: Array<{
  pattern: RegExp;
  kind: IntelligentPedagogicalItemKind;
  suggestion: string;
  importance?: IntelligentPedagogicalItem["importance"];
}> = [
  { pattern: /\b(primeiro|segundo|terceiro|passo|etapa)\b/, kind: "process-step", suggestion: "Apresentar como etapa numerada do processo.", importance: "high" },
  { pattern: /\b(agora|a seguir|vamos para|proximo ponto)\b/, kind: "chapter", suggestion: "Usar como marco de capítulo ou mudança de assunto." },
  { pattern: /\b(pre-requisito|antes de comecar|voce precisa|e necessario)\b/, kind: "prerequisite", suggestion: "Registrar como pré-requisito verificável da aula.", importance: "high" },
  { pattern: /\b(ao final|voce vai conseguir|resultado desta aula|o que voce vai aprender)\b/, kind: "promise", suggestion: "Usar como promessa específica da aula.", importance: "high" },
  { pattern: /\b(significa|definimos|definicao|e quando|chamamos de)\b/, kind: "definition", suggestion: "Destacar como definição sem repetir a legenda.", importance: "high" },
  { pattern: /\b(conceito|fundamento|principio)\b/, kind: "concept", suggestion: "Registrar como conceito-chave da aula." },
  { pattern: /\b(por exemplo|exemplo|imagine que)\b/, kind: "example", suggestion: "Identificar visualmente o início do exemplo." },
  { pattern: /\b(vou mostrar|veja na tela|demonstracao|na pratica)\b/, kind: "demonstration", suggestion: "Preservar a continuidade da demonstração prática.", importance: "high" },
  { pattern: /\b(cuidado|atencao|evite|nunca|nao faca)\b/, kind: "warning", suggestion: "Exibir como alerta curto e discreto.", importance: "high" },
  { pattern: /\b(erro comum|muita gente erra|equivoco)\b/, kind: "common-error", suggestion: "Destacar o erro e a correção correspondente.", importance: "high" },
  { pattern: /\b(exercicio|pratique|tente fazer|atividade)\b/, kind: "exercise", suggestion: "Converter em exercício revisável ao final da aula.", importance: "high" },
  { pattern: /\b(aplique|faca agora|sua tarefa)\b/, kind: "action", suggestion: "Transformar em próxima ação objetiva.", importance: "high" },
  { pattern: /\b(aula anterior|anteriormente|como vimos)\b/, kind: "previous-link", suggestion: "Relacionar explicitamente com o conteúdo anterior." },
  { pattern: /\b(proxima aula|a seguir veremos|depois vamos)\b/, kind: "next-link", suggestion: "Usar como continuidade real para a próxima aula." },
  { pattern: /\b(resumindo|em resumo|recapitulando|para concluir)\b/, kind: "summary", suggestion: "Usar como síntese pedagógica da aula.", importance: "high" },
];

function pedagogicalPrompt(
  chunk: PedagogicalTranscriptChunk,
  totalChunks: number,
  input: Pick<AnalyzePedagogicalTranscriptInput, "courseName" | "moduleName">,
) {
  return [
    "Você é um designer instrucional analisando um vídeo de curso em português brasileiro.",
    `Este é o bloco ${chunk.index + 1} de ${totalChunks}. Analise integralmente somente este bloco.`,
    "Retorne SOMENTE JSON válido no formato:",
    '{"items":[{"kind":"objective|prerequisite|promise|chapter|concept|definition|process-step|example|demonstration|warning|common-error|exercise|action|summary|previous-link|next-link","title":"...","detail":"...","start":0,"end":5,"evidence":"trecho literal curto","importance":"low|medium|high","confidence":0.9,"editorialSuggestion":"..."}]}',
    "Use os timestamps fornecidos. Toda conclusão deve citar evidência realmente presente no bloco.",
    "Não invente pré-requisitos, exercícios, relações entre aulas ou promessas.",
    "Não confunda uma frase casual com objetivo pedagógico. Prefira poucos itens relevantes.",
    `Curso: ${input.courseName || "não informado"}`,
    `Aula ou módulo: ${input.moduleName}`,
    chunkText(chunk),
  ].join("\n");
}

export function consolidatePedagogicalItems(items: IntelligentPedagogicalItem[]) {
  const consolidated: IntelligentPedagogicalItem[] = [];
  for (const item of [...items].sort((left, right) => left.start - right.start || left.end - right.end)) {
    const duplicate = consolidated.find((candidate) =>
      candidate.kind === item.kind
      && Math.abs(candidate.start - item.start) <= 2
      && normalized(candidate.title) === normalized(item.title));
    if (!duplicate) {
      consolidated.push(item);
      continue;
    }
    if (item.confidence > duplicate.confidence) {
      Object.assign(duplicate, item, { id: duplicate.id });
    }
  }
  return consolidated.map((item, index) => ({ ...item, id: itemId(item.kind, item.start, index) }));
}

async function agentItemsForChunk(
  input: AnalyzePedagogicalTranscriptInput,
  chunk: PedagogicalTranscriptChunk,
  totalChunks: number,
) {
  if (!input.useAgent || !input.queryAgent) return [];
  try {
    const response = await input.queryAgent(pedagogicalPrompt(chunk, totalChunks, input));
    const parsed = response ? extractJsonObject(response) : null;
    return normalizeAgentItems(parsed?.items, chunk);
  } catch {
    return [];
  }
}

export async function analyzePedagogicalTranscript(
  input: AnalyzePedagogicalTranscriptInput,
): Promise<IntelligentPedagogicalAnalysis> {
  const chunks = buildPedagogicalTranscriptChunks(input.segments, input.maxChunkCharacters);
  const chunkOutcomes = await Promise.all(
    chunks.map(async (chunk) => {
      const chunkItems = await agentItemsForChunk(input, chunk, chunks.length);
      if (chunkItems.length) {
        return { isAgent: true, items: chunkItems };
      }
      return { isAgent: false, items: deterministicChunkItems(chunk, chunks.length) };
    }),
  );
  let agentChunks = 0;
  const items: IntelligentPedagogicalItem[] = [];
  for (const outcome of chunkOutcomes) {
    if (outcome.isAgent) agentChunks += 1;
    items.push(...outcome.items);
  }
  const source = agentChunks === chunks.length && chunks.length > 0
    ? "agent"
    : agentChunks > 0
      ? "hybrid"
      : "deterministic-fallback";
  return {
    version: INTELLIGENT_PEDAGOGICAL_ANALYSIS_VERSION,
    source,
    chunkCount: chunks.length,
    segmentsAnalyzed: input.segments.length,
    analyzedCharacters: input.segments.reduce((sum, segment) => sum + segment.text.length, 0),
    items: consolidatePedagogicalItems(items),
  };
}

export function pedagogicalAnalysisDigest(analysis: IntelligentPedagogicalAnalysis) {
  return analysis.items
    .filter((item) => item.importance === "high" || ["objective", "promise", "summary", "next-link"].includes(item.kind))
    .slice(0, 40)
    .map((item) => `[${item.start.toFixed(1)}-${item.end.toFixed(1)}] ${item.kind}: ${item.title}`)
    .join("\n");
}
