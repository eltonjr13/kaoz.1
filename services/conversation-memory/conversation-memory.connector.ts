import { detectChatMemoryCommand, extractChatMemoryCandidates } from "../../lib/cognitive-memory/chat/ChatMemoryExtractor.ts";
import { ChatMemoryService } from "../../lib/cognitive-memory/chat/ChatMemoryService.ts";
import { JsonStorageProvider } from "../../lib/cognitive-memory/storage/JsonStorageProvider.ts";
import { scheduleConversationConsolidation } from "./conversation-memory.consolidator.ts";
import { recallArchivedConversations } from "./conversation-memory.recall.ts";
import { getConversationMemoryStore, type ConversationMemoryStore } from "./conversation-memory.store.ts";
import type { ConversationChannel } from "./conversation-memory.types.ts";

async function executeMemoryOperations(
  prompt: string,
  channel: Extract<ConversationChannel, "telegram" | "discord">,
  profileId: string,
  conversationId: string,
  messageId: string,
  service: ChatMemoryService
): Promise<string> {
  const command = detectChatMemoryCommand(prompt);
  let receipt = "";

  if (command.type === 'forget') {
    const forgotten = await service.forgetMemories(command.target, { userId: profileId });
    receipt = forgotten ? 'A solicitacao de esquecimento foi concluida.' : 'Nenhuma memoria correspondente foi encontrada.';
  }

  const source = channel === "telegram" ? "telegram_chat" : "discord_chat";
  const candidates = extractChatMemoryCandidates(prompt, "", { source }).map((candidate) => ({
    ...candidate,
    evidenceRefs: [{ conversationId, messageId }],
  }));

  if (candidates.length) {
    const result = await service.saveChatMemoryCandidates(candidates, { userId: profileId });
    if (command.explicit) {
      receipt = result.blockedSensitive ? 'O conteudo nao foi salvo porque parece sensivel.' : 'A operacao de memoria foi concluida.';
    }
  }

  return receipt;
}

function assembleMemoryContext(
  hot: { personalFacts: string; contextualFacts: string },
  coldContext: string,
  receipt: string
): string {
  return [
    hot.personalFacts ? `[FATOS CONFIRMADOS DO USUARIO]\n${hot.personalFacts}` : "",
    hot.contextualFacts ? `[MEMORIAS CONTEXTUAIS]\n${hot.contextualFacts}` : "",
    coldContext,
    receipt ? `[RESULTADO DA OPERACAO DE MEMORIA]\n${receipt}\nNao afirme resultado diferente.` : '',
  ].filter(Boolean).join("\n\n");
}

export async function prepareConnectorConversation(input: {
  channel: Extract<ConversationChannel, "telegram" | "discord">;
  accountId: string;
  externalUserId: string;
  username?: string;
  externalConversationId: string;
  conversationTitle?: string;
  messageId: string;
  prompt: string;
}): Promise<{ profileId: string; recent: Array<{ role: "user" | "assistant"; content: string }>; memoryContext: string }> {
  const store = getConversationMemoryStore();
  const identity = store.observeIdentity(input);
  const conversationId = store.resolveConversationId(input.channel, input.accountId, input.externalConversationId);
  const recent = store.getRecentTurns(conversationId, 6).map(({ role, content }) => ({ role, content }));
  const archived = store.upsertMessage({ ...input, role: "user", content: input.prompt });
  if (archived.consolidationJobCreated) scheduleConversationConsolidation();

  const service = new ChatMemoryService(new JsonStorageProvider());
  const receipt = await executeMemoryOperations(
    input.prompt,
    input.channel,
    identity.effectiveProfileId,
    conversationId,
    archived.message.id,
    service
  );

  const hot = await service.buildPromptContext(input.prompt, { userId: identity.effectiveProfileId });
  const cold = recallArchivedConversations({ query: input.prompt, profileId: identity.effectiveProfileId, excludeConversationId: conversationId });
  const memoryContext = assembleMemoryContext(hot, cold.context, receipt);

  return { profileId: identity.effectiveProfileId, recent, memoryContext };
}

export function archiveConnectorReply(input: {
  channel: Extract<ConversationChannel, "telegram" | "discord">;
  accountId: string;
  externalUserId: string;
  username?: string;
  externalConversationId: string;
  conversationTitle?: string;
  messageId: string;
  content: string;
}): void {
  getConversationMemoryStore().upsertMessage({ ...input, role: "assistant" });
}

export function resetConnectorConversation(input: {
  channel: Extract<ConversationChannel, "telegram" | "discord">;
  accountId: string;
  externalConversationId: string;
}, store: ConversationMemoryStore = getConversationMemoryStore()): { deleted: boolean; messageIds: string[] } {
  const conversationId = store.resolveConversationId(input.channel, input.accountId, input.externalConversationId);
  return store.deleteConversation(conversationId);
}
