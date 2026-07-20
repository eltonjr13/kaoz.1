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
  explicit: boolean;
  canonicalKey: string;
  tags: string[];
  supersedeHints: string[];
}

export interface ChatMemoryCommand {
  type: 'save' | 'correct' | 'forget' | 'none';
  explicit: boolean;
  target: string;
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

const SAVE_COMMAND = /\b(?:salv(?:e|a)|anot(?:e|a)|guarde|grave|registre)\s+(?:isso\s+)?(?:na|em)\s+(?:sua\s+)?memoria\b|\blembr(?:e|a)(?:-se)?\s+(?:que|de)\b/;
const FORGET_COMMAND = /\b(?:esquec(?:a|e)|remov(?:a|e)|apag(?:ue|a))\b(?:\s+(?:da|minha|sua))?\s*(?:memoria)?\s*(.*)/;
const CORRECTION_COMMAND = /\b(?:na verdade|corrij(?:a|o)|correcao|eu quis dizer)\b/;

const EXPLICIT_SIGNALS: SignalDefinition[] = [
  { phrase: 'nao faca mais', pattern: /\bnao\s+faca\s+mais\s+(.+)/, defaultKind: 'workflow_rule', confidenceScore: 0.96, status: 'active' },
  { phrase: 'nao gosto de', pattern: /\bnao\s+gosto\s+de\s+(.+)/, defaultKind: 'user_preference', confidenceScore: 0.9, status: 'active' },
  { phrase: 'prefiro que', pattern: /\bprefiro\s+que\s+(.+)/, defaultKind: 'user_preference', confidenceScore: 0.92, status: 'active' },
  { phrase: 'sempre que', pattern: /\bsempre\s+que\s+(.+)/, defaultKind: 'workflow_rule', confidenceScore: 0.92, status: 'active' },
  { phrase: 'nesse projeto', pattern: /\b(?:nesse|neste)\s+projeto\b\s*(?::|,|-)?\s*(.+)/, defaultKind: 'project_fact', defaultScope: 'project', confidenceScore: 0.9, status: 'active' },
  { phrase: 'gosto de', pattern: /\bgosto\s+de\s+(.+)/, defaultKind: 'user_preference', confidenceScore: 0.88, status: 'active' },
  { phrase: 'meu nome', pattern: /\bmeu\s+nome\s+(?:e|eh)\s+(.+)/, defaultKind: 'user_fact', confidenceScore: 0.96, status: 'active' },
  { phrase: 'fruta favorita', pattern: /\bminha\s+fruta\s+favorita\s+(?:e|eh)\s+(.+)/, defaultKind: 'user_preference', confidenceScore: 0.96, status: 'active' },
  { phrase: 'cor favorita', pattern: /\bminha\s+cor\s+favorita\s+(?:e|eh)\s+(.+)/, defaultKind: 'user_preference', confidenceScore: 0.96, status: 'active' }
];

const WEAK_SIGNALS: SignalDefinition[] = [
  { phrase: 'da proxima vez', pattern: /\b(?:da|na)\s+proxima\s+vez\s*,?\s*(.+)/, defaultKind: 'correction', confidenceScore: 0.5, status: 'pending_review' },
  { phrase: 'seria melhor', pattern: /\bseria\s+melhor\s+(?:se\s+)?(.+)/, defaultKind: 'workflow_rule', confidenceScore: 0.45, status: 'pending_review' },
  { phrase: 'melhor usar', pattern: /\bmelhor\s+usar\s+(.+)/, defaultKind: 'workflow_rule', confidenceScore: 0.42, status: 'pending_review' }
];

const AVATAR_SIGNAL = /\b(?:avatar|personagem|persona|voz|rosto|face|lipsync|lip sync)\b/;
const CREATIVE_SIGNAL = /\b(?:imagem|imagens|video|videos|foto|fotos|criativo|criativos|visual|estilo|camera|enquadramento|cor|cores|roteiro|prompt|thumbnail)\b/;
const PREFERENCE_SIGNAL = /\b(?:prefiro|gosto|nao gosto|favorit)\b/;
const WORKFLOW_SIGNAL = /\b(?:sempre que|nunca|evite|use|usar|mantenha|nao faca|priorize)\b/;
const PROJECT_SIGNAL = /\b(?:projeto|cliente|campanha|workspace|repositorio|repo)\b/;
const VAGUE_CONTENT = new Set(['isso', 'assim', 'desse jeito', 'dessa forma']);
const FRUITS = new Set(['abacate', 'abacaxi', 'acerola', 'banana', 'caju', 'cereja', 'coco', 'goiaba', 'kiwi', 'laranja', 'limao', 'maca', 'mamao', 'manga', 'maracuja', 'melancia', 'melao', 'morango', 'pera', 'pessego', 'uva']);

const SENSITIVE_PATTERNS = [
  /\b(?:senha|password|token|api\s*key|chave\s*(?:de\s*)?api|secret|segredo|bearer|private\s*key|access\s*key|refresh\s*token)\b\s*(?:e|eh|=|:|-)\s*\S+/,
  /\b(?:cpf|cnpj|cartao|credit\s*card)\b\s*(?:e|eh|=|:|-)\s*[\d.\-/ ]{6,}/,
  /\b(?:sk|pk|ghp|github_pat|xox[baprs]?|aiza)[a-z0-9_-]{16,}\b/,
  /\b[a-z0-9+/=_-]{48,}\b/
];

export function detectChatMemoryCommand(message: string): ChatMemoryCommand {
  const normalized = normalizeForMatch(message);
  const forget = FORGET_COMMAND.exec(normalized);
  if (forget) return { type: 'forget', explicit: true, target: cleanWhitespace(forget[1] || message) };
  if (CORRECTION_COMMAND.test(normalized)) return { type: 'correct', explicit: true, target: message };
  if (SAVE_COMMAND.test(normalized)) return { type: 'save', explicit: true, target: message };
  return { type: 'none', explicit: false, target: '' };
}

export function extractChatMemoryCandidates(
  lastUserMessage: string,
  _agentResponse = '',
  context: ChatMemoryExtractionContext = {}
): ChatMemoryCandidate[] {
  const message = cleanWhitespace(lastUserMessage);
  if (!message) return [];

  const command = detectChatMemoryCommand(message);
  if (command.type === 'forget') return [];
  const source = context.source ?? 'flow_chat';
  const candidates: ChatMemoryCandidate[] = [];
  const candidateMessage = stripMemoryCommandPrefix(message);

  for (const segment of splitCandidateSegments(candidateMessage)) {
    const candidate = extractCandidateFromSegment(segment, context, source, command);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0 && command.type === 'save' && isMeaningfulContent(candidateMessage) && !hasSensitiveSignal(candidateMessage)) {
    const content = `Usuario informou: ${cleanExtractedContent(candidateMessage)}`;
    candidates.push(createCandidate({
      kind: 'user_fact',
      scope: context.defaultScope ?? 'user',
      content,
      evidence: message,
      confidenceScore: 0.95,
      source,
      matchedPhrase: 'salvar na memoria',
      explicit: true,
      supersedeHints: []
    }));
  }

  return dedupeCandidates(candidates);
}

function extractCandidateFromSegment(
  segment: string,
  context: ChatMemoryExtractionContext,
  source: ChatMemorySource,
  command: ChatMemoryCommand
): ChatMemoryCandidate | null {
  if (hasSensitiveSignal(segment)) return createSafetyBoundaryCandidate(context, source, command.explicit);

  const match = findSignal(segment, EXPLICIT_SIGNALS) ?? findSignal(segment, WEAK_SIGNALS);
  if (!match) return null;

  const correctionParts = splitCorrectionContent(match.content);
  const kind = classifyKind(correctionParts.current, match.signal.defaultKind, match.signal.phrase);
  const scope = resolveScope(kind, correctionParts.current, match.signal, context);
  const content = formatCandidateContent(match.signal.phrase, correctionParts.current);

  return createCandidate({
    kind,
    scope,
    content,
    evidence: segment,
    confidenceScore: command.explicit ? Math.max(0.95, match.signal.confidenceScore) : match.signal.confidenceScore,
    status: match.signal.status,
    source,
    matchedPhrase: match.signal.phrase,
    explicit: command.explicit,
    supersedeHints: command.type === 'correct' ? correctionParts.previous : []
  });
}

function createCandidate(input: {
  kind: ChatMemoryKind;
  scope: ChatMemoryScope;
  content: string;
  evidence: string;
  confidenceScore: number;
  status?: ChatMemoryStatus;
  source: ChatMemorySource;
  matchedPhrase: string;
  explicit: boolean;
  supersedeHints: string[];
}): ChatMemoryCandidate {
  const tags = inferTags(input.content);
  return {
    kind: input.kind,
    scope: input.scope,
    content: input.content,
    evidence: [cleanWhitespace(input.evidence)],
    confidenceScore: input.confidenceScore,
    status: input.status ?? 'active',
    source: input.source,
    matchedPhrase: input.matchedPhrase,
    explicit: input.explicit,
    canonicalKey: buildCanonicalKey(input.kind, input.content, input.matchedPhrase, tags),
    tags,
    supersedeHints: input.supersedeHints
  };
}

function findSignal(segment: string, signals: SignalDefinition[]): MatchedSignal | null {
  const normalized = normalizeForMatch(segment);
  for (const signal of signals) {
    const match = signal.pattern.exec(normalized);
    if (!match) continue;
    const captured = match[match.length - 1] ?? '';
    const contentStart = match.index + match[0].length - captured.length;
    const content = cleanExtractedContent(segment.slice(contentStart));
    if (isMeaningfulContent(content)) return { signal, content };
  }
  return null;
}

function classifyKind(content: string, defaultKind: ChatMemoryKind, matchedPhrase: string): ChatMemoryKind {
  const normalized = normalizeForMatch(`${matchedPhrase} ${content}`);
  if (AVATAR_SIGNAL.test(normalized)) return 'avatar_style_signal';
  if (CREATIVE_SIGNAL.test(normalized) && (defaultKind === 'user_preference' || PREFERENCE_SIGNAL.test(normalized))) return 'creative_preference';
  if (WORKFLOW_SIGNAL.test(normalized) && defaultKind === 'user_fact') return 'workflow_rule';
  return defaultKind;
}

function resolveScope(kind: ChatMemoryKind, content: string, signal: SignalDefinition, context: ChatMemoryExtractionContext): ChatMemoryScope {
  if (context.defaultScope) return context.defaultScope;
  if (signal.defaultScope === 'project') return context.projectId ? 'project' : context.sessionId ? 'session' : 'user';
  if (signal.defaultScope) return signal.defaultScope;
  if (kind === 'avatar_style_signal') return 'avatar';
  if (kind === 'project_fact' || PROJECT_SIGNAL.test(normalizeForMatch(content))) {
    return context.projectId ? 'project' : context.sessionId ? 'session' : 'user';
  }
  return signal.status === 'pending_review' ? 'session' : 'user';
}

function formatCandidateContent(phrase: string, content: string): string {
  const templates: Record<string, string> = {
    'nao faca mais': `Nao fazer mais ${content}`,
    'nao gosto de': `Usuario nao gosta de ${content}`,
    'prefiro que': `Usuario prefere que ${content}`,
    'sempre que': `Sempre que ${content}`,
    'nesse projeto': `Neste projeto: ${content}`,
    'gosto de': `Usuario gosta de ${content}`,
    'meu nome': `O nome do usuario e ${content}`,
    'fruta favorita': `A fruta favorita do usuario e ${content}`,
    'cor favorita': `A cor favorita do usuario e ${content}`,
    'da proxima vez': `Da proxima vez, ${content}`,
    'seria melhor': `Seria melhor ${content}`,
    'melhor usar': `Melhor usar ${content}`
  };
  return templates[phrase] ?? content;
}

function splitCorrectionContent(content: string): { current: string; previous: string[] } {
  const normalized = normalizeForMatch(content);
  const separator = /\s*,?\s*(?:mas\s+)?nao\s+(?:gosto\s+)?de\s+(.+)$/.exec(normalized);
  if (!separator) return { current: cleanExtractedContent(content), previous: [] };
  const currentLength = Math.max(0, separator.index);
  return {
    current: cleanExtractedContent(content.slice(0, currentLength)),
    previous: separator[1].split(/\s+(?:e|ou)\s+|,/).map(cleanExtractedContent).filter(Boolean)
  };
}

function inferTags(content: string): string[] {
  const words = normalizeForMatch(content).split(/[^a-z0-9]+/).filter(Boolean);
  const tags = new Set(words.filter((word) => word.length > 3));
  if (words.some((word) => FRUITS.has(word))) {
    tags.add('fruta');
    tags.add('alimentacao');
  }
  if (words.includes('nome')) tags.add('identidade');
  if (words.some((word) => ['cor', 'cores'].includes(word))) tags.add('cor');
  return [...tags];
}

function buildCanonicalKey(kind: ChatMemoryKind, content: string, phrase: string, tags: string[]): string {
  if (phrase === 'meu nome') return 'user:identity:name';
  if (phrase === 'fruta favorita') return 'user:favorite:fruit';
  if (phrase === 'cor favorita') return 'user:favorite:color';
  return `${kind}:${normalizeForMatch(content).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function createSafetyBoundaryCandidate(context: ChatMemoryExtractionContext, source: ChatMemorySource, explicit: boolean): ChatMemoryCandidate {
  return {
    kind: 'safety_boundary',
    scope: context.defaultScope ?? 'session',
    content: 'Conteudo sensivel detectado; nao armazenar valores secretos ou credenciais.',
    evidence: ['[sensitive content redacted]'],
    confidenceScore: 1,
    status: 'rejected',
    source,
    matchedPhrase: 'sensitive_content',
    explicit,
    canonicalKey: 'safety:sensitive-content',
    tags: ['sensivel'],
    supersedeHints: []
  };
}

function stripMemoryCommandPrefix(value: string): string {
  return cleanWhitespace(value)
    .replace(/^\s*(?:por favor\s*,?\s*)?(?:salv(?:e|a)|anot(?:e|a)|guarde|grave|registre)\s+(?:isso\s+)?(?:na|em)\s+(?:sua\s+)?mem[oó]ria\s*[:;,.-]?\s*/i, '')
    .replace(/^\s*(?:por favor\s*,?\s*)?lembr(?:e|a)(?:-se)?\s+(?:que|de)\s*/i, '')
    .replace(/^\s*(?:na verdade|corrij(?:a|o)|correcao|eu quis dizer)\s*[:;,.-]?\s*/i, '');
}

function splitCandidateSegments(message: string): string[] {
  return message.split(/[\r\n]+|[.!?]+\s+|;\s+/).map(cleanWhitespace).filter(Boolean);
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
  return cleanWhitespace(value).replace(/^[,:;"'`-]+/, '').replace(/[.!?]+$/, '').trim();
}

function cleanWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeForMatch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function dedupeCandidates(candidates: ChatMemoryCandidate[]): ChatMemoryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.kind}:${candidate.scope}:${normalizeForMatch(candidate.content)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
