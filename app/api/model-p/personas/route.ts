import { NextResponse } from 'next/server';
import { PersonaStore } from '@/lib/model-p/persona-store';
import { synthesizePersonaProfile } from '@/lib/model-p/persona-extractor';
import { buildPersonaTrainingExamples, filterParticipantMessages } from '@/lib/model-p/chat-parser';
import type { ParsedChatMessage, PersonaRole } from '@/lib/model-p/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const store = PersonaStore.getInstance();
    const personas = await store.listPersonas();
    return NextResponse.json({ personas });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface CreatePersonaBody {
  targetParticipant?: string;
  role?: PersonaRole;
  messages?: string[];
  conversationMessages?: ParsedChatMessage[];
}

const VALID_ROLES = new Set<PersonaRole>(['simulator', 'user_clone', 'custom']);
const MAX_TRAINING_MESSAGES = 20_000;
const MAX_MESSAGE_CHARS = 10_000;

function isValidConversationMessage(message: unknown): message is ParsedChatMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as Partial<ParsedChatMessage>;
  return typeof candidate.id === 'string' &&
    typeof candidate.timestamp === 'string' &&
    typeof candidate.sender === 'string' &&
    typeof candidate.content === 'string' &&
    candidate.content.trim().length > 0 &&
    candidate.content.length <= MAX_MESSAGE_CHARS;
}

function sanitizeConversationMessages(value: unknown): ParsedChatMessage[] {
  return Array.isArray(value)
    ? value.filter(isValidConversationMessage).slice(0, MAX_TRAINING_MESSAGES)
    : [];
}

function sanitizeLegacyMessages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((message): message is string =>
    typeof message === 'string' && message.trim().length > 0 && message.length <= MAX_MESSAGE_CHARS
  ).slice(0, MAX_TRAINING_MESSAGES);
}

function validateCreatePersonaInput(body: CreatePersonaBody | null): {
  targetParticipant: string;
  role: PersonaRole;
  messages: string[];
  conversationMessages: ParsedChatMessage[];
} {
  const targetParticipant = body?.targetParticipant?.trim() || '';
  const requestedRole = body?.role || 'simulator';
  const role = VALID_ROLES.has(requestedRole) ? requestedRole : 'simulator';
  const conversationMessages = sanitizeConversationMessages(body?.conversationMessages);
  const messages = conversationMessages.length > 0
    ? filterParticipantMessages(conversationMessages, targetParticipant).map((message) => message.content)
    : sanitizeLegacyMessages(body?.messages);

  return { targetParticipant, role, messages, conversationMessages };
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as CreatePersonaBody | null;
    const { targetParticipant, role, messages, conversationMessages } = validateCreatePersonaInput(body);

    if (!targetParticipant) {
      return NextResponse.json({ error: 'targetParticipant é obrigatório' }, { status: 400 });
    }

    if (messages.length === 0) {
      return NextResponse.json({ error: 'Nenhuma mensagem válida da pessoa selecionada para análise' }, { status: 400 });
    }

    const trainingExamples = buildPersonaTrainingExamples(conversationMessages, targetParticipant);
    const persona = await synthesizePersonaProfile(targetParticipant, role, messages, trainingExamples);
    const store = PersonaStore.getInstance();
    await store.savePersona(persona);

    return NextResponse.json({ persona });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
