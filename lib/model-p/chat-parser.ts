import type {
  ChatParticipantSummary,
  ParsedChatMessage,
  ParsedChatResult,
  PersonaTrainingExample,
} from './types.ts';

// Android format: 12/03/2024, 14:30 - Sender: message
// or 12/03/24 14:30 - Sender: message
// or 03/12/2024, 2:30 PM - Sender: message
const ANDROID_HEADER_REGEX = /^(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:,\s*|\s+)\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\s*-\s*([^:]+):\s*(.*)$/;

// iOS format: [12/03/2024, 14:30:15] Sender: message
// or [12/03/24 14:30] Sender: message
const IOS_HEADER_REGEX = /^\[(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:,\s*|\s+)\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]\s*([^:]+):\s*(.*)$/;
const ANDROID_SYSTEM_REGEX = /^(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:,\s*|\s+)\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\s*-\s*(.*)$/;
const IOS_SYSTEM_REGEX = /^\[(\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}(?:,\s*|\s+)\d{1,2}:\d{2}(?::\d{2})?(?:\s*[AaPp][Mm])?)\]\s*(.*)$/;

const SYSTEM_PATTERNS = [
  /criptografia de ponta a ponta/i,
  /end-to-end encrypt/i,
  /arquivo de m[ií]dia oculto/i,
  /<media omitted>/i,
  /(?:imagem|m[ií]dia|[aá]udio|v[ií]deo|figurinha|sticker) (?:ocult[ao]|ocultada|omitid[ao])/i,
  /(?:image|media|audio|video|sticker) omitted/i,
  /mensagem apagada/i,
  /message was deleted/i,
  /chamada de (?:voz|v[ií]deo) perdida/i,
  /missed (?:voice|video) call/i,
  /mudou o tema/i,
  /entrou usando o link/i,
  /saiu do grupo/i,
  /adicionou/i,
];

function isSystemMessage(content: string): boolean {
  return SYSTEM_PATTERNS.some((pattern) => pattern.test(content));
}

function isStandaloneSystemLine(line: string): boolean {
  const match = line.trim().match(IOS_SYSTEM_REGEX) || line.trim().match(ANDROID_SYSTEM_REGEX);
  return Boolean(match && isSystemMessage(match[2]));
}

interface MatchHeaderResult {
  timestamp: string;
  sender: string;
  firstLine: string;
}

function matchMessageHeader(line: string): MatchHeaderResult | null {
  const trimmed = line.trim();
  const iosMatch = trimmed.match(IOS_HEADER_REGEX);
  if (iosMatch) {
    return {
      timestamp: iosMatch[1].trim(),
      sender: iosMatch[2].trim(),
      firstLine: iosMatch[3].trim(),
    };
  }

  const androidMatch = trimmed.match(ANDROID_HEADER_REGEX);
  if (androidMatch) {
    return {
      timestamp: androidMatch[1].trim(),
      sender: androidMatch[2].trim(),
      firstLine: androidMatch[3].trim(),
    };
  }

  return null;
}

function pushCurrentMessage(messages: ParsedChatMessage[], current: ParsedChatMessage | null): void {
  if (current && !isSystemMessage(current.content)) messages.push(current);
}

export function parseWhatsAppChat(rawText: string): ParsedChatResult {
  const lines = rawText.split(/\r?\n/);
  const messages: ParsedChatMessage[] = [];
  let currentMsg: ParsedChatMessage | null = null;
  let counter = 0;

  for (const line of lines) {
    const header = matchMessageHeader(line);
    if (header) {
      pushCurrentMessage(messages, currentMsg);
      counter += 1;
      currentMsg = {
        id: `chat-msg-${counter}`,
        timestamp: header.timestamp,
        sender: header.sender,
        content: header.firstLine,
      };
    } else if (isStandaloneSystemLine(line)) {
      pushCurrentMessage(messages, currentMsg);
      currentMsg = null;
    } else if (currentMsg) {
      currentMsg.content = `${currentMsg.content}\n${line}`.trim();
    }
  }

  pushCurrentMessage(messages, currentMsg);

  const participants = buildParticipantSummaries(messages);

  return {
    participants,
    totalMessages: messages.length,
    messages,
  };
}

function buildParticipantSummaries(messages: ParsedChatMessage[]): ChatParticipantSummary[] {
  const map = new Map<string, { count: number; words: number; samples: string[] }>();

  for (const msg of messages) {
    const sender = msg.sender;
    const words = msg.content.split(/\s+/).filter(Boolean).length;
    const existing = map.get(sender) || { count: 0, words: 0, samples: [] };

    existing.count += 1;
    existing.words += words;
    if (existing.samples.length < 3 && msg.content.length > 5) {
      existing.samples.push(msg.content.slice(0, 140));
    }
    map.set(sender, existing);
  }

  return Array.from(map.entries())
    .map(([name, data]) => ({
      name,
      messageCount: data.count,
      wordCount: data.words,
      sampleLines: data.samples,
    }))
    .sort((a, b) => b.messageCount - a.messageCount);
}

/**
 * Isolates ONLY messages from the target participant.
 * Ensures strict segregation so other participants' messages never contaminate style analysis.
 */
export function filterParticipantMessages(
  messages: ParsedChatMessage[],
  targetName: string
): ParsedChatMessage[] {
  const normalizedTarget = targetName.toLowerCase().trim();
  return messages.filter(
    (msg) =>
      msg.sender.toLowerCase().trim() === normalizedTarget &&
      msg.content.length > 0 &&
      !isSystemMessage(msg.content)
  );
}

/**
 * Preserves how the selected participant responded to the preceding messages.
 * Consecutive messages from the participant are grouped into the same output,
 * matching the fragmented cadence commonly found in chat exports.
 */
export function buildPersonaTrainingExamples(
  messages: ParsedChatMessage[],
  targetName: string,
  limit = 500
): PersonaTrainingExample[] {
  const normalizedTarget = targetName.toLowerCase().trim();
  const examples: PersonaTrainingExample[] = [];
  let pendingContext: ParsedChatMessage[] = [];

  for (const message of messages) {
    const isTarget = message.sender.toLowerCase().trim() === normalizedTarget;
    if (!isTarget) {
      pendingContext = [...pendingContext, message].slice(-3);
      continue;
    }

    if (pendingContext.length > 0) {
      examples.push({
        id: `persona-example-${message.id}`,
        input: pendingContext.map((item) => `${item.sender}: ${item.content}`).join('\n'),
        output: message.content,
        sourceTimestamp: message.timestamp,
      });
      pendingContext = [];
    } else if (examples.length > 0) {
      const previous = examples[examples.length - 1];
      previous.output = `${previous.output}\n${message.content}`;
    }

    if (examples.length >= limit) break;
  }

  return examples;
}
