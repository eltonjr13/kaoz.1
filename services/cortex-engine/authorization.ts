/**
 * Autorização de evidências.
 *
 * Dados excluídos não podem continuar acessíveis por replay, e a revalidação
 * acontece ANTES da materialização do texto final para cobrir exclusões
 * concorrentes (plano, seções 8 e 11).
 */

import {
  ChatMemoryService,
  LOCAL_MEMORY_USER_ID,
} from "../../lib/cognitive-memory/chat/ChatMemoryService.ts";
import { JsonStorageProvider } from "../../lib/cognitive-memory/storage/JsonStorageProvider.ts";

/**
 * Função de autorização atual: responde se um ID de memória ainda pode ser usado.
 *
 * Memórias do chat valem pelo status ativo. Evidências do arquivo de conversas
 * são revalidadas pela própria busca (a linha excluída deixa de aparecer), e por
 * isso não entram no conjunto local — mas nunca são dadas como garantidas.
 */
export async function currentAuthorization(): Promise<(id: string) => boolean> {
  const authorized = new Set<string>();
  try {
    const storage = new JsonStorageProvider();
    const service = new ChatMemoryService(storage);
    const memories = await service.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      includeHistory: true,
    });
    for (const memory of memories) {
      if (memory.status === "active" || memory.status === "pending_review") {
        authorized.add(memory.id);
      }
    }
  } catch {
    // Sem armazenamento legível, nada é dado como autorizado.
  }
  return (id: string) => authorized.has(id);
}
