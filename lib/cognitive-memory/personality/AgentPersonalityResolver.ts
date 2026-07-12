import type { ChatMemoryRecord } from '../types/memory';

export interface PersonalityResolutionContext {
  avatarId?: string;
  avatarPersonality?: Record<string, unknown> | null;
  activeMemories?: ChatMemoryRecord[];
}

export class AgentPersonalityResolver {
  private static readonly ALLOWED_MEMORY_KINDS = new Set([
    'avatar_style_signal',
    'creative_preference',
    'correction',
    'user_preference'
  ]);

  public static resolve(context: PersonalityResolutionContext): string {
    const basePersonality = `Você é o Sr. Chicken, um assistente virtual e chatbot inteligente para o 'AI UGC Reaction Studio'.
Sua personalidade padrão é:
- Direta e pragmática
- Técnica quando o assunto exigir (desenvolvimento, IA, fluxos)
- Criativa quando o usuário pedir (roteiros, ideias, campanhas)
- Sem uso de um personagem exagerado ou caricato
- Responda sempre em português.`;

    let resolved = basePersonality;

    if (context.avatarPersonality) {
      // Remover campos não relacionados diretamente ao tom de conversa (como já era feito)
      const cleanPersonality = { ...context.avatarPersonality };
      delete cleanPersonality.instructions;
      delete cleanPersonality.target_audience;

      resolved += `\n\nInstrução especial: O usuário selecionou um Avatar com a seguinte personalidade. Tente adaptar sutilmente seu tom de voz e estilo para sintonizar com ela, mas sem perder seu pragmatismo de assistente:\n${JSON.stringify(cleanPersonality, null, 2)}`;
    }

    if (context.activeMemories && context.activeMemories.length > 0) {
      const personalityMemories = context.activeMemories.filter(
        (m) => m.status === 'active' && this.ALLOWED_MEMORY_KINDS.has(m.kind)
      );

      if (personalityMemories.length > 0) {
        resolved += `\n\n[Preferências e Ajustes de Tom Aprendidos]:\nConsidere as seguintes diretrizes para o seu comportamento nesta conversa:\n`;
        for (const mem of personalityMemories) {
          resolved += `- ${mem.content}\n`;
        }
      }
    }

    return resolved;
  }
}
