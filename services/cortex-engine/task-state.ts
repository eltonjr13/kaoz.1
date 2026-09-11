/**
 * Memória de trabalho por tarefa.
 *
 * Dois estados com papéis distintos (plano, seção 7):
 *  - EXPLÍCITO: objetivo, restrições, artefato aprovado e correções. É a
 *    referência factual.
 *  - DERIVADO: vetor numérico que ajuda a ordenar contexto. NÃO substitui os
 *    fatos e nunca é alimentado por consultas da UI, polling ou candidatos
 *    descartados.
 *
 * Chave de isolamento: perfil + projeto + sessão + tarefa. IDs ausentes NÃO
 * caem em um "default" compartilhado que misture sessões.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { getStateDir } from "./cortex-engine.settings.ts";
import {
  l2Normalize,
  lexicalScore,
} from "./text-encoder.ts";
import type {
  DerivedTaskState,
  ExplicitTaskState,
  RetrievalScope,
  TaskEventKind,
  TaskStateEvent,
} from "./cortex-engine.types.ts";

/**
 * Chave estável de isolamento. Campos ausentes são marcados, não omitidos.
 *
 * A tarefa vem por ÚLTIMO de propósito: assim `scopeBaseKey` é um prefixo
 * literal de `scopeKey`, e invalidar por base alcança todas as tarefas do
 * mesmo projeto/sessão sem casar outro escopo por acidente.
 */
export function scopeKey(scope: RetrievalScope): string {
  return [
    `p=${scope.profileId}`,
    `s=${scope.sessionId}`,
    `j=${scope.projectId ?? "-"}`,
    `a=${scope.avatarId ?? "-"}`,
    `c=${scope.channel}`,
    `t=${scope.taskId ?? "-"}`,
  ].join("|");
}

/** Identidade do escopo sem a tarefa: base para TTL e troca de projeto. */
export function scopeBaseKey(scope: RetrievalScope): string {
  return [
    `p=${scope.profileId}`,
    `s=${scope.sessionId}`,
    `j=${scope.projectId ?? "-"}`,
    `a=${scope.avatarId ?? "-"}`,
    `c=${scope.channel}`,
  ].join("|");
}

const ACCEPTED_EVENT_KINDS: TaskEventKind[] = [
  "user-request",
  "explicit-correction",
  "artifact-approved",
  "step-completed",
  "tool-result",
];

export function isAcceptedEventKind(kind: string): kind is TaskEventKind {
  return (ACCEPTED_EVENT_KINDS as string[]).includes(kind);
}

export function emptyExplicitState(taskId: string, now = new Date()): ExplicitTaskState {
  return {
    taskId,
    objective: null,
    objectiveHypothesis: false,
    constraints: [],
    approvedArtifactId: null,
    corrections: [],
    lastEventSequence: 0,
    updatedAt: now.toISOString(),
  };
}

/**
 * Aplica um evento ao estado explícito.
 *
 * Eventos com `sequence` já consumida são IGNORADOS (idempotência), e um evento
 * atrasado de versão anterior não retrocede o estado.
 */
export function applyEvent(
  state: ExplicitTaskState,
  event: TaskStateEvent
): ExplicitTaskState {
  if (event.sequence <= state.lastEventSequence) return state;
  if (!isAcceptedEventKind(event.kind)) return state;
  const next: ExplicitTaskState = {
    ...state,
    lastEventSequence: event.sequence,
    updatedAt: event.timestamp,
    corrections: [...state.corrections],
    constraints: [...state.constraints],
  };
  switch (event.kind) {
    case "user-request":
      if (state.objective === null || state.objectiveHypothesis) {
        next.objective = event.content;
        next.objectiveHypothesis = false;
      }
      break;
    case "explicit-correction":
      next.corrections.push({
        eventId: event.eventId,
        content: event.content,
        timestamp: event.timestamp,
      });
      // Correção vigente é restrição: precisa sobreviver ao próximo contexto.
      next.constraints.push(event.content);
      break;
    case "artifact-approved":
      next.approvedArtifactId = event.content;
      break;
    default:
      break;
  }
  return next;
}

export interface DerivedStateInput {
  scope: RetrievalScope;
  explicit: ExplicitTaskState;
  events: TaskStateEvent[];
  /** Dimensão do vetor; igual à dimensão do reservatório. */
  dimension: number;
  sourceVersions: Record<string, string>;
  now?: Date;
}

/**
 * Constrói o estado derivado a partir dos eventos elegíveis.
 *
 * O vetor é uma média ponderada das codificações lexicais dos eventos, com peso
 * maior para correções e artefato aprovado. É reconstruível: não precisa ser
 * gravado a cada token ou mensagem parcial (plano, seção 7.7).
 */
export function buildDerivedState(input: DerivedStateInput): DerivedTaskState {
  const now = input.now ?? new Date();
  const vector = new Float32Array(input.dimension);
  const ordered = [...input.events].sort((a, b) => a.sequence - b.sequence);
  let weightTotal = 0;
  let lastSequence = 0;
  for (const event of ordered) {
    if (!isAcceptedEventKind(event.kind)) continue;
    const weight = eventWeight(event.kind);
    accumulate(vector, event.content, weight, input.dimension);
    weightTotal += weight;
    lastSequence = Math.max(lastSequence, event.sequence);
  }
  for (const correction of input.explicit.corrections) {
    accumulate(vector, correction.content, 3, input.dimension);
    weightTotal += 3;
  }
  if (input.explicit.approvedArtifactId) {
    accumulate(vector, input.explicit.approvedArtifactId, 2, input.dimension);
    weightTotal += 2;
  }
  if (weightTotal > 0) {
    for (let i = 0; i < vector.length; i++) vector[i] /= weightTotal;
  }
  return {
    taskId: input.explicit.taskId,
    scopeKey: scopeKey(input.scope),
    vector: l2Normalize(vector),
    eventCount: ordered.length,
    lastEventSequence: Math.max(lastSequence, input.explicit.lastEventSequence),
    lastActivityAt: now.toISOString(),
    sourceVersions: { ...input.sourceVersions },
  };
}

function eventWeight(kind: TaskEventKind): number {
  switch (kind) {
    case "explicit-correction":
      return 3;
    case "artifact-approved":
      return 2;
    case "user-request":
      return 1.5;
    default:
      return 1;
  }
}

/**
 * Acumula a contribuição de um texto no vetor. Usa a codificação lexical
 * determinística: a mesma entrada produz sempre o mesmo vetor.
 */
function accumulate(
  vector: Float32Array,
  text: string,
  weight: number,
  dimension: number
): void {
  if (!text) return;
  const encoded = encodeInto(text, dimension);
  // Escala pela relevância lexical relativa do próprio texto para não deixar
  // eventos longos dominarem apenas por comprimento.
  const magnitude = weight * (1 + lexicalScore(text, text));
  for (let i = 0; i < vector.length; i++) vector[i] += encoded[i] * magnitude;
}

function encodeInto(text: string, dimension: number): Float32Array {
  const vector = new Float32Array(dimension);
  const tokens = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2);
  if (!tokens.length) return vector;
  for (const token of tokens) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < token.length; i++) {
      hash ^= token.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    vector[hash % dimension] += 1;
  }
  return l2Normalize(vector);
}

// ---------------------------------------------------------------------------
// Ciclo de vida e TTL
// ---------------------------------------------------------------------------

/** Aplica TTL de inatividade ao vetor em RAM. Após expirar, é reconstruído. */
export function isExpired(
  state: DerivedTaskState,
  ttlMinutes: number,
  now = Date.now()
): boolean {
  const last = Date.parse(state.lastActivityAt);
  if (Number.isNaN(last)) return true;
  return now - last > ttlMinutes * 60_000;
}

/** Dimensão/modelo incompatível invalida o estado derivado correspondente. */
export function isCompatible(
  state: DerivedTaskState,
  dimension: number,
  currentVersions: Record<string, string>
): boolean {
  if (state.vector.length !== dimension) return false;
  return Object.entries(state.sourceVersions).every(
    ([id, version]) => currentVersions[id] === undefined || currentVersions[id] === version
  );
}

interface PersistedState {
  explicit: Record<string, ExplicitTaskState>;
}

function stateFile(): string {
  return path.join(getStateDir(), "explicit-task-state.json");
}

/**
 * O estado EXPLÍCITO sobrevive a reinício do aplicativo: as referências são
 * gravadas. O vetor é reconstruível e não é persistido (plano, seção 7.7).
 */
export async function loadExplicitStates(): Promise<Record<string, ExplicitTaskState>> {
  try {
    const raw = JSON.parse(await fs.readFile(stateFile(), "utf8")) as PersistedState;
    return raw.explicit ?? {};
  } catch {
    return {};
  }
}

export async function saveExplicitStates(
  states: Record<string, ExplicitTaskState>
): Promise<void> {
  const target = stateFile();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, JSON.stringify({ explicit: states }, null, 2), "utf8");
  await fs.rename(temp, target);
}

/**
 * Estado em memória do processo com commit serializado por tarefa.
 *
 * A fila em memória de um processo não protege dois processos: o dono da
 * escrita é o servidor local único (plano, seção 12).
 */
export class TaskStateStore {
  private derived = new Map<string, DerivedTaskState>();
  private explicit = new Map<string, ExplicitTaskState>();
  private chains = new Map<string, Promise<unknown>>();
  private ttlMinutes: number;
  private dimension: number;

  constructor(ttlMinutes: number, dimension: number) {
    this.ttlMinutes = ttlMinutes;
    this.dimension = dimension;
  }

  public getExplicit(taskId: string): ExplicitTaskState | undefined {
    return this.explicit.get(taskId);
  }

  public setExplicit(state: ExplicitTaskState): void {
    this.explicit.set(state.taskId, state);
  }

  /** Serializa commits por tarefa: concorrência de agentes não sobrescreve eventos. */
  public commit<T>(taskId: string, work: () => Promise<T> | T): Promise<T> {
    const previous = this.chains.get(taskId) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.chains.set(
      taskId,
      next.catch(() => undefined)
    );
    return next;
  }

  public getDerived(key: string, now = Date.now()): DerivedTaskState | undefined {
    const state = this.derived.get(key);
    if (!state) return undefined;
    if (isExpired(state, this.ttlMinutes, now)) {
      this.derived.delete(key);
      return undefined;
    }
    return state;
  }

  public setDerived(key: string, state: DerivedTaskState): void {
    if (state.vector.length !== this.dimension) return;
    this.derived.set(key, state);
  }

  /** Snapshot por pedido: cada requisição lê uma cópia isolada. */
  public snapshot(key: string): Float32Array | undefined {
    const state = this.getDerived(key);
    return state ? Float32Array.from(state.vector) : undefined;
  }

  /**
   * Desligar o Cortex descarta TODOS os vetores sem alimentar o motor e sem
   * registrar conteúdo para reprodução futura (plano, seção 7.8).
   */
  public discardAllDerived(): void {
    this.derived.clear();
  }

  /**
   * Descarta os vetores de TODAS as tarefas de um escopo-base.
   *
   * É a operação de troca de projeto/reset/exclusão de origem: como a base não
   * inclui a tarefa, isto alcança deliberadamente todas as tarefas daquele
   * projeto/sessão. Para uma única tarefa use `discardTask`.
   */
  public discardDerivedBase(scope: RetrievalScope): void {
    const base = scopeBaseKey(scope);
    for (const key of [...this.derived.keys()]) {
      if (key.startsWith(base)) this.derived.delete(key);
    }
  }

  /** Descarta exatamente UMA tarefa, sem tocar nas tarefas irmãs do mesmo projeto. */
  public discardTask(scope: RetrievalScope): void {
    this.derived.delete(scopeKey(scope));
  }

  /** Invalidação por base: mesmo efeito de `discardDerivedBase`. */
  public invalidateBase(base: string): void {
    for (const key of [...this.derived.keys()]) {
      if (key.startsWith(base)) this.derived.delete(key);
    }
  }
}
