import { GoogleGenAI } from '@google/genai';
import { EventBus } from '../core/EventBus';
import type { EpisodicMemoryNode, ProceduralRule } from '../types/memory';
import type { GraphNode, GraphEdge } from '../types/graph';
import { JsonStorageProvider } from '../storage/JsonStorageProvider';
import { CerebralCortex } from '../subsystems/CerebralCortex';
import { PrefrontalCortex } from '../subsystems/PrefrontalCortex';

export class Reflector {
  private ai: GoogleGenAI | null = null;
  private storage = new JsonStorageProvider();
  private cerebralCortex = new CerebralCortex(this.storage);
  private prefrontalCortex = new PrefrontalCortex(this.storage);

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
      } else if (episode.status === 'success') {
        await this.reflectOnSuccessEpisode(episode);
      }
    });

    // Ouvinte para atualizações de feedback do usuário
    bus.subscribe('EPISODE_UPDATED', async (episode: EpisodicMemoryNode) => {
      if (episode.userFeedback === 'bad') {
        await this.reflectOnFailure(episode, true);
      } else if (episode.userFeedback === 'good') {
        await this.reflectOnUserPositiveFeedback(episode);
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
Você é o Reflector Engine do sistema de memória cognitiva do Kaoz.1.
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
        await this.cerebralCortex.upsertNode(errorNode);

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
        await this.cerebralCortex.upsertNode(modelNode);

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
        await this.cerebralCortex.upsertEdge(edge);

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
        await this.prefrontalCortex.addRule(rule);

        console.info(`[Reflector] Sucesso ao refletir na falha. Criada regra de prompt: "${result.preventiveInstruction}"`);
      }
    } catch (err) {
      console.error("[Reflector] Falha no processamento da reflexão de erro:", err);
    }
  }

  /**
   * Reflexão automática em episódios de sucesso — cria nós tool-outcome no grafo
   * Esta versão leve não usa LLM, apenas cria nós baseados nos metadados do episódio
   */
  private async reflectOnSuccessEpisode(episode: EpisodicMemoryNode) {
    try {
      const modelSlug = episode.modelUsed.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const taskSlug = episode.taskType.replace(/[^a-z0-9]+/g, '-');
      const successNodeId = `tool-outcome:${modelSlug}-${taskSlug}-success`;

      const successNode: GraphNode = {
        id: successNodeId,
        label: `✓ ${episode.taskType} via ${episode.modelUsed}`,
        type: 'tool-outcome',
        description: episode.outputSummary || `Execução bem-sucedida de ${episode.taskType} usando ${episode.modelUsed}.`,
        confidenceScore: 0.85,
        lastObserved: new Date().toISOString(),
        metadata: {
          taskType: episode.taskType,
          modelUsed: episode.modelUsed,
          avatarId: episode.avatarId,
          successCount: 1,
          lastSuccessAt: new Date().toISOString()
        }
      };
      await this.cerebralCortex.upsertNode(successNode);

      // Conecta o modelo ao sucesso
      const modelNodeId = `concept:model-${modelSlug}`;
      const edgeId = `edge:${modelNodeId}->${successNodeId}`;
      const edge: GraphEdge = {
        id: edgeId,
        source: modelNodeId,
        target: successNodeId,
        relation: 'improves_quality',
        weight: 0.7,
        confidenceScore: 0.85,
        occurrences: 1,
        lastReinforced: new Date().toISOString()
      };
      await this.cerebralCortex.upsertEdge(edge);

      console.info(`[Reflector] Nó de sucesso criado no grafo: ${successNodeId}`);
    } catch (err) {
      console.error("[Reflector] Erro ao criar nó de sucesso no grafo:", err);
    }
  }

  /**
   * Quando o usuário dá feedback positivo explícito (thumbs up):
   * 1. Reforça regras procedimentais
   * 2. Usa Gemini para extrair aprendizado de alta qualidade e criar nó tool-outcome rico
   */
  private async reflectOnUserPositiveFeedback(episode: EpisodicMemoryNode) {
    // Reforça regras procedimentais associadas
    try {
      const data = await this.storage.readMemory();
      const rules = data.procedural.rules.filter(
        (r) => r.avatarId === episode.avatarId && r.scope === episode.taskType
      );

      for (const rule of rules) {
        await this.prefrontalCortex.reinforceRule(rule.id, 'success');
      }

      // Reforça arestas de qualidade no grafo semântico
      const modelNodeId = `concept:model-${episode.modelUsed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const edges = data.semantic.edges.filter(
        (e) => e.source === modelNodeId && e.relation === 'improves_quality'
      );

      for (const edge of edges) {
        await this.cerebralCortex.upsertEdge({
          ...edge,
          weight: Math.min(1.0, edge.weight + 0.1)
        });
      }

      console.info(`[Reflector] Sucesso ao processar feedback positivo para o avatar: ${episode.avatarId}`);
    } catch (err) {
      console.error("[Reflector] Erro ao processar reforço de sucesso:", err);
    }

    // Usa Gemini para extrair aprendizado rico (se disponível)
    if (!this.ai) return;

    try {
      const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const prompt = `
Você é o Reflector Engine do sistema de memória cognitiva do Kaoz.1.
O usuário avaliou um resultado como EXCELENTE (feedback positivo).
Extraia um aprendizado reutilizável deste episódio de sucesso.

[DADOS DO EPISÓDIO]:
- Avatar ID: ${episode.avatarId}
- Tipo de Tarefa: ${episode.taskType}
- Prompt Utilizado: "${episode.inputPrompt}"
- Resumo da Saída: "${episode.outputSummary}"
- Modelo Utilizado: ${episode.modelUsed}

Sua resposta DEVE ser estritamente um objeto JSON contendo:
1. "successConcept": ID curto slugificado do conceito de sucesso (ex: "tool-outcome:imagefx-portrait-approved").
2. "successLabel": Nome curto legível (ex: "Retrato aprovado via ImageFX").
3. "successDescription": Por que essa execução foi bem-sucedida e o que pode ser replicado.
4. "replicableInstruction": Instrução concreta em português que o agente deve seguir para replicar este sucesso.

MUITO IMPORTANTE: Retorne apenas o JSON bruto, sem blocos de código markdown.
`;

      const response = await this.ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const text = response.text?.trim() || '{}';
      const result = JSON.parse(text);

      if (result.successConcept && result.replicableInstruction) {
        const successNodeId = result.successConcept.startsWith('tool-outcome:')
          ? result.successConcept
          : `tool-outcome:${result.successConcept}`;

        const successNode: GraphNode = {
          id: successNodeId,
          label: result.successLabel || 'Sucesso Operacional',
          type: 'tool-outcome',
          description: result.successDescription || 'Execução bem avaliada pelo usuário.',
          confidenceScore: 1.0,
          lastObserved: new Date().toISOString(),
          metadata: {
            taskType: episode.taskType,
            modelUsed: episode.modelUsed,
            avatarId: episode.avatarId,
            replicableInstruction: result.replicableInstruction,
            fromUserFeedback: true,
            approvedAt: new Date().toISOString()
          }
        };
        await this.cerebralCortex.upsertNode(successNode);

        // Conecta o modelo ao sucesso com relação de qualidade
        const modelNodeId = `concept:model-${episode.modelUsed.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
        const edgeId = `edge:${modelNodeId}->${successNodeId}`;
        const edge: GraphEdge = {
          id: edgeId,
          source: modelNodeId,
          target: successNodeId,
          relation: 'improves_quality',
          weight: 0.9,
          confidenceScore: 1.0,
          occurrences: 1,
          lastReinforced: new Date().toISOString()
        };
        await this.cerebralCortex.upsertEdge(edge);

        // Cria regra procedimental de replicação de sucesso
        const ruleId = `rule:replicate-${successNodeId.replace('tool-outcome:', '')}`;
        const rule: ProceduralRule = {
          id: ruleId,
          avatarId: episode.avatarId,
          projectId: episode.projectId,
          sessionId: episode.sessionId,
          scope: episode.taskType,
          triggerPattern: episode.taskType,
          actionType: 'modify_prompt',
          instruction: result.replicableInstruction,
          confidenceScore: 0.9,
          successCount: 1,
          failureCount: 0,
          lastUpdated: new Date().toISOString(),
          timestamp: new Date().toISOString()
        };
        await this.prefrontalCortex.addRule(rule);

        console.info(`[Reflector] Aprendizado de sucesso gravado no grafo: "${result.replicableInstruction}"`);
      }
    } catch (err) {
      console.error("[Reflector] Falha ao processar reflexão de feedback positivo com Gemini:", err);
    }
  }
}

// Instancia para iniciar a escuta global do EventBus
export const reflector = new Reflector();
