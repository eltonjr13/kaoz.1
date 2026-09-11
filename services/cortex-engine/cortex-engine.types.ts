/**
 * Contratos do motor Cortex derivado do MaleCNS.
 *
 * Três estruturas com responsabilidades explícitas (plano, seção 4):
 *  1. dados duráveis  — permanecem nos formatos existentes de memória/conversa;
 *  2. motor derivado  — matriz esparsa + parâmetros versionados → scores/estado;
 *  3. observabilidade — rastros de seleção que alimentam a UI do Cortex.
 *
 * Nada aqui armazena conteúdo de memória: apenas IDs, scores e metadados.
 */

// ---------------------------------------------------------------------------
// Modos e escopo
// ---------------------------------------------------------------------------

/** `legacy` = caminho anterior; `shadow` = rede processa cópia isolada sem afetar o contexto; `malecns` = novo ranking quando os artefatos estão válidos. */
export type CortexEngineMode = "legacy" | "shadow" | "malecns";

/** Estado operacional exibido na UI. Nunca inferido de atividade fictícia. */
export type CortexEngineStatus =
  | "disabled"
  | "preparing"
  | "ready"
  | "processing"
  | "shadow-comparing"
  | "fallback"
  | "error";

/** Canais que podem originar uma recuperação. O escopo é resolvido no servidor. */
export type CortexEngineChannel = "flow" | "telegram" | "discord" | "agent";

/**
 * Chave de isolamento: identidade/perfil + projeto + conversa/sessão + tarefa.
 * `sessionId` e `profileId` são obrigatórios — IDs ausentes NÃO caem em um
 * "default" compartilhado (plano, seção 7).
 */
export interface RetrievalScope {
  profileId: string;
  sessionId: string;
  projectId?: string;
  avatarId?: string;
  taskId?: string;
  channel: CortexEngineChannel;
}

export interface RetrievalRequest {
  requestId: string;
  scope: RetrievalScope;
  query: string;
  cortexEnabled: boolean;
  /** Pedidos que dependem do contexto imediato mantêm o desvio atual da recuperação externa. */
  immediateContextReference: boolean;
  mode: CortexEngineMode;
  tokenBudget: number;
  deadlineMs: number;
  signal?: AbortSignal;
}

/** De onde o candidato veio. Determina quais métricas de recall comparar. */
export type MemoryCandidateSource = "chat" | "archive" | "episode";

export interface MemoryCandidate {
  id: string;
  source: MemoryCandidateSource;
  /** Versão da origem: permite invalidar índice/cache sem releitura destrutiva. */
  sourceVersion: string;
  content: string;
  evidenceIds: string[];
  baselineScore: number;
  scope?: RetrievalScope;
  kind?: string;
  updatedAt?: string;
  explicit?: boolean;
  confidenceScore?: number;
  occurrences?: number;
}

/** Engine efetivamente responsável pelo resultado entregue. */
export type EffectiveEngine = "legacy" | "malecns";

export interface RetrievalResult {
  selectedIds: string[];
  orderedCandidates: MemoryCandidate[];
  traceId?: string;
  effectiveEngine: EffectiveEngine;
  /** Presente apenas quando o caminho anterior produziu o resultado. */
  fallbackReason?: string;
  /** Comparação em `shadow`; nunca altera o contexto entregue. */
  shadow?: ShadowComparison;
}

export interface ShadowComparison {
  legacyIds: string[];
  malecnsIds: string[];
  /** Sobrepõe-se à seleção do caminho anterior. */
  overlapAt8: number;
  divergenceAt1: boolean;
  malecnsMs: number;
  legacyMs: number;
}

/** Motivos de fallback cobertos pelos testes da seção 16. */
export type FallbackReason =
  | "cortex-disabled"
  | "immediate-context"
  | "package-missing"
  | "package-invalid"
  | "checksum-mismatch"
  | "dimension-mismatch"
  | "deadline-exceeded"
  | "worker-exited"
  | "nan-or-infinity"
  | "queue-full"
  | "encoder-mismatch"
  | "engine-error";

// ---------------------------------------------------------------------------
// Pacote de conectoma
// ---------------------------------------------------------------------------

export interface ConnectomePackageManifest {
  /** Identificador fixado da fonte, ex.: `male-cns:v1.0`. */
  datasetId: string;
  datasetVersion: string;
  /** URL exata de cada insumo baixado, com o SHA-256 calculado localmente. */
  sources: Array<{ name: string; url: string; sha256: string; bytes: number }>;
  /** Licença do dataset de origem, exigida na interface. */
  license: string;
  attribution: string;
  generatedAt: string;
  /** Algoritmo de seleção do recorte, com seed e critérios explícitos. */
  selection: SelectionProvenance;
  stats: ConnectomeStats;
  /** Escala registrada das cores de atividade — não são medições biológicas. */
  activityScale: { min: number; max: number; note: string };
  /** Descrição da matriz esparsa embarcada. */
  csr: CsrProvenance;
  tooling: Record<string, string>;
}

export interface CsrProvenance {
  /** Convenção de orientação, ex.: `W[destination, origin]`. */
  orientation: string;
  indexType: string;
  weightType: string;
  endianness: string;
  nnz: number;
  shape: [number, number];
}

export interface SelectionProvenance {
  algorithm: string;
  seed: number;
  criteria: string[];
  targetNeurons: number;
  targetEdges: number;
  /** Contagens e proporções retidas, exigidas quando há poda. */
  retainedNeurons: number;
  retainedEdges: number;
  retainedFraction: number;
  pruneThreshold?: number;
  notes?: string[];
}

export interface ConnectomeStats {
  neurons: number;
  edges: number;
  cellTypes: number;
  regions: string[];
  superclasses: Record<string, number>;
}

/** Mapeamento índice computacional → neurônio real. `bodyId` como string preserva limites numéricos de outras fontes. */
export interface ConnectomeNode {
  index: number;
  bodyId: string;
  type: string | null;
  superclass: string | null;
  region: string | null;
  /** Presente quando o neurônio é dimórfico ou macho-específico. */
  dimorphism?: string | null;
}

export interface ConnectomeGeometry {
  /** Posições normalizadas em [0,1] por eixo, prontas para projeção 2D/2,5D. */
  positions: Float32Array;
  nodeCount: number;
  /** Transformação espacial aplicada, documentada para reprodutibilidade. */
  transform: string;
  units: string;
  /** Níveis de detalhe: subconjuntos de índices por orçamento de render. */
  levels?: number[][];
}

/**
 * Pesos de saída treinados. Nunca aleatórios em produção — pesos aleatórios
 * servem a testes, não a um motor apresentado como treinado (plano, seção 6.5).
 */
export interface ReadoutArtifact {
  version: string;
  /** Contrato dimensional: a inferência recusa artefato incompatível. */
  dimension: number;
  featureNames: string[];
  weights: Float32Array;
  bias: number;
  normalization: {
    mean: Float32Array;
    std: Float32Array;
  };
  training: ReadoutTrainingProvenance;
}

export interface ReadoutTrainingProvenance {
  algorithm: string;
  learningRate: number;
  epochs: number;
  seed: number;
  l2: number;
  /** Partições congeladas; o conjunto de teste não orientou a escolha. */
  trainSize: number;
  validationSize: number;
  testSize: number;
  validationMetric: { name: string; value: number };
  /** Verdadeiro quando o readout foi treinado sem features do conectoma (variante de controle). */
  topologyControl?: string;
}

// ---------------------------------------------------------------------------
// Codificação
// ---------------------------------------------------------------------------

/**
 * Encoder versionado e independente do conectoma. Todas as variantes comparadas
 * usam exatamente o mesmo encoder — se a melhoria vier dele, isso é registrado
 * separadamente (plano, seção 6.3).
 */
export interface TextEncoderArtifact {
  id: string;
  version: string;
  dimension: number;
  /** SHA-256 do vocabulário/parâmetros: impede reutilizar índice de outra versão. */
  hash: string;
  kind: "lexical-hash" | "semantic-local";
}

export interface EncodedCandidate {
  id: string;
  vector: Float32Array;
  /** Mantido para o encoder lexical; evita recalcular busca por palavra-chave. */
  lexicalScore?: number;
}

// ---------------------------------------------------------------------------
// Memória de trabalho por tarefa
// ---------------------------------------------------------------------------

export type TaskEventKind =
  | "user-request"
  | "explicit-correction"
  | "artifact-approved"
  | "step-completed"
  | "tool-result";

export interface TaskStateEvent {
  eventId: string;
  taskId: string;
  /** Consumido uma única vez; eventos repetidos são ignorados (idempotência). */
  sequence: number;
  kind: TaskEventKind;
  origin: RetrievalScope;
  timestamp: string;
  content: string;
  evidenceIds: string[];
}

/** Estado explícito: referência para objetivo, restrições, artefato aprovado e correções. */
export interface ExplicitTaskState {
  taskId: string;
  objective: string | null;
  /** Fica em hipótese até confirmação do fluxo — inferência não é comando do usuário. */
  objectiveHypothesis: boolean;
  constraints: string[];
  approvedArtifactId: string | null;
  corrections: Array<{ eventId: string; content: string; timestamp: string }>;
  lastEventSequence: number;
  updatedAt: string;
}

/** Estado numérico derivado. Ordena contexto; não substitui os fatos acima. */
export interface DerivedTaskState {
  taskId: string;
  scopeKey: string;
  vector: Float32Array;
  eventCount: number;
  lastEventSequence: number;
  lastActivityAt: string;
  /** Invalidação de versão: índice anterior não é reutilizado. */
  sourceVersions: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Rastros (observabilidade)
// ---------------------------------------------------------------------------

export interface EngineTrace {
  traceId: string;
  requestId: string;
  createdAt: string;
  /** Chave de escopo resolvida no servidor, não fornecida pelo cliente. */
  scopeKey: string;
  channel: CortexEngineChannel;
  mode: CortexEngineMode;
  effectiveEngine: EffectiveEngine;
  fallbackReason?: FallbackReason;
  modelVersion: string;
  sourceVersions: Record<string, string>;
  candidateIds: string[];
  selectedIds: string[];
  scores: number[];
  tokensEstimated: number;
  timings: Record<string, number>;
  /** Estado inicial/final versionado para replay limitado. */
  initialStateVersion?: string;
  finalStateVersion?: string;
  shadow?: ShadowComparison;
  /** Amostras de atividade numérica; matrizes completas não são persistidas. */
  activitySamples?: ActivitySample[];
}

export interface ActivitySample {
  step: number;
  /** Índices de nós com magnitude acima do limiar de amostragem. */
  nodeIndices: number[];
  magnitudes: number[];
}

export interface TraceQuery {
  scopeKey?: string;
  limit?: number;
  cursor?: string;
  traceId?: string;
}

/** Detalhe resolvido por IDs e autorização atual — não guarda texto de conversa. */
export interface TraceDetail extends EngineTrace {
  evidence: Array<{ id: string; source: MemoryCandidateSource; available: boolean }>;
}

// ---------------------------------------------------------------------------
// Worker / runtime
// ---------------------------------------------------------------------------

export interface EngineWorkerRequest {
  kind: "rank";
  requestId: string;
  deadlineMs: number;
  queryVector: Float32Array;
  candidateVectors: Float32Array;
  candidateIds: string[];
  baselineScores: number[];
  /**
   * Metadados por candidato, com passo `CANDIDATE_META_STRIDE`.
   *
   * Sem isto o worker não consegue calcular as features que dependem da
   * memória (recência, explicitude, confiança, recorrência) e teria que
   * inventar constantes — o que coloca o readout treinado fora da distribuição
   * aprendida. Ordem: semanticDot, recencyDays, explicit, confidence, occurrences.
   */
  candidateMeta: Float32Array;
  taskVector?: Float32Array;
  /** Estado inicial: cada candidato parte da mesma referência, em cópia isolada. */
  withTaskState: boolean;
  sampleActivity: boolean;
}

/** Quantos valores de metadado cada candidato carrega. */
export const CANDIDATE_META_STRIDE = 5;

export interface EngineWorkerResponse {
  requestId: string;
  ok: boolean;
  error?: FallbackReason;
  scores?: Float32Array;
  activitySamples?: ActivitySample[];
  timings?: Record<string, number>;
}

export interface EngineFailure {
  reason: FallbackReason;
  detail?: string;
}
