/**
 * Autorização de evidências.
 *
 * Dados excluídos não podem continuar acessíveis por replay, e a revalidação
 * acontece ANTES da materialização do texto final para cobrir exclusões
 * concorrentes (plano, seções 8 e 11).
 *
 * Fonte única: o conjunto de IDs utilizáveis é lido uma vez e consumido tanto
 * pela revalidação da recuperação quanto pelo detalhe de um rastro.
 */

import {
  ChatMemoryService,
  LOCAL_MEMORY_USER_ID,
} from "../../lib/cognitive-memory/chat/ChatMemoryService.ts";
import { JsonStorageProvider } from "../../lib/cognitive-memory/storage/JsonStorageProvider.ts";

/**
 * IDs de memória que ainda podem ser usados agora.
 *
 * Memórias rejeitadas ou excluídas ficam de fora. Falha de leitura devolve um
 * conjunto vazio: é preferível cair no caminho anterior a publicar uma memória
 * que pode ter sido removida.
 */
export async function listUsableMemoryIds(): Promise<Set<string>> {
  try {
    const service = new ChatMemoryService(new JsonStorageProvider());
    const memories = await service.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      includeHistory: true,
    });
    return new Set(
      memories
        .filter(
          (memory) => memory.status === "active" || memory.status === "pending_review"
        )
        .map((memory) => memory.id)
    );
  } catch {
    return new Set();
  }
}

/** Predicado por ID, para o detalhe de um rastro. */
export async function currentAuthorization(): Promise<(id: string) => boolean> {
  const usable = await listUsableMemoryIds();
  return (id: string) => usable.has(id);
}
