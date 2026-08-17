import { NextResponse } from "next/server";
import {
  chatWithAgent,
  isActionContinuationRequest,
  isImmediateContextReference,
} from "@/lib/ai/gemini";
import type { ChatAgentResponse, ChatMessage } from "@/lib/ai/gemini";
import { flowProvider } from "@/src/providers/flow/FlowProvider";
import {
  cleanupTemporaryReference,
  saveBase64ReferenceImage,
} from "@/lib/flow/reference-files";
import { detectChatMemoryCommand, extractChatMemoryCandidates } from "@/lib/cognitive-memory/chat/ChatMemoryExtractor";
import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from "@/lib/cognitive-memory/chat/ChatMemoryService";
import { JsonStorageProvider } from "@/lib/cognitive-memory/storage/JsonStorageProvider";
import type { ChatMemoryRecord } from "@/lib/cognitive-memory/types/memory";
import { getAgentVoiceContext, getAgentVoiceInstruction, getVoiceExpressionContext } from "@/lib/ai/agent-voice";
import { prepareCharacterRuntime, recordCharacterTurn } from "@/lib/agent-personality/runtime";
import { materializeResponseArtifacts, registerContentArtifact } from "@/services/artifacts/artifact.service";
import { buildSkillPromptContext, resolveSkillInvocation, skillRegistry } from "@/services/skills/skill.registry";
import { allowsMediaAction, classifyOutputIntent, type OutputIntent } from "@/services/artifacts/artifact.intent";
import { connectorPublishProvider } from "@/services/agent-llm/agent-llm.prompt";
import { extractMcpMention } from "@/services/mcp/mcp-mention";
import { extractToolApprovalToken } from "@/services/tools/tool-approval.service";
import { getConversationMemoryStore, LOCAL_PROFILE_ID as LOCAL_ARCHIVE_PROFILE_ID } from "@/services/conversation-memory/conversation-memory.store";
import { recallArchivedConversations } from "@/services/conversation-memory/conversation-memory.recall";
import { scheduleConversationConsolidation } from "@/services/conversation-memory/conversation-memory.consolidator";
import type { ImageGenerationOperation } from "@/src/providers/flow/ImageGenerationContract";
import type { FlowImageAspectRatio } from "@/lib/ai/image-prompt-engineering";
import {
  autonomousGoalStore,
  parseGoalCommand,
  type AutonomousGoal,
} from "@/services/goals";
import {
  createWarRoomSession,
  isWarRoomCommand,
  extractWarRoomTopic,
  buildAgentTurn,
  WAR_ROOM_AGENT_PROFILES,
  type WarRoomSession,
} from "@/services/agents";
import { createCampaignProductionSpec } from "@/services/campaign-production";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // Allow long-running agent tasks

type FlowChatRequestBody = {
  messages: ChatMessage[];
  model?: string;
  referenceImage?: string;
  requestedFlow?: 'image' | 'video' | 'ad-creative';
  imageOperation?: ImageGenerationOperation;
  imageAspectRatio?: FlowImageAspectRatio;
  useCortexMemory?: boolean;
  stream?: boolean;
  voiceActive?: boolean;
  sessionId?: string;
  warRoomMode?: boolean;
  archiveContext?: {
    conversationId: string;
    userMessageId: string;
    assistantMessageId: string;
    title?: string;
  };
};

type StreamSender = (event: string, payload: Record<string, unknown>) => void;
type FlowChatResult = ChatAgentResponse & {
  goal?: AutonomousGoal;
  autoExecute?: boolean;
};
type FlowChatModel = 'gemini' | 'chatgpt' | 'claude' | 'deepseek' | 'cerebras' | 'zenmux' | 'iamhc';
const CHAT_STREAM_STATUS_DELAY_MS = 50;
const FLOW_CHAT_MODELS = new Set(["gemini", "chatgpt", "claude", "deepseek", "cerebras", "zenmux", "iamhc"]);
const IMAGE_OPERATIONS = new Set<ImageGenerationOperation>(["simple", "reference", "turnaround3d", "edit"]);
const IMAGE_ASPECT_RATIOS = new Set<FlowImageAspectRatio>(["16:9", "4:3", "1:1", "3:4", "9:16"]);
const EXTERNAL_TOOL_INTENT_PATTERN = /\b(internet|web|google|site|pesquisa|pesquisar|pesquise|buscar|busque|procure|procurar|naveg|acessar|acesse|url|link|noticia|noticias|hoje|agora|atual|cotacao|dolar|spotify|musica|playlist|tocando|volume|fila)\b/;

function parseFlowChatRequestBody(body: unknown): FlowChatRequestBody | null {
  if (!body || typeof body !== "object" || !Array.isArray((body as FlowChatRequestBody).messages)) {
    return null;
  }

  return body as FlowChatRequestBody;
}

function replaceLatestUserMessage(messages: ChatMessage[], text: string): ChatMessage[] {
  const next = [...messages];
  for (let index = next.length - 1; index >= 0; index--) {
    if (next[index].role !== "user") continue;
    next[index] = {
      ...next[index],
      parts: [{ text }],
    };
    break;
  }
  return next;
}

function resolveFlowChatModel(model?: string): FlowChatModel {
  return model && FLOW_CHAT_MODELS.has(model) ? (model as FlowChatModel) : "gemini";
}

function normalizeCommandText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function getLatestUserMessageText(messages: ChatMessage[]): string {
  const latest = [...messages].reverse().find((message) => message.role === "user");
  return latest?.parts.map((part) => part.text).join("\n").trim() || "";
}

function getSkillArtifactHint(userText: string): string {
  const skillId = userText.match(/^\s*\/([a-z0-9.-]+)(?:\s|$)/i)?.[1]?.toLowerCase();
  if (!skillId) return "";
  const skill = skillRegistry.get(skillId);
  if (!skill) return skillId;
  return [skill.id, skill.name, skill.description].join("\n");
}

async function attachRequestedArtifacts(
  response: ChatAgentResponse,
  userText: string,
  sessionId?: string
): Promise<ChatAgentResponse> {
  try {
    const artifacts = await materializeResponseArtifacts({
      requestText: userText,
      content: response.message,
      skillHint: getSkillArtifactHint(userText),
      sessionId,
    });
    return artifacts.length ? { ...response, artifacts } : response;
  } catch (error) {
    const artifactError = error instanceof Error ? error.message : String(error);
    console.error("[FlowArtifacts] Falha ao materializar resposta:", error);
    return { ...response, artifactError };
  }
}

function enforceRequestedFlow(
  response: ChatAgentResponse,
  requestedFlow?: FlowChatRequestBody['requestedFlow']
): ChatAgentResponse {
  if (!requestedFlow || !response.action) return response;
  if (response.action.flow === requestedFlow) return response;

  return {
    ...response,
    action: {
      ...response.action,
      flow: requestedFlow,
      explanation: `${response.action.explanation} O modo ${requestedFlow} selecionado na interface foi preservado.`,
    },
  };
}

function activeMediaFlow(flow?: OutputIntent['mediaFlow']): FlowChatRequestBody['requestedFlow'] {
  return flow === 'image' || flow === 'video' || flow === 'ad-creative' ? flow : undefined;
}

function protectOutputIntent(response: ChatAgentResponse, intent: OutputIntent, allowContinuation: boolean): ChatAgentResponse {
  if (allowsMediaAction(intent) || allowContinuation || !response.action) return response;
  return { ...response, action: null };
}

function needsExternalTools(messages: ChatMessage[]): boolean {
  const text = getLatestUserMessageText(messages);
  const normalized = normalizeCommandText(text);
  if (extractToolApprovalToken(text)) return true;
  const invocation = resolveSkillInvocation(text);
  if (invocation?.explicit && invocation.outputMode === "text-only") {
    return Boolean(invocation.skill.tools?.some((tool) => (tool.effect || "write") === "read"));
  }
  const selectedSkill = skillRegistry.select(text);
  const skillHasExecutableTools = selectedSkill.id !== "general.execute-goal" &&
    (Boolean(selectedSkill.tools?.length) || Boolean(selectedSkill.preferredTools.length));
  return normalized.startsWith("/") || extractMcpMention(text) !== null || EXTERNAL_TOOL_INTENT_PATTERN.test(normalized) || connectorPublishProvider(normalized) !== null || skillHasExecutableTools;
}

async function loadCortexChatContext(input: {
  enabled: boolean;
  latestUserText: string;
  sessionId?: string;
  immediateContextReference: boolean;
  archiveConversationId?: string;
}): Promise<{ relevantMemories?: string; activePersonalityMemories?: ChatMemoryRecord[] }> {
  if (!input.enabled || !input.latestUserText || input.immediateContextReference) return {};

  try {
    const storage = new JsonStorageProvider();
    const service = new ChatMemoryService(storage);
    const promptContext = await service.buildPromptContext(input.latestUserText, {
      userId: LOCAL_MEMORY_USER_ID,
      sessionId: input.sessionId
    });
    const archiveConversationId = input.archiveConversationId
      ? getConversationMemoryStore().resolveConversationId('flow', '', input.archiveConversationId)
      : undefined;
    const archiveRecall = recallArchivedConversations({
      query: input.latestUserText,
      profileId: LOCAL_ARCHIVE_PROFILE_ID,
      excludeConversationId: archiveConversationId,
    });
    const relevantMemories = [
      promptContext.personalFacts ? `[FATOS PESSOAIS CONFIRMADOS DO USUARIO]\n${promptContext.personalFacts}` : '',
      promptContext.contextualFacts ? `[MEMORIAS DESTE CONTEXTO]\n${promptContext.contextualFacts}` : '',
      archiveRecall.context,
    ].filter(Boolean).join('\n\n');
    return {
      relevantMemories: relevantMemories || undefined,
      activePersonalityMemories: promptContext.records.filter((memory) =>
        memory.kind === 'creative_preference' || memory.kind === 'correction'
      )
    };
  } catch (err) {
    console.warn("[API CHAT] Falha ao recuperar memorias relevantes do chat:", err);
    return {};
  }
}

function archiveFlowMessage(input: {
  archiveContext?: FlowChatRequestBody['archiveContext'];
  role: 'user' | 'assistant';
  content: string;
}): string | undefined {
  if (!input.archiveContext || !input.content.trim()) return undefined;
  const messageId = input.role === 'user' ? input.archiveContext.userMessageId : input.archiveContext.assistantMessageId;
  const result = getConversationMemoryStore().upsertMessage({
    channel: 'flow',
    externalUserId: LOCAL_ARCHIVE_PROFILE_ID,
    externalConversationId: input.archiveContext.conversationId,
    conversationTitle: input.archiveContext.title,
    messageId,
    role: input.role,
    content: input.content,
  });
  if (result.consolidationJobCreated) scheduleConversationConsolidation();
  return result.message.id;
}

function saveReferenceImageIfPresent(referenceImage?: string): string | undefined {
  if (!referenceImage) return undefined;

  try {
    return saveBase64ReferenceImage(referenceImage, "chat_ref_image").filePath;
  } catch (err) {
    console.error("Falha ao salvar imagem de referência do chat:", err);
    return undefined;
  }
}

function cleanupReferenceImage(filePath?: string): void {
  try {
    cleanupTemporaryReference(filePath);
  } catch (err) {
    console.error("Erro ao deletar imagem temporÃ¡ria de referÃªncia do chat:", err);
  }
}

async function processChatMemoryBeforeResponse(
  userText: string,
  sessionId: string | undefined,
  cortexMemoryEnabled: boolean,
  evidenceRef?: { conversationId: string; messageId: string }
): Promise<{ receipt?: string }> {
  if (!userText) return {};
  const command = detectChatMemoryCommand(userText);
  if (!cortexMemoryEnabled) {
    return command.explicit ? { receipt: 'A memoria Cortex esta desligada; por isso, nao salvei nem removi nenhuma informacao.' } : {};
  }
  try {
    const service = new ChatMemoryService(new JsonStorageProvider());
    if (command.type === 'forget') {
      const forgotten = await service.forgetMemories(command.target, {
        cortexEnabled: true,
        userId: LOCAL_MEMORY_USER_ID,
        sessionId
      });
      return { receipt: forgotten > 0 ? 'Esqueci essa informacao como voce pediu.' : 'Nao encontrei uma memoria correspondente para esquecer.' };
    }
    const candidates = extractChatMemoryCandidates(userText, '', { sessionId, source: 'flow_chat' }).map((candidate) => ({
      ...candidate,
      evidenceRefs: evidenceRef ? [evidenceRef] : undefined,
    }));
    if (candidates.length > 0) {
      const result = await service.saveChatMemoryCandidates(candidates, {
        cortexEnabled: cortexMemoryEnabled,
        userId: LOCAL_MEMORY_USER_ID,
        sessionId
      });
      if (command.explicit && result.blockedSensitive) return { receipt: 'Nao salvei esse conteudo porque ele parece conter informacao sensivel ou uma credencial.' };
      if (command.explicit && (result.saved.length || result.reinforced.length)) {
        return { receipt: command.type === 'correct' ? 'Corrigi essa informacao na memoria e mantive a versao anterior no historico.' : 'Salvei essa informacao na memoria para usar tambem nos proximos chats.' };
      }
    }
    if (command.explicit) return { receipt: 'Nao consegui identificar com seguranca qual informacao deveria ser salva na memoria.' };
    return {};
  } catch (err) {
    console.warn("[API CHAT] Falha ao extrair/salvar memória do chat:", err);
    return command.explicit ? { receipt: 'Nao consegui salvar essa informacao na memoria. A gravacao falhou e nada foi confirmado.' } : {};
  }
}

function processPostChatLearning(
  userText: string,
  agentResponse: string
): void {
  void recordCharacterTurn({ userMessage: userText, agentResponse }).catch((err) => {
    console.warn("[API CHAT] Falha ao atualizar aprendizado pos-resposta:", err);
  });
}

function attachMemoryReceipt(response: ChatAgentResponse, receipt?: string): ChatAgentResponse {
  if (!receipt) return response;
  const message = response.message.trim();
  return { ...response, message: message ? `${message}\n\n${receipt}` : receipt };
}

function createChatStreamResponse(
  runChat: (send: StreamSender) => Promise<FlowChatResult>,
  cleanup: () => void,
  onComplete?: (response: FlowChatResult) => void
): Response {
  const encoder = new TextEncoder();
  let cleanedUp = false;
  let streamClosed = false;
  let hasAssistantOutput = false;
  let statusTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanupOnce = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    cleanup();
  };

  const clearStatusTimer = () => {
    if (!statusTimer) return;
    clearTimeout(statusTimer);
    statusTimer = null;
  };

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: StreamSender = (event, payload) => {
        if (streamClosed) return;
        if (event === "chunk" || event === "final" || event === "error") {
          hasAssistantOutput = true;
          clearStatusTimer();
        }

        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
        );
      };

      statusTimer = setTimeout(() => {
        if (hasAssistantOutput || streamClosed) return;
        send("status", { text: "Entendi. Estou preparando a resposta..." });
      }, CHAT_STREAM_STATUS_DELAY_MS);

      try {
        const response = await runChat(send);
        send("final", {
          success: true,
          message: response.message,
          action: response.action,
          artifacts: response.artifacts,
          artifactError: response.artifactError,
          goal: response.goal,
          autoExecute: response.autoExecute,
        });

        if (onComplete) {
          onComplete(response);
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error("[API CHAT] Erro no stream do chat:", err);
        send("error", { error: errMsg });
      } finally {
        clearStatusTimer();
        cleanupOnce();
        streamClosed = true;
        try {
          controller.close();
        } catch {
          // The client may have cancelled the stream while the model was still running.
        }
      }
    },
    cancel() {
      streamClosed = true;
      clearStatusTimer();
      cleanupOnce();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  let referenceImagePath: string | undefined = undefined;
  let cleanupInPost = true;
  try {
    const body = parseFlowChatRequestBody(await request.json().catch(() => null));
    if (!body) {
      return NextResponse.json({ error: "Parâmetro 'messages' é obrigatório e deve ser um array." }, { status: 400 });
    }

    const {
      messages,
      model,
      referenceImage,
      requestedFlow,
      imageOperation,
      imageAspectRatio,
      useCortexMemory,
      stream,
      voiceActive,
      sessionId,
      archiveContext,
    } = body;
    const cortexMemoryEnabled = useCortexMemory !== false;
    const modelName = resolveFlowChatModel(model);
    const resolvedImageOperation = typeof imageOperation === "string" && IMAGE_OPERATIONS.has(imageOperation)
      ? imageOperation
      : referenceImage
        ? "reference"
        : "simple";
    const resolvedImageAspectRatio = typeof imageAspectRatio === "string" && IMAGE_ASPECT_RATIOS.has(imageAspectRatio)
      ? imageAspectRatio
      : undefined;
    const rawLatestUserText = getLatestUserMessageText(messages);
    const goalCommand = parseGoalCommand(rawLatestUserText);
    const goalMode = goalCommand?.kind === "create";
    const latestUserText = goalMode ? goalCommand.objective : rawLatestUserText;
    const agentMessages = goalMode
      ? replaceLatestUserMessage(messages, latestUserText)
      : messages;
    const skillInvocation = goalMode ? null : resolveSkillInvocation(latestUserText);
    const wantsExternalTools = needsExternalTools(agentMessages);
    const hasExternalTools = wantsExternalTools;
    const outputIntent = classifyOutputIntent(latestUserText, getSkillArtifactHint(latestUserText));
    const actionContinuation = isActionContinuationRequest(agentMessages);
    const requestedMediaFlow = activeMediaFlow(outputIntent.mediaFlow)
      || ((allowsMediaAction(outputIntent) || actionContinuation) ? requestedFlow : undefined);
    const immediateContextReference = isImmediateContextReference(agentMessages);
    const autonomousGoal = goalMode
      ? await autonomousGoalStore.create({
          requestId: archiveContext?.userMessageId,
          conversationId: sessionId || archiveContext?.conversationId,
          objective: latestUserText,
        })
      : undefined;
    const voiceContext = getAgentVoiceContext(latestUserText, voiceActive === true);
    const archivedUserMessageId = cortexMemoryEnabled ? archiveFlowMessage({ archiveContext, role: 'user', content: latestUserText }) : undefined;
    const memoryOperation = await processChatMemoryBeforeResponse(
      latestUserText,
      sessionId,
      cortexMemoryEnabled,
      archivedUserMessageId && archiveContext ? {
        conversationId: getConversationMemoryStore().resolveConversationId('flow', '', archiveContext.conversationId),
        messageId: archivedUserMessageId,
      } : undefined
    );

    const [characterRuntime, cortexContext] = await Promise.all([
      prepareCharacterRuntime({ userMessage: latestUserText, sessionId }),
      loadCortexChatContext({
        enabled: cortexMemoryEnabled,
        latestUserText,
        sessionId,
        immediateContextReference,
        archiveConversationId: archiveContext?.conversationId
      })
    ]);
    const personality = null;


    referenceImagePath = saveReferenceImageIfPresent(referenceImage);
    const activePersonalityMemories = cortexContext.activePersonalityMemories;
    const relevantMemories = [
      cortexContext.relevantMemories,
      memoryOperation.receipt ? `[RESULTADO DA OPERACAO DE MEMORIA DESTE TURNO]\n${memoryOperation.receipt}\nNao afirme um resultado diferente deste.` : undefined
    ].filter(Boolean).join('\n\n') || undefined;

    const isWarRoom = body.warRoomMode === true || isWarRoomCommand(rawLatestUserText);

    if (isWarRoom) {
      const topic = extractWarRoomTopic(rawLatestUserText) || rawLatestUserText || "Campanha Estratégica";
      const runWarRoom = async (send?: StreamSender): Promise<FlowChatResult> => {
        let currentSession = createWarRoomSession(topic, archiveContext?.userMessageId);
        if (send) {
          send("war_room_init", { session: currentSession });
        }
        const createdArtifacts = [];

        const llmCaller = async (promptText: string) => flowProvider.queryWebLLM(modelName, promptText);

        for (let i = 0; i < WAR_ROOM_AGENT_PROFILES.length; i++) {
          const profile = WAR_ROOM_AGENT_PROFILES[i];
          if (send) {
            send("status", { text: `[${profile.title}] desenvolvendo perspectiva autêntica...` });
          }
          const turn = await buildAgentTurn(currentSession, i, topic, llmCaller);
          currentSession = turn.updatedSession;

          let registeredArtifact = undefined;
          if (turn.artifactReference?.content) {
            registeredArtifact = await registerContentArtifact({
              id: turn.artifactReference.id,
              name: turn.artifactReference.name,
              content: turn.artifactReference.content,
              type: "markdown",
              mimeType: "text/markdown; charset=utf-8",
              metadata: {
                sessionId,
                warRoomSessionId: currentSession.id,
                agentRole: profile.role,
                agentName: profile.name,
              },
            });
            createdArtifacts.push(registeredArtifact);
          }

          if (send) {
            send("war_room_turn", {
              message: turn.message,
              artifact: registeredArtifact,
              session: currentSession,
            });
          }
          await new Promise((r) => setTimeout(r, 60));
        }

        if (currentSession.review) {
          const sourceArtifacts = currentSession.messages.flatMap((message) =>
            (message.artifactsProduced || []).flatMap((artifact) => artifact.content ? [{
              id: artifact.id,
              filename: artifact.name,
              content: artifact.content,
            }] : []),
          );
          const productionSpec = createCampaignProductionSpec({
            sessionId: currentSession.id,
            campaignName: currentSession.topic,
            objective: currentSession.brief.objective,
            artifacts: sourceArtifacts,
            review: currentSession.review,
            warnings: currentSession.warnings,
          });
          const registeredSpec = await registerContentArtifact({
            id: productionSpec.id,
            name: "campaign-production-spec.json",
            content: `${JSON.stringify(productionSpec, null, 2)}\n`,
            type: "json",
            mimeType: "application/json; charset=utf-8",
            metadata: {
              sessionId,
              warRoomSessionId: currentSession.id,
              source: "war-room-production-spec",
              reviewStatus: productionSpec.review.status,
            },
          });
          createdArtifacts.push(registeredSpec);
          if (send) send("war_room_artifact", { artifact: registeredSpec, productionSpec });
        }

        if (send) {
          send("war_room_complete", {
            session: currentSession,
            artifacts: createdArtifacts,
          });
        }

        const reviewApproved = currentSession.review?.status === "approved";
        const degraded = currentSession.warnings.length > 0;
        const consolidatedMessage = `# 🏛️ Sala de Guerra ${reviewApproved ? "Concluída" : "Aguardando Revisão"}: ${topic}

A equipe multidisciplinar de especialistas concluiu o alinhamento estratégico e a produção de artefatos:

- 👑 **Diretoria de Estratégia (Alex Vance):** Posicionamento, proposta de valor única e matriz de canais/KPIs.
- 🎯 **Estrategista de Público (Maya Lin):** Mapeamento de personas, dores críticas e quebra de objeções.
- 🛡️ **Guardião da Marca (Valentin Ramos):** Definição de tom de voz, princípios inegociáveis e guardrails éticos.
- ✍️ **Copywriter Viral (Helena Prado):** Ganchos magnéticos para Reels/Shorts, roteiro estruturado e CTAs.
- 🎨 **Diretor de Arte (Theo Becker):** Conceito visual, paleta cromática e prompts cinematográficos.
- 🔍 **Auditora Criativa (Sofia Alencar):** Revisão por rubrica com pontuação ${currentSession.review?.score || 0}/100.

${reviewApproved ? "✅ **Rubrica técnica aprovada.** A aprovação humana continua obrigatória antes da produção." : `⚠️ **Produção bloqueada pela rubrica:** ${currentSession.review?.blockingIssues.join("; ") || "revisão necessária"}.`}
${degraded ? `\n⚠️ **Execução degradada:** ${currentSession.warnings.length} etapa(s) utilizaram fallback sintético e estão identificadas no histórico.` : ""}

✨ **${createdArtifacts.length} artefatos** foram materializados e estão disponíveis no **Live Artifact Canvas**, incluindo o contrato canônico \`campaign-production-spec.json\`.`;

        if (cortexMemoryEnabled) archiveFlowMessage({ archiveContext, role: "assistant", content: consolidatedMessage });

        return {
          message: consolidatedMessage,
          action: null,
          artifacts: createdArtifacts,
        };
      };

      if (stream === true) {
        cleanupInPost = false;
        return createChatStreamResponse(
          (send) => runWarRoom(send),
          () => cleanupReferenceImage(referenceImagePath),
          (response) => {
            processPostChatLearning(latestUserText, response.message);
          }
        );
      }

      const response = await runWarRoom();
      processPostChatLearning(latestUserText, response.message);
      return NextResponse.json({
        success: true,
        message: response.message,
        action: response.action,
        artifacts: response.artifacts,
      });
    }

    const runChat = async (onMessageChunk?: (chunk: string) => void) => {
      const response = await chatWithAgent(
        agentMessages,
        personality,
        async (compiledPrompt: string, imagePath?: string, queryOptions?: {
          onTextChunk?: (chunk: string) => void;
          browserFallbackPrompt?: string;
          useExternalTools?: boolean;
          toolIntentText?: string;
        }) => {
          return await flowProvider.queryWebLLM(modelName, compiledPrompt, imagePath, queryOptions);
        },
        referenceImagePath,
        {
          useCortexMemory: cortexMemoryEnabled,
          onMessageChunk,
          hasExternalTools,
          relevantMemories,
          activeMemories: activePersonalityMemories,
          voiceInstruction: getAgentVoiceInstruction(voiceContext),
          requestedFlow: requestedMediaFlow,
          imageOperation: resolvedImageOperation,
          imageAspectRatio: resolvedImageAspectRatio,
          characterRuntime,
          goalMode,
          skillId: skillInvocation?.skill.id,
          skillPromptContext: skillInvocation ? buildSkillPromptContext(skillInvocation) : undefined,
          skillExplicit: skillInvocation?.explicit,
          skillOutputMode: skillInvocation?.outputMode,
        }
      );
      const protectedResponse = protectOutputIntent(response, outputIntent, actionContinuation);
      const routedResponse = enforceRequestedFlow(protectedResponse, requestedMediaFlow);
      const finalResponse = await attachRequestedArtifacts(attachMemoryReceipt(routedResponse, memoryOperation.receipt), latestUserText, sessionId);
      const goal = autonomousGoal
        ? finalResponse.action
          ? await autonomousGoalStore.setStatus(autonomousGoal.id, "queued", {
              flow: finalResponse.action.flow === "image" || finalResponse.action.flow === "video" || finalResponse.action.flow === "ad-creative"
                ? finalResponse.action.flow
                : undefined,
            }) || autonomousGoal
          : await autonomousGoalStore.setStatus(autonomousGoal.id, "blocked", {
              error: "O objetivo não produziu uma ação compatível com as capacidades autônomas instaladas.",
            }) || autonomousGoal
        : undefined;
      if (cortexMemoryEnabled) archiveFlowMessage({ archiveContext, role: 'assistant', content: finalResponse.message });
      return {
        ...finalResponse,
        goal,
        autoExecute: Boolean(goal && finalResponse.action),
      };
    };

    if (stream === true) {
      cleanupInPost = false;
      return createChatStreamResponse(
        (send) => {
          if (voiceActive === true) {
            send("voice-context", {
              context: getVoiceExpressionContext(characterRuntime.session, voiceContext)
            });
          }
          return runChat((chunk) => send("chunk", { text: chunk }));
        },
        () => cleanupReferenceImage(referenceImagePath),
        (response) => {
          processPostChatLearning(latestUserText, response.message);
        }
      );
    }

    const response = await runChat();
    
    // Processamento de memória no fluxo não-stream
    processPostChatLearning(latestUserText, response.message);

    return NextResponse.json({
      success: true,
      message: response.message,
      action: response.action,
      artifacts: response.artifacts,
      artifactError: response.artifactError,
      goal: response.goal,
      autoExecute: response.autoExecute,
    });

  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[API CHAT] Erro no endpoint do chat:", err);
    return NextResponse.json(
      { error: `Falha ao processar requisição do chat: ${errMsg}` },
      { status: 500 }
    );
  } finally {
    if (cleanupInPost && referenceImagePath) {
      try {
        cleanupTemporaryReference(referenceImagePath);
      } catch (err) {
        console.error("Erro ao deletar imagem temporária de referência do chat:", err);
      }
    }
  }
}
