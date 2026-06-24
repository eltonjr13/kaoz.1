import { GoogleGenAI } from '@google/genai';
import { EventBus } from '../core/EventBus';
import type { EpisodicMemoryNode, ProceduralRule } from '../types/memory';
import type { GraphNode, GraphEdge } from '../types/graph';
import { JsonStorageProvider } from '../storage/JsonStorageProvider';
import { SemanticMemory } from '../subsystems/SemanticMemory';
import { ProceduralMemory } from '../subsystems/ProceduralMemory';

export class Reflector {
  private ai: GoogleGenAI | null = null;
  private storage = new JsonStorageProvider();
  private semantic = new SemanticMemory(this.storage);
  private procedural = new ProceduralMemory(this.storage);

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      this.ai = new GoogleGenAI({ apiKey });
    }
    this.setupBusListeners();
  }

  private setupBusListeners() {
    const bus = EventBus.getInstance();
    
    // Ouvinte para novos episódios gravados
    bus.subscribe('EPISODE_RECORDED', async (episode: EpisodicMemoryNode) => {
      if (episode.status === 'failure') {
        await this.reflectOnFailure(episode);
      }
    });

    // Ouvinte para atualizações de feedback do usuário
    bus.subscribe('EPISODE_UPDATED', async (episode: EpisodicMemoryNode) => {
      if (episode.userFeedback === 'bad') {
        await this.reflectOnFailure(episode, true);
      } else if (episode.userFeedback === 'good') {
        await this.reflectOnSuccess(episode);
      }
    });
  }

  private async reflectOnFailure(episode: EpisodicMemoryNode, fromUserFeedback = false) {
    if (!this.ai) {
      console.warn("[Reflector] Gemini API Key não configurada. Pulando reflexão de falha.");
      return;
    }

    const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const reason = fromUserFeedback ? 'O usuário avaliou o resultado como RUIM (feedback negativo)' : `Erro de execução: "${episode.errorMessage || 'Falha desconhecida'}"`;

    const prompt = `
Você é o Reflector Engine do sistema de memória cognitiva do MrChicken.
Sua tarefa é analisar uma falha e extrair conhecimentos preventivos estruturados em JSON para evitar que o agente repita esse erro.

[DADOS DO EPISÓDIO]:
- Avatar ID: ${episode.avatarId}
- Tipo de Tarefa: ${episode.taskType}
- Prompt Utilizado: "${episode.inputPrompt}"
- Resumo da Saída: "${episode.outputSummary}"
- Causa da Falha: ${reason}
- Modelo Utilizado: ${episode.modelUsed}

Sua resposta DEVE ser estritamente um objeto JSON contendo:
1. "errorConcept": Um ID curto e slugificado que represente o conceito do erro (ex: "concept:imagefx-timeout", "concept:collage-layout-error").
2. "errorLabel": Nome curto legível do erro (ex: "Estouro de tempo no ImageFX", "Erro de colagem de imagem").
3. "errorDescription": Descrição detalhada do que causou esse erro.
4. "preventiveInstruction": Uma regra operacional curta em português que o agente deve seguir da próxima vez para evitar essa falha (ex: "Não use a palavra colagem no prompt para evitar grids", "Aumente o timeout do locator para 30s").

MUITO IMPORTANTE: Retorne apenas o JSON bruto, sem blocos de código markdown (\`\`\`json).
`;

    try {
      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const text = response.text?.trim() || '{}';
      const result = JSON.parse(text);

      if (result.errorConcept && result.preventiveInstruction) {
        const errorNodeId = result.errorConcept.startsWith('concept:') ? result.errorConcept : `concept:${result.errorConcept}`;
        
        // 1. Cria/atualiza o nó de erro no grafo semântico
        const errorNode: GraphNode = {
          id: errorNodeId,
          label: result.errorLabel || 'Falha Operacional',
          type: 'error-pattern',
          description: result.errorDescription || 'Erro de execução mapeado',
          confidenceScore: 0.8,
          lastObserved: new Date().toISOString(),
          metadata: {
            taskType: episode.taskType,
            modelUsed: episode.modelUsed,
            lastTriggerPrompt: episode.inputPrompt
          }
        };
        await this.semantic.upsertNode(errorNode);

        // 2. Cria o nó correspondente ao modelo utilizado (caso não exista)
        const modelNodeId = `concept:model-${episode.modelUsed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const modelNode: GraphNode = {
          id: modelNodeId,
          label: `Modelo ${episode.modelUsed}`,
          type: 'entity',
          description: `IA geradora ${episode.modelUsed}`,
          confidenceScore: 1.0,
          lastObserved: new Date().toISOString(),
          metadata: {}
        };
        await this.semantic.upsertNode(modelNode);

        // 3. Cria relacionamento (Edge) indicando a falha
        const edgeId = `edge:${modelNodeId}->${errorNodeId}`;
        const edge: GraphEdge = {
          id: edgeId,
          source: modelNodeId,
          target: errorNodeId,
          relation: 'causes_failure',
          weight: 0.6,
          confidenceScore: 0.7,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        };
        await this.semantic.upsertEdge(edge);

        // 4. Cria a regra procedimental preventiva na memória
        const ruleId = `rule:prevent-${errorNodeId.replace('concept:', '')}`;
        const rule: ProceduralRule = {
          id: ruleId,
          avatarId: episode.avatarId,
          projectId: episode.projectId,
          sessionId: episode.sessionId,
          scope: episode.taskType,
          triggerPattern: episode.taskType,
          actionType: 'modify_prompt',
          instruction: result.preventiveInstruction,
          confidenceScore: 0.6,
          successCount: 0,
          failureCount: 1,
          lastUpdated: new Date().toISOString(),
          timestamp: new Date().toISOString()
        };
        await this.procedural.addRule(rule);

        console.info(`[Reflector] Sucesso ao refletir na falha. Criada regra de prompt: "${result.preventiveInstruction}"`);
      }
    } catch (err) {
      console.error("[Reflector] Falha no processamento da reflexão de erro:", err);
    }
  }

  private async reflectOnSuccess(episode: EpisodicMemoryNode) {
    // Quando o usuário dá feedback positivo, reforçamos as regras procedimentais associadas a este avatar/tipo de tarefa
    try {
      const data = await this.storage.readMemory();
      const rules = data.procedural.rules.filter(
        (r) => r.avatarId === episode.avatarId && r.scope === episode.taskType
      );

      for (const rule of rules) {
        await this.procedural.reinforceRule(rule.id, 'success');
      }

      // Incrementa também a confiança dos relacionamentos de modelo no grafo semântico
      const modelNodeId = `concept:model-${episode.modelUsed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const edges = data.semantic.edges.filter(
        (e) => e.source === modelNodeId && e.relation === 'improves_quality'
      );

      for (const edge of edges) {
        await this.semantic.upsertEdge({
          ...edge,
          weight: Math.min(1.0, edge.weight + 0.1) // Reforço positivo simples
        });
      }

      console.info(`[Reflector] Sucesso ao processar feedback positivo para o avatar: ${episode.avatarId}`);
    } catch (err) {
      console.error("[Reflector] Erro ao processar reforço de sucesso:", err);
    }
  }
}

// Instancia para iniciar a escuta global do EventBus
export const reflector = new Reflector();
