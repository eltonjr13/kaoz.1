import type {
  ChatMemoryKind,
  ChatMemoryScope,
  ChatMemorySource,
  ChatMemoryStatus
} from '../types/memory';

export interface ChatMemoryExtractionContext {
  avatarId?: string;
  projectId?: string;
  sessionId?: string;
  defaultScope?: ChatMemoryScope;
  source?: ChatMemorySource;
}

export interface ChatMemoryCandidate {
  kind: ChatMemoryKind;
  scope: ChatMemoryScope;
  content: string;
  evidence: string[];
  confidenceScore: number;
  status: ChatMemoryStatus;
  source: ChatMemorySource;
  matchedPhrase: string;
}

interface SignalDefinition {
  phrase: string;
  pattern: RegExp;
  defaultKind: ChatMemoryKind;
  defaultScope?: ChatMemoryScope;
  confidenceScore: number;
  status: Extract<ChatMemoryStatus, 'active' | 'pending_review'>;
}

interface MatchedSignal {
  signal: SignalDefinition;
  content: string;
}

const EXPLICIT_SIGNALS: SignalDefinition[] = [
  {
    phrase: 'nao faca mais',
    pattern: /\bnao\s+faca\s+mais\s+(.+)/,
    defaultKind: 'workflow_rule',
    confidenceScore: 0.96,
    status: 'active'
  },
  {
    phrase: 'nao gosto de',
    pattern: /\bnao\s+gosto\s+de\s+(.+)/,
    defaultKind: 'user_preference',
    confidenceScore: 0.9,
    status: 'active'
  },
  {
    phrase: 'prefiro que',
    pattern: /\bprefiro\s+que\s+(.+)/,
    defaultKind: 'user_preference',
    confidenceScore: 0.92,
    status: 'active'
  },
  {
    phrase: 'sempre que',
    pattern: /\bsempre\s+que\s+(.+)/,
    defaultKind: 'workflow_rule',
    confidenceScore: 0.92,
    status: 'active'
  },
  {
    phrase: 'nesse projeto',
    pattern: /\b(?:nesse|neste)\s+projeto\b\s*(?::|,|-)?\s*(.+)/,
    defaultKind: 'project_fact',
    defaultScope: 'project',
    confidenceScore: 0.9,
    status: 'active'
  },
  {
    phrase: 'gosto de',
    pattern: /\bgosto\s+de\s+(.+)/,
    defaultKind: 'user_preference',
    confidenceScore: 0.88,
    status: 'active'
  },
  {
    phrase: 'lembre que',
    pattern: /\blembr(?:e|a)(?:-se)?\s+(?:que|de)\s+(.+)/,
    defaultKind: 'project_fact',
    confidenceScore: 0.95,
    status: 'active'
  }
];

const WEAK_SIGNALS: SignalDefinition[] = [
  {
    phrase: 'da proxima vez',
    pattern: /\b(?:da|na)\s+proxima\s+vez\s*,?\s*(.+)/,
    defaultKind: 'correction',
    confidenceScore: 0.5,
    status: 'pending_review'
  },
  {
    phrase: 'seria melhor',
    pattern: /\bseria\s+melhor\s+(?:se\s+)?(.+)/,
    defaultKind: 'workflow_rule',
    confidenceScore: 0.45,
    status: 'pending_review'
  },
  {
    phrase: 'melhor usar',
    pattern: /\bmelhor\s+usar\s+(.+)/,
    defaultKind: 'workflow_rule',
    confidenceScore: 0.42,
    status: 'pending_review'
  }
];

const AVATAR_SIGNAL = /\b(?:avatar|personagem|persona|voz|rosto|face|lipsync|lip sync)\b/;
const CREATIVE_SIGNAL = /\b(?:imagem|imagens|video|videos|foto|fotos|criativo|criativos|visual|estilo|camera|enquadramento|cor|cores|roteiro|prompt|thumbnail)\b/;
const PREFERENCE_SIGNAL = /\b(?:prefiro|gosto|nao gosto)\b/;
const CORRECTION_SIGNAL = /\b(?:corrija|correcao|erro|errado|proxima vez)\b/;
const WORKFLOW_SIGNAL = /\b(?:sempre que|nunca|evite|use|usar|mantenha|nao faca|priorize)\b/;
const PROJECT_SIGNAL = /\b(?:projeto|cliente|campanha|workspace|repositorio|repo)\b/;
const VAGUE_CONTENT = new Set(['isso', 'assim', 'desse jeito', 'dessa forma']);

const SENSITIVE_PATTERNS = [
  /\b(?:senha|password|token|api\s*key|chave\s*(?:de\s*)?api|secret|segredo|bearer|private\s*key|access\s*key|refresh\s*token)\b\s*(?:e|eh|=|:|-)\s*\S+/,
  /\b(?:cpf|cnpj|cartao|credit\s*card)\b\s*(?:e|eh|=|:|-)\s*[\d.\-/ ]{6,}/,
  /\b(?:sk|pk|ghp|github_pat|xox[baprs]?|aiza)[a-z0-9_-]{16,}\b/,
  /\b[a-z0-9+/=_-]{48,}\b/
];

export function extractChatMemoryCandidates(
  lastUserMessage: string,
  agentResponse = '',
  context: ChatMemoryExtractionContext = {}
): ChatMemoryCandidate[] {
  const message = cleanWhitespace(lastUserMessage);

  if (!message) {
    return [];
  }

  const source = context.source ?? 'flow_chat';
  const candidates: ChatMemoryCandidate[] = [];

  for (const segment of splitCandidateSegments(message)) {
    const candidate = extractCandidateFromSegment(segment, agentResponse, context, source);

    if (candidate) {
      candidates.push(candidate);
    }
  }

  return dedupeCandidates(candidates);
}

function extractCandidateFromSegment(
  segment: string,
  agentResponse: string,
  context: ChatMemoryExtractionContext,
  source: ChatMemorySource
): ChatMemoryCandidate | null {
  if (hasSensitiveSignal(segment)) {
    return createSafetyBoundaryCandidate(context, source);
  }

  const explicit = findSignal(segment, EXPLICIT_SIGNALS);
  const match = explicit ?? findSignal(segment, WEAK_SIGNALS);

  return match ? buildCandidate(match, segment, agentResponse, context, source) : null;
}

function buildCandidate(
  match: MatchedSignal,
  evidence: string,
  agentResponse: string,
  context: ChatMemoryExtractionContext,
  source: ChatMemorySource
): ChatMemoryCandidate {
  const kind = classifyKind(match.content, match.signal.defaultKind, match.signal.phrase);
  const status = match.signal.status;

  return {
    kind,
    scope: resolveScope(kind, match.content, match.signal, context),
    content: formatCandidateContent(match.signal.phrase, match.content),
    evidence: [cleanWhitespace(evidence)],
    confidenceScore: adjustConfidence(match.signal.confidenceScore, status, agentResponse),
    status,
    source,
    matchedPhrase: match.signal.phrase
  };
}

function findSignal(segment: string, signals: SignalDefinition[]): MatchedSignal | null {
  const normalized = normalizeForMatch(segment);

  for (const signal of signals) {
    const match = signal.pattern.exec(normalized);
    const content = match ? getOriginalMatchedContent(segment, match) : '';

    if (isMeaningfulContent(content)) {
      return { signal, content };
    }
  }

  return null;
}

function getOriginalMatchedContent(segment: string, match: RegExpExecArray): string {
  const captured = match[1] ?? '';
  const contentStart = match.index + match[0].length - captured.length;
  return cleanExtractedContent(segment.slice(contentStart));
}

function classifyKind(
  content: string,
  defaultKind: ChatMemoryKind,
  matchedPhrase: string
): ChatMemoryKind {
  const normalized = normalizeForMatch(`${matchedPhrase} ${content}`);

  if (AVATAR_SIGNAL.test(normalized)) {
    return 'avatar_style_signal';
  }

  if (CREATIVE_SIGNAL.test(normalized) && isPreferenceKind(defaultKind, normalized)) {
    return 'creative_preference';
  }

  if (PREFERENCE_SIGNAL.test(normalized) && defaultKind === 'project_fact') {
    return 'user_preference';
  }

  if (CORRECTION_SIGNAL.test(normalized) && defaultKind !== 'workflow_rule') {
    return 'correction';
  }

  if (WORKFLOW_SIGNAL.test(normalized) && defaultKind === 'project_fact') {
    return 'workflow_rule';
  }

  return defaultKind;
}

function isPreferenceKind(defaultKind: ChatMemoryKind, normalized: string): boolean {
  return defaultKind === 'user_preference' || PREFERENCE_SIGNAL.test(normalized);
}

function resolveScope(
  kind: ChatMemoryKind,
  content: string,
  signal: SignalDefinition,
  context: ChatMemoryExtractionContext
): ChatMemoryScope {
  const normalized = normalizeForMatch(content);

  if (context.defaultScope) {
    return context.defaultScope;
  }

  if (signal.defaultScope) {
    return signal.defaultScope;
  }

  if (kind === 'avatar_style_signal') {
    return 'avatar';
  }

  if (kind === 'project_fact' || PROJECT_SIGNAL.test(normalized)) {
    return 'project';
  }

  return signal.status === 'pending_review' ? 'session' : 'global';
}

function formatCandidateContent(phrase: string, content: string): string {
  const templates: Record<string, string> = {
    'nao faca mais': `Nao fazer mais ${content}`,
    'nao gosto de': `Usuario nao gosta de ${content}`,
    'prefiro que': `Usuario prefere que ${content}`,
    'sempre que': `Sempre que ${content}`,
    'nesse projeto': `Neste projeto: ${content}`,
    'gosto de': `Usuario gosta de ${content}`,
    'lembre que': `Lembrar que ${content}`,
    'da proxima vez': `Da proxima vez, ${content}`,
    'seria melhor': `Seria melhor ${content}`,
    'melhor usar': `Melhor usar ${content}`
  };

  return templates[phrase] ?? content;
}

function adjustConfidence(
  baseConfidence: number,
  status: ChatMemoryStatus,
  agentResponse: string
): number {
  const acknowledged = status === 'active' && hasMemoryAcknowledgement(agentResponse);
  const confidence = acknowledged ? baseConfidence + 0.03 : baseConfidence;
  const capped = status === 'pending_review' ? Math.min(confidence, 0.59) : confidence;

  return Number(Math.min(capped, 1).toFixed(2));
}

function hasMemoryAcknowledgement(agentResponse: string): boolean {
  return /\b(?:anotado|combinado|vou lembrar|irei lembrar|vou seguir|entendido)\b/.test(
    normalizeForMatch(agentResponse)
  );
}

function createSafetyBoundaryCandidate(
  context: ChatMemoryExtractionContext,
  source: ChatMemorySource
): ChatMemoryCandidate {
  return {
    kind: 'safety_boundary',
    scope: context.defaultScope ?? 'session',
    content: 'Conteudo sensivel detectado; nao armazenar valores secretos ou credenciais.',
    evidence: ['[sensitive content redacted]'],
    confidenceScore: 1,
    status: 'rejected',
    source,
    matchedPhrase: 'sensitive_content'
  };
}

function splitCandidateSegments(message: string): string[] {
  return message
    .split(/[\r\n]+|[.!?]+\s+|;\s+/)
    .map(cleanWhitespace)
    .filter(Boolean);
}

function hasSensitiveSignal(value: string): boolean {
  const normalized = normalizeForMatch(value);
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isMeaningfulContent(value: string): boolean {
  const normalized = normalizeForMatch(value);
  return normalized.length >= 4 && !VAGUE_CONTENT.has(normalized);
}

function cleanExtractedContent(value: string): string {
  return cleanWhitespace(value)
    .replace(/^[:"'`-]+/, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function dedupeCandidates(candidates: ChatMemoryCandidate[]): ChatMemoryCandidate[] {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.scope}:${normalizeForMatch(candidate.content)}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
