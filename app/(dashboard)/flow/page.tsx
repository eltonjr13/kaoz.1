"use client";

import { useCallback, useEffect, useLayoutEffect, useState, useRef, type WheelEvent } from "react";
import {
  Image as ImageIcon,
  Loader2,
  AlertCircle,
  CheckCircle,
  Download,
  Trash2,
  Terminal,
  ArrowRight,
  Film,
  Cpu,
  User,
  Check,
  Bot,
  MessageSquarePlus,
  Square,
  Undo2,
  Pencil,
  ThumbsUp,
  ThumbsDown,
  ChevronDown,
  ChevronUp,
  X,
  RefreshCw,
} from "lucide-react";

import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "next/navigation";
import ModelViewer3D from "@/components/ui/ModelViewer3D";
import GlassSurface from "@/components/ui/glass-surface/GlassSurface";
import { playCartesiaVoiceWebSocket, playCartesiaVoiceStream } from "@/lib/cartesia";
import {
  compileAgentSpeech,
  compileFishAudioSpeech,
  createFishExpressionReplyState,
  getAgentVoiceContext,
  resolveCartesiaVoiceControls,
  type VoiceExpressionContext
} from "@/lib/ai/agent-voice";
import {
  resolveImageGenerationOperation,
  type ImageGenerationOperation,
  type ImageReferenceSource,
} from "@/src/providers/flow/ImageGenerationContract";
import { isBuildSkillsIntent } from "@/services/skills/skill.intent";
import type { ApprovalMode } from "@/services/orchestrator/orchestrator.types";
import type { ExecutionArtifact } from "@/services/orchestrator/orchestrator.types";
import type { SkillToolDefinition } from "@/services/skills/skill.types";
import { acquireMicrophoneSession } from "@/lib/speech/microphone-session";
import { ArtifactCards } from "@/components/artifacts/artifact-viewer";

class SpeechQueue {
  private queue: Promise<void> = Promise.resolve();
  private cancelCurrent: (() => void) | null = null;
  private isCancelled = false;
  private activeCount = 0;
  private onIdle: (() => void) | null = null;

  constructor(onIdle?: () => void) {
    this.onIdle = onIdle || null;
  }

  enqueue(speakFn: () => { promise: Promise<void>; cancel: () => void }) {
    if (this.isCancelled) return;
    
    this.activeCount++;
    this.queue = this.queue.then(() => {
      if (this.isCancelled) {
        this.activeCount--;
        this.checkIdle();
        return;
      }
      const { promise, cancel } = speakFn();
      this.cancelCurrent = cancel;
      return promise.then(() => {
        this.cancelCurrent = null;
        this.activeCount--;
        this.checkIdle();
      });
    });
  }

  private checkIdle() {
    if (this.activeCount === 0 && this.onIdle) {
      this.onIdle();
    }
  }

  cancelAll() {
    this.isCancelled = true;
    if (this.cancelCurrent) {
      this.cancelCurrent();
      this.cancelCurrent = null;
    }
    this.activeCount = 0;
    this.queue = Promise.resolve();
    this.isCancelled = false;
    this.checkIdle();
  }
}

interface GenerationResult {
  success: boolean;
  path: string;
  filename: string;
  paths?: string[];
  filenames?: string[];
  createdAt: string;
  duration?: string;
  error?: string;
}

interface Model3DResult {
  success: boolean;
  path: string;
  filename: string;
  paths?: string[];
  createdAt: string;
}

interface SelectedElementReference {
  imageData: string;
  xpath: string;
  label?: string;
}

type AgentType = 'image' | 'video' | 'ad-creative';
type PlannedKind = AgentType | 'project';
type AgentModel = 'deepseek' | 'claude' | 'chatgpt' | 'gemini' | 'cerebras' | 'zenmux' | 'iamhc';
type PlannedFlow = PlannedKind | 'refine';
type ImagePackageMode = 'turnaround3d';
type TurnaroundView = 'front' | 'left' | 'right' | 'back' | 'top' | 'bottom';
const TURNAROUND_IMAGE_LABELS = ["Base", "Lateral esquerda", "Lateral direita", "Costas", "Topo", "Inferior"];
const AGENT_MODEL_OPTIONS: { value: AgentModel; label: string }[] = [
  { value: "gemini", label: "Gemini (CLI Antigravity)" },
  { value: "chatgpt", label: "ChatGPT (CLI Codex)" },
  { value: "claude", label: "Claude (CLI)" },
  { value: "deepseek", label: "DeepSeek (CLI)" },
  { value: "cerebras", label: "Cerebras (API + MCP)" },
  { value: "zenmux", label: "ZenMux (API + MCP)" },
  { value: "iamhc", label: "IAMHC (API - Modelos Chineses)" },
];

interface PendingPlan {
  kind: PlannedKind;
  flow: PlannedFlow;
  originalPrompt: string;
  prompt: string;
  explanation: string;
  model: AgentModel;
  aspectRatio: string;
  quantity?: string;
  mediaModel?: string;
  referenceImage?: string | null;
  referenceImagePath?: string | null;
  editSourceImagePath?: string | null;
  imageOperation?: ImageGenerationOperation;
  referenceSource?: ImageReferenceSource;
  referenceXPath?: string | null;
  targetJobId?: string | null;
  strategy?: string;
  scriptOutline?: string | null;
  creativeSteps?: string[];
  visualReferenceInstructions?: string;
  requestedImageCount?: number;
  imagePackageMode?: ImagePackageMode;
  turnaroundViews?: TurnaroundView[];
  requires3dBasePreparation?: boolean;
  useCortexMemory?: boolean;
  adCreativePlan?: {
    concepts: {
      conceptName: string;
      copyText: string;
      visualPrompt: string;
    }[];
  } | null;
}

interface FlowChatAction {
  flow?: PlannedFlow;
  optimizedPrompt?: string;
  explanation?: string;
  targetJobId?: string | null;
  strategy?: string;
  scriptOutline?: string | null;
  creativeSteps?: string[];
  requestedImageCount?: number;
  adCreativePlan?: PendingPlan["adCreativePlan"];
}

interface FlowChatResponse {
  success?: boolean;
  message?: string;
  action?: FlowChatAction | null;
  error?: string;
  artifacts?: ExecutionArtifact[];
  artifactError?: string;
}

interface FlowChatStreamPayload extends FlowChatResponse {
  text?: string;
  context?: VoiceExpressionContext;
}

interface FlowChatStreamEvent {
  event: string;
  data: FlowChatStreamPayload;
}

export interface ChatMessageState {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  attachedImage?: string | null;
  plan?: PendingPlan | null;
  jobId?: string | null;
  jobType?: PlannedKind | null;
  jobStatus?: 'running' | 'completed' | 'failed' | null;
  jobLogs?: string[];
  imageResult?: GenerationResult | null;
  model3dResult?: Model3DResult | null;
  videoResult?: GenerationResult | null;
  projectResult?: { success: boolean; jobId?: string; videoPath?: string; error?: string } | null;
  showLogs?: boolean;
  feedback?: 'good' | 'bad' | null;
  artifacts?: ExecutionArtifact[];
  artifactError?: string;
  skillDraft?: {
    id: string;
    name: string;
    description: string;
    instructions: string;
    version?: string;
    preferredTools?: string[];
    requiredCapabilities?: string[];
    approvalMode?: ApprovalMode;
    tools?: SkillToolDefinition[];
    references?: Array<{ name: string; content: string }>;
    scripts?: Array<{ name: string; content: string }>;
    saveStatus?: 'saving' | 'saved' | 'error';
    saveError?: string;
  } | null;
}

interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageState[];
}

type SendMessageOptions = {
  speakResponse?: boolean;
};

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0?: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent {
  error?: string;
  message?: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onend: (() => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  abort(): void;
  start(): void;
  stop(): void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

interface FlowJobSnapshot {
  id?: string;
  status?: string;
  topic?: string | null;
  final_video_path?: string | null;
  source_video_transcription?: string | null;
  error_message?: string | null;
  updated_at?: string;
}

const CHAT_HISTORY_KEY = "kaoz1:flow:chat_history";
const CHAT_CONVERSATIONS_KEY = "kaoz1:flow:chat_conversations";
const ACTIVE_CHAT_KEY = "kaoz1:flow:active_chat";
const CHAT_AUTO_SCROLL_THRESHOLD = 96;
const USE_CORTEX_MEMORY_KEY = "kaoz1:flow:use_cortex_memory";
const AGENT_MODEL_KEY = "kaoz1:flow:agent_model";
const LEGACY_FLOW_STORAGE_KEYS: Record<string, string> = {
  [CHAT_HISTORY_KEY]: "mrchicken:flow:chat_history",
  [CHAT_CONVERSATIONS_KEY]: "mrchicken:flow:chat_conversations",
  [ACTIVE_CHAT_KEY]: "mrchicken:flow:active_chat",
  [USE_CORTEX_MEMORY_KEY]: "mrchicken:flow:use_cortex_memory",
  [AGENT_MODEL_KEY]: "mrchicken:flow:agent_model",
};
const BRANCH_TITLE_PREFIX = "Ramificação - ";
const MAX_SCALE_IMAGE_COUNT = 40;
const WAKE_COMMAND_PATTERNS = [
  /(?:^|\b)(?:hello|helo|ol[aá]|oi|ei)\s+kaoz(?:\.?1)?\b[,.!?\s-]*(.*)$/i,
  /(?:^|\b)kaoz(?:\.?1)?\b[,.!?\s-]*(.*)$/i
];

const readFlowStorage = (key: string): string | null => {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacyKey = LEGACY_FLOW_STORAGE_KEYS[key];
  if (!legacyKey) return null;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy !== null) localStorage.setItem(key, legacy);
  return legacy;
};

const createChatId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const isAgentModel = (value: string | null): value is AgentModel =>
  AGENT_MODEL_OPTIONS.some((option) => option.value === value);

const normalizeSearchText = (text: string) =>
  text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const shouldUseWebTools = (text: string) =>
  /\b(internet|web|google|site|pesquis|buscar|busque|pesquise|naveg|acessar|acesse|url|link|noticia|noticias|hoje|agora|atual|cotacao|dolar)\b/.test(normalizeSearchText(text));

const isImageEditIntent = (text: string) =>
  /\b(editar|edite|edit|alterar|altere|ajustar|ajuste|corrigir|corrija|remover|remova|tirar|tire|trocar|troque|adicionar|adicione)\b/.test(normalizeSearchText(text));

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const browserWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return browserWindow.SpeechRecognition || browserWindow.webkitSpeechRecognition || null;
}

function normalizeVoiceText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function isLikelyAssistantEcho(transcript: string, assistantSpeech: string): boolean {
  const heard = normalizeSearchText(transcript);
  const spoken = normalizeSearchText(assistantSpeech);
  if (!heard || !spoken) return false;
  if (spoken.includes(heard) && heard.length >= 4) return true;

  const spokenWords = new Set(spoken.split(/\s+/).filter((word) => word.length >= 4));
  const matchingWords = heard.split(/\s+/).filter((word) => word.length >= 4 && spokenWords.has(word));
  return matchingWords.length >= 2;
}

function extractWakeCommand(text: string): { activated: boolean; command: string } {
  const normalized = normalizeVoiceText(text);
  for (const pattern of WAKE_COMMAND_PATTERNS) {
    const match = normalized.match(pattern);
    if (match) {
      return {
        activated: true,
        command: normalizeVoiceText(match[1] || "")
      };
    }
  }
  return { activated: false, command: "" };
}

function getAssistantSpeechText(content: string): string {
  return content
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\[[^\]]+\]/g, "")
    .replace(/[`*_>#~-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function queueCompleteSpeechSentences(
  sentenceBuffer: string,
  speakTextChunk: (textToSpeak: string, isLast?: boolean) => void,
  minBatchChars = 0
): string {
  const sentenceBoundaryRegex = /([.?!;\n]+)/g;
  let match;
  let lastIndex = 0;
  let pendingSpeech = "";

  while ((match = sentenceBoundaryRegex.exec(sentenceBuffer)) !== null) {
    const boundaryIndex = match.index + match[0].length;
    const sentence = sentenceBuffer.substring(lastIndex, boundaryIndex).trim();
    if (sentence) {
      pendingSpeech = pendingSpeech ? `${pendingSpeech} ${sentence}` : sentence;
      if (pendingSpeech.length >= minBatchChars) {
        speakTextChunk(pendingSpeech, false);
        pendingSpeech = "";
      }
    }
    lastIndex = boundaryIndex;
  }

  const remainingText = lastIndex > 0 ? sentenceBuffer.substring(lastIndex) : sentenceBuffer;
  return pendingSpeech ? `${pendingSpeech} ${remainingText}`.trimStart() : remainingText;
}

const sanitizeChatMessages = (messages: ChatMessageState[]) =>
  messages.map((msg) => {
    const sanitizedMsg = { ...msg };
    if (sanitizedMsg.attachedImage) {
      sanitizedMsg.attachedImage = null;
    }
    if (!sanitizedMsg.plan?.referenceImage) return sanitizedMsg;
    return {
      ...sanitizedMsg,
      plan: {
        ...sanitizedMsg.plan,
        referenceImage: null
      }
    };
  });

const getFlowMediaUrl = (mediaPath?: string | null) => {
  if (!mediaPath) return "";
  if (mediaPath.startsWith("public/")) {
    return mediaPath.substring(6);
  }
  if (mediaPath.startsWith("/public/")) {
    return mediaPath.substring(7);
  }
  return `/api/flow/media?path=${encodeURIComponent(mediaPath)}`;
};

const createImageFileFromDataUrl = (dataUrl: string) => {
  const [metadata, encodedData] = dataUrl.split(",", 2);
  if (!metadata || !encodedData) return null;

  const mimeType = metadata.match(/^data:(.*?);base64$/)?.[1] || "image/png";
  try {
    const binary = atob(encodedData);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const extension = mimeType.split("/")[1] || "png";
    return new File([bytes], `imagem-anexada.${extension}`, { type: mimeType });
  } catch {
    return null;
  }
};

const getFlowDownloadUrl = (mediaPath?: string | null) => {
  const url = getFlowMediaUrl(mediaPath);
  if (!url) return "";
  if (url.startsWith("/api/flow/media")) {
    return `${url}&download=true`;
  }
  return url;
};

const parseFlowChatStreamEvent = (block: string): FlowChatStreamEvent | null => {
  const lines = block.split(/\r?\n/);
  let event = "message";
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) return null;

  try {
    return {
      event,
      data: JSON.parse(dataLines.join("\n")) as FlowChatStreamPayload
    };
  } catch {
    return null;
  }
};

async function generate3dBaseImage(params: {
  prompt: string;
  aspectRatio: string;
  model: string;
  referenceImage?: string;
  referenceImagePath?: string;
  forceReferenceUpload?: boolean;
  useExistingFlowReference?: boolean;
  operation?: ImageGenerationOperation;
}): Promise<GenerationResult> {
  const response = await fetch("/api/flow/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "image",
      prompt: params.prompt,
      aspectRatio: params.aspectRatio,
      quantity: "1x",
      model: params.model,
      referenceImage: params.referenceImage,
      referenceImagePath: params.referenceImagePath,
      forceReferenceUpload: params.forceReferenceUpload,
      useExistingFlowReference: params.useExistingFlowReference,
      operation: params.operation
    })
  });
  const result = await response.json();
  if (!response.ok || !result.success) {
    throw new Error(result.error || "Falha ao gerar a imagem base do 3D.");
  }

  return result;
}

const build3dBasePrompt = (prompt: string) =>
  [
    "Create a 3D caricature character model-sheet base image from the attached reference.",
    "Output one full-body character only, centered, upright, unobstructed, feet visible.",
    "Use a strict plain light gray neutral background only. No environment, no room, no street, no toys, no props, no furniture, no text, no logos.",
    "Do not include objects held in the hands. Keep hands empty unless the original character identity absolutely requires an accessory.",
    "Keep the character identity and requested style from the user prompt.",
    `User prompt: ${prompt}`
  ].join(" ");

const build3dImageEditPrompt = (originalPrompt: string, correctionPrompt: string) =>
  [
    "Image-to-image edit task. Use the attached reference image as the exact source image.",
    "Preserve the same subject, pose, camera angle, crop, composition, lighting, colors, materials, background, and proportions.",
    "Apply only the requested correction below. Do not create a new scene or redesign the image.",
    "Return one edited image only.",
    `Original 3D base brief: ${originalPrompt}`,
    `Requested correction: ${correctionPrompt}`,
  ].join(" ");

const getConversationTitle = (messages: ChatMessageState[]) => {
  const firstUserMessage = messages.find((msg) => msg.role === "user")?.content.trim();
  if (!firstUserMessage) return "Nova conversa";
  const firstLine = firstUserMessage.split(/\r?\n/)[0].trim();
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
};

const getConversationTitleWithBranch = (messages: ChatMessageState[], currentTitle: string) => {
  const generatedTitle = getConversationTitle(messages);
  const isDefault = currentTitle === "Nova conversa" || currentTitle === `${BRANCH_TITLE_PREFIX}Nova conversa`;
  
  if (isDefault) {
    if (currentTitle.startsWith(BRANCH_TITLE_PREFIX)) {
      return `${BRANCH_TITLE_PREFIX}${generatedTitle}`;
    }
    return generatedTitle;
  }
  
  return currentTitle;
};

const get3dEditSourcePath = (message: ChatMessageState) => {
  if (message.plan?.imagePackageMode !== "turnaround3d") return null;
  const sourcePath = message.plan.referenceImagePath?.trim();
  return sourcePath || null;
};

const createChatConversation = (messages: ChatMessageState[] = [], title?: string): ChatConversation => {
  const now = new Date().toISOString();
  const sanitizedMessages = sanitizeChatMessages(messages);
  return {
    id: createChatId("chat"),
    title: title || getConversationTitle(sanitizedMessages),
    createdAt: now,
    updatedAt: now,
    messages: sanitizedMessages
  };
};

const readJsonArray = <T,>(value: string | null): T[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const formatExportDate = (value: string) => new Date(value).toLocaleString("pt-BR");

const formatChatExport = (conversation: ChatConversation, messages: ChatMessageState[]) => {
  const lines = [
    `# ${conversation.title}`,
    "",
    `Exportado em: ${formatExportDate(new Date().toISOString())}`,
    `Criado em: ${formatExportDate(conversation.createdAt)}`,
    `Mensagens: ${messages.length}`,
    ""
  ];

  messages.forEach((msg) => {
    const author = msg.role === "user" ? "Usuario" : "Kaoz.1";
    lines.push(`## ${author} - ${formatExportDate(msg.timestamp)}`, "", msg.content, "");
    if (msg.plan) {
      lines.push("### Plano", "", `Tipo: ${msg.plan.kind}`, `Modelo: ${msg.plan.model}`, `Prompt: ${msg.plan.prompt}`, "");
    }
    if (msg.jobId) {
      lines.push("### Job", "", `ID: ${msg.jobId}`, `Status: ${msg.jobStatus || "pendente"}`, "");
    }
    if (msg.artifacts?.length) {
      lines.push("### Arquivos", "", ...msg.artifacts.map((artifact) => `- ${artifact.name} (${artifact.type})`), "");
    }
  });

  return lines.join("\n");
};

const downloadTextFile = (content: string, filename: string) => {
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
};

const getResultFilename = (filePath: string) => {
  if (!filePath) return "";
  const cleanPath = filePath.split("?")[0];
  return cleanPath.split(/[\\/]/).pop() || cleanPath;
};

const normalizeRequestedImageCount = (value: unknown) => {
  const count = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isInteger(count) || count < 5) return undefined;
  return Math.min(count, MAX_SCALE_IMAGE_COUNT);
};

const extractRequestedImageCount = (value: string) => {
  const normalized = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = [...normalized.matchAll(/\b(\d{1,3})\s+(?:imagens|imagem|fotos|foto|images|image)\b/g)];
  const counts = matches
    .map((match) => normalizeRequestedImageCount(match[1]))
    .filter((count): count is number => typeof count === "number");

  return counts.length > 0 ? Math.max(...counts) : undefined;
};

const extractImagePathsFromJob = (value?: string | null) => {
  if (!value) return [];
  
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object") {
      if (parsed.mode === 'ad-creative' && Array.isArray(parsed.concepts)) {
        return parsed.concepts.flatMap((c: any) => c.images || []).filter((item: any) => typeof item === 'string');
      }
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
      if (Array.isArray(parsed.images)) return parsed.images.map((item: any) => item.path || item).filter((item: any) => Boolean(item));
    }
  } catch {}

  const marker = "Imagens salvas em:";
  const markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) {
    const jsonText = value.slice(markerIndex + marker.length).trim();
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string");
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.images)) {
        return parsed.images.map((item: any) => item.path).filter((item: any) => Boolean(item));
      }
    } catch {}
  }
  const match = value.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
};

const extractModel3dPathsFromJob = (value?: string | null) => {
  if (!value) return [];

  const parseModelPaths = (parsed: unknown) => {
    if (!parsed || typeof parsed !== "object") return [];
    const data = parsed as { mode?: unknown; model3d?: { modelPaths?: unknown } };
    if (data.mode === "turnaround3d" && Array.isArray(data.model3d?.modelPaths)) {
      return data.model3d.modelPaths.filter((item): item is string => typeof item === "string");
    }
    return [];
  };

  try {
    const directPaths = parseModelPaths(JSON.parse(value));
    if (directPaths.length > 0) return directPaths;
  } catch {}

  const marker = "Imagens salvas em:";
  const markerIndex = value.indexOf(marker);
  if (markerIndex < 0) return [];

  try {
    return parseModelPaths(JSON.parse(value.slice(markerIndex + marker.length).trim()));
  } catch {
    return [];
  }
};

const buildModel3dResultFromJob = (job: FlowJobSnapshot): Model3DResult | null => {
  const model3dPaths = extractModel3dPathsFromJob(job.source_video_transcription);
  if (model3dPaths.length === 0) return null;
  return {
    success: true,
    path: model3dPaths[0],
    filename: getResultFilename(model3dPaths[0]),
    paths: model3dPaths,
    createdAt: job.updated_at || new Date().toISOString()
  };
};

const buildImageResultFromJob = (job: FlowJobSnapshot): GenerationResult | null => {
  const imagePaths = extractImagePathsFromJob(job.source_video_transcription);
  const finalPath = job.final_video_path || imagePaths[0] || "";
  if (!finalPath && imagePaths.length === 0) return null;
  return {
    success: true,
    path: finalPath,
    filename: getResultFilename(finalPath),
    paths: imagePaths.length > 0 ? imagePaths : [finalPath],
    createdAt: job.updated_at || new Date().toISOString()
  };
};

const getEditableMessageContent = (content: string) =>
  content.replace(/\n\n\[Imagem de refer(?:ência|Ãªncia) anexada\]$/i, "");

const isChatNearBottom = (element: HTMLDivElement) =>
  element.scrollHeight - element.scrollTop - element.clientHeight <= CHAT_AUTO_SCROLL_THRESHOLD;

interface CustomDropdownProps {
  value: string;
  onChange: (val: string) => void;
  options: { value: string; label: string }[];
  icon?: React.ReactNode;
  title?: string;
  className?: string;
  onRightClickItem?: (e: React.MouseEvent, value: string) => void;
  editingId?: string | null;
  setEditingId?: (val: string | null) => void;
  editingText?: string;
  setEditingText?: (val: string) => void;
  onRenameOption?: (value: string, newLabel: string) => void;
}

function CustomDropdown({ 
  value, 
  onChange, 
  options, 
  icon, 
  title, 
  className,
  onRightClickItem,
  editingId,
  setEditingId,
  editingText = "",
  setEditingText,
  onRenameOption
}: CustomDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleContextMenu = (e: React.MouseEvent, optionValue: string) => {
    if (onRightClickItem) {
      e.preventDefault();
      e.stopPropagation();
      onRightClickItem(e, optionValue);
    }
  };

  const handleRenameSave = () => {
    if (editingId && onRenameOption && editingText) {
      const trimmed = editingText.trim();
      if (trimmed) {
        onRenameOption(editingId, trimmed);
      }
    }
    if (setEditingId) {
      setEditingId(null);
    }
  };

  const selectedOption = options.find(opt => opt.value === value);

  return (
    <div ref={dropdownRef} className={`relative ${className}`} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative flex items-center bg-white/[0.03] border border-white/10 rounded-xl pl-3 pr-8 hover:bg-white/[0.06] hover:border-white/20 transition-all duration-300 text-left cursor-pointer w-full py-1.5 text-xs text-white/90 font-medium"
        title={title}
      >
        {icon && <span className="mr-2 text-white/50 shrink-0">{icon}</span>}
        <span className="truncate pr-2">
          {selectedOption ? selectedOption.label : "Selecionar..."}
        </span>
        <ChevronDown size={12} className="absolute right-3 text-white/40 group-hover:text-white/80 pointer-events-none transition-colors" />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="absolute top-full left-0 right-0 mt-1.5 z-50 bg-[#121214]/95 border border-white/10 rounded-xl shadow-2xl overflow-y-auto max-h-[280px] py-1.5 backdrop-blur-xl"
            style={{
              boxShadow: "0 10px 30px -10px rgba(0,0,0,0.7), 0 1px 0 rgba(255,255,255,0.05) inset",
            }}
          >
            {options.length === 0 ? (
              <div className="px-3 py-2 text-[11px] text-white/40 italic text-center">Nenhuma opção disponível</div>
            ) : (
              options.map((option) => {
                const isEditing = option.value === editingId;

                if (isEditing) {
                  return (
                    <div
                      key={option.value}
                      className="px-2.5 py-1.5 text-xs rounded-lg mx-1 my-0.5 flex items-center bg-[#9D7CFF]/10 border border-[#9D7CFF]/20"
                    >
                      <input
                        type="text"
                        value={editingText}
                        onChange={(e) => setEditingText && setEditingText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleRenameSave();
                          } else if (e.key === "Escape") {
                            if (setEditingId) setEditingId(null);
                          }
                        }}
                        onBlur={handleRenameSave}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                        className="bg-zinc-950 border border-white/20 rounded px-2 py-1 text-xs text-white outline-none w-full"
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={option.value}
                    onContextMenu={(e) => handleContextMenu(e, option.value)}
                    onClick={() => {
                      onChange(option.value);
                      setIsOpen(false);
                    }}
                    className={`px-3 py-1.5 text-xs cursor-pointer transition-all duration-150 rounded-lg mx-1 my-0.5 flex items-center justify-between
                      ${option.value === value 
                        ? "bg-[#9D7CFF]/20 text-white font-semibold border border-[#9D7CFF]/25" 
                        : "text-white/80 hover:bg-white/[0.04] hover:text-white"
                      }`}
                  >
                    <span className="truncate pr-2">{option.label}</span>
                    {option.value === value && <Check size={12} className="text-[#9D7CFF] shrink-0" />}
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FlowDashboardPage() {
  const searchParams = useSearchParams();
  const [chatMessages, setChatMessages] = useState<ChatMessageState[]>([]);
  const [chatConversations, setChatConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [hasLoadedConversations, setHasLoadedConversations] = useState(false);
  const [isHeaderHovered, setIsHeaderHovered] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; value: string } | null>(null);
  const [messageContextMenu, setMessageContextMenu] = useState<{ x: number; y: number; messageId: string; role: 'user' | 'assistant' } | null>(null);
  const [editingConversationId, setEditingConversationId] = useState<string | null>(null);
  const [editingConversationText, setEditingConversationText] = useState("");

  useEffect(() => {
    if (!contextMenu && !messageContextMenu) return;
    const handleCloseMenu = () => {
      setContextMenu(null);
      setMessageContextMenu(null);
    };
    window.addEventListener("click", handleCloseMenu);
    window.addEventListener("contextmenu", handleCloseMenu);
    return () => {
      window.removeEventListener("click", handleCloseMenu);
      window.removeEventListener("contextmenu", handleCloseMenu);
    };
  }, [contextMenu, messageContextMenu]);

  const headerRef = useRef<HTMLHeadElement>(null);

  useEffect(() => {
    if (!isHeaderHovered) return;
    const handleClickOutsideHeader = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("[data-context-menu]")) {
        return;
      }
      if (headerRef.current && !headerRef.current.contains(target)) {
        setIsHeaderHovered(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutsideHeader);
    return () => document.removeEventListener("mousedown", handleClickOutsideHeader);
  }, [isHeaderHovered]);

  const hasAttempted3dRecoveryRef = useRef(false);
  const hasAppliedModeFromUrlRef = useRef(false);
  const applyingPlanIdsRef = useRef<Set<string>>(new Set());
  const autoDownloaded3dModelsRef = useRef<Set<string>>(new Set());
  const failed3dReconcileUntilRef = useRef<Record<string, number>>({});
  const [agentModel, setAgentModel] = useState<AgentModel>(() => {
    if (typeof window === "undefined") return "gemini";
    const savedModel = readFlowStorage(AGENT_MODEL_KEY);
    return isAgentModel(savedModel) ? savedModel : "gemini";
  });
  const [agentType, setAgentType] = useState<AgentType>('image');
  const [useCortexMemory, setUseCortexMemory] = useState(() =>
    typeof window === "undefined" ? true : readFlowStorage(USE_CORTEX_MEMORY_KEY) !== "false"
  );
  const [imageRatio, setImageRatio] = useState("16:9");
  const [imageQty, setImageQty] = useState("x2");
  const [imageModel, setImageModel] = useState("Nano Banana 2");
  const [image3dMode, setImage3dMode] = useState(false);
  const [image3dReadyMode, setImage3dReadyMode] = useState(false);
  
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [videoQty, setVideoQty] = useState("1x");
  const [videoModel, setVideoModel] = useState("Veo 3.1");

  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedResultImage, setExpandedResultImage] = useState<{ src: string; alt: string; downloadUrl: string } | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [editAttachmentFile, setEditAttachmentFile] = useState<File | null>(null);
  const [availableSkills, setAvailableSkills] = useState<{id:string,name:string,description?:string}[]>([]);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashSearch, setSlashSearch] = useState("");
  const [skillsLoading, setSkillsLoading] = useState(true);
  const [skillsError, setSkillsError] = useState("");
  const [skillBuilderActive, setSkillBuilderActive] = useState(false);

  useEffect(() => {
    setSkillsLoading(true);
    fetch("/api/skills")
      .then(r => {
        if (!r.ok) throw new Error("Falha na rede");
        return r.json();
      })
      .then(d => {
        setAvailableSkills(d.skills || []);
        setSkillsError("");
      })
      .catch(e => {
        console.error(e);
        setSkillsError("Erro ao carregar skills.");
      })
      .finally(() => setSkillsLoading(false));
  }, []);

  useEffect(() => {
    // Permite espaços no final da string pra não sumir se o user digitar "/skill "
    const match = draftMessage.match(/^\/([\w.-]*)/);
    if (match) {
      setSlashSearch(match[1].toLowerCase());
      setShowSlashMenu(true);
    } else {
      setShowSlashMenu(false);
    }
  }, [draftMessage]);

  const filteredSkills = availableSkills.filter(s => s.id.toLowerCase().includes(slashSearch) || s.name.toLowerCase().includes(slashSearch));
  const [editing3dImageMessageId, setEditing3dImageMessageId] = useState<string | null>(null);
  const [editing3dBaseImagePath, setEditing3dBaseImagePath] = useState<string | null>(null);
  const [preparing3dBaseMessageId, setPreparing3dBaseMessageId] = useState<string | null>(null);
  const [selectedElementReference, setSelectedElementReference] = useState<SelectedElementReference | null>(null);
  const [regenerating3dImage, setRegenerating3dImage] = useState<{ messageId: string; imageIndex: number } | null>(null);
  
  const [isBrowserOpen, setIsBrowserOpen] = useState(false);
  const [browserImage, setBrowserImage] = useState<string | null>(null);
  const [hasCheckedBrowserState, setHasCheckedBrowserState] = useState(false);

  useEffect(() => {
    if (!isBrowserOpen) return;
    let isMounted = true;
    setHasCheckedBrowserState(false);
    const fetchBrowserState = async () => {
      try {
        const res = await fetch('/api/flow/browser-state');
        if (!res.ok) {
          if (isMounted) setHasCheckedBrowserState(true);
          return;
        }
        const data = await res.json();
        if (isMounted) {
          setBrowserImage(data.image || null);
          setHasCheckedBrowserState(true);
        }
      } catch (err) {
        if (isMounted) setHasCheckedBrowserState(true);
      }
    };
    
    fetchBrowserState();
    const interval = setInterval(fetchBrowserState, 1500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [isBrowserOpen]);

  useLayoutEffect(() => {
    window.scrollTo(0, 0);
    if (document.documentElement) document.documentElement.scrollTop = 0;
    if (document.body) document.body.scrollTop = 0;
  }, []);

  const chatScrollContainerRef = useRef<HTMLDivElement>(null);
  const chatMessagesRef = useRef<any[]>([]);
  const shouldAutoScrollRef = useRef(true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const voiceRecognitionRef = useRef<any>(null);
  const voiceMicrophoneReleaseRef = useRef<(() => void) | null>(null);
  const voiceEnabledRef = useRef(false);
  const voiceAwaitingCommandRef = useRef(false);
  const voiceSpeakingRef = useRef(false);
  const voiceAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeAssistantSpeechRef = useRef("");
  const voicePlaybackSessionRef = useRef(0);
  const speechQueueRef = useRef<SpeechQueue | null>(null);
  if (!speechQueueRef.current) {
    speechQueueRef.current = new SpeechQueue(() => {
      voiceSpeakingRef.current = false;
      setVoiceSpeaking(false);
      if (voiceEnabledRef.current) {
        setVoiceStatus("Voz ativada. Pode falar.");
      }
    });
  }
  const cartesiaStreamCancelRef = useRef<(() => void) | null>(null);

  const cancelAllVoicePlayback = useCallback(() => {
    voicePlaybackSessionRef.current += 1;
    speechQueueRef.current?.cancelAll();
    if (cartesiaStreamCancelRef.current) {
      cartesiaStreamCancelRef.current();
      cartesiaStreamCancelRef.current = null;
    }
    const audio = voiceAudioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      voiceAudioRef.current = null;
    }
    window.speechSynthesis?.cancel();
    activeAssistantSpeechRef.current = "";
    voiceSpeakingRef.current = false;
    setVoiceSpeaking(false);
  }, []);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [voiceAwaitingCommand, setVoiceAwaitingCommand] = useState(false);
  const [voiceSpeaking, setVoiceSpeaking] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("Voz desligada.");
  const [voiceError, setVoiceError] = useState("");
  const [voiceTranscript, setVoiceTranscript] = useState("");

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  useEffect(() => {
    const handleSelectedReference = (event: Event) => {
      const detail = (event as CustomEvent<Partial<SelectedElementReference>>).detail;
      if (!detail || typeof detail.imageData !== 'string' || !detail.imageData.startsWith('data:image/')) return;
      if (typeof detail.xpath !== 'string' || !detail.xpath.trim()) return;
      setSelectedElementReference({
        imageData: detail.imageData,
        xpath: detail.xpath.trim(),
        label: typeof detail.label === 'string' ? detail.label : undefined,
      });
    };
    window.addEventListener('kaoz1:flow-reference-selected', handleSelectedReference);
    return () => window.removeEventListener('kaoz1:flow-reference-selected', handleSelectedReference);
  }, []);

  const activeJobPollingKey = chatMessages
    .filter((message) => message.jobId && message.jobStatus !== 'completed')
    .map((message) => `${message.id}:${message.jobId}:${message.jobStatus || 'pending'}`)
    .join('|');

  const scrollChatToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const container = chatScrollContainerRef.current;
    if (!container) return;

    container.scrollTo({
      top: container.scrollHeight,
      behavior
    });
    shouldAutoScrollRef.current = true;
  }, []);

  const handleInputOverlayWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const container = chatScrollContainerRef.current;
    if (!container) return;

    const target = event.target as HTMLElement | null;
    const editableElement = target?.closest("textarea, input, select, [contenteditable='true']") as HTMLElement | null;
    if (editableElement) {
      const canScrollEditable = editableElement.scrollHeight > editableElement.clientHeight;
      const canScrollDown = editableElement.scrollTop + editableElement.clientHeight < editableElement.scrollHeight;
      const canScrollUp = editableElement.scrollTop > 0;
      if (canScrollEditable && ((event.deltaY > 0 && canScrollDown) || (event.deltaY < 0 && canScrollUp))) {
        return;
      }
    }

    event.preventDefault();
    container.scrollTop += event.deltaY;
    shouldAutoScrollRef.current = isChatNearBottom(container);
  }, []);

  const renderSettingsMenu = (isFloatingRight = false) => {
    return (
      <motion.div
        ref={settingsMenuRef}
        className={`absolute bottom-full z-50 mb-3 flex w-[360px] max-w-[calc(100vw-32px)] max-h-[calc(100dvh-var(--kaoz1-titlebar-height,0px)-9rem)] flex-col gap-5 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d12]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl pointer-events-auto ${isFloatingRight ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left'}`}
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex flex-col gap-2">
          <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Tipo preferido</div>
          <div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
            {[
              { id: "image", label: "Imagem", icon: <ImageIcon size={13} /> },
              { id: "video", label: "Vídeo", icon: <Film size={13} /> },
              { id: "ad-creative", label: "Anúncio", icon: <Bot size={13} /> },
            ].map((t) => (
              <button
                key={t.id}
                onClick={() => {
                  setAgentType(t.id as AgentType);
                  if (t.id === "ad-creative") {
                    const currentNum = imageQty.startsWith("x") ? Number(imageQty.slice(1)) : 2;
                    if (currentNum < 4 || currentNum > 40) {
                      setImageQty("x20");
                    }
                  } else if (t.id === "image") {
                    const currentNum = imageQty.startsWith("x") ? Number(imageQty.slice(1)) : 20;
                    if (currentNum > 4) {
                      setImageQty("x2");
                    }
                  }
                }}
                className="flex min-h-9 items-center justify-center gap-1.5 rounded-xl px-2 text-[12px] font-semibold transition-all cursor-pointer text-center"
                style={{
                  background: agentType === t.id ? "rgba(255,255,255,0.14)" : "transparent",
                  color: agentType === t.id ? "#ffffff" : "rgba(255,255,255,0.42)"
                }}
              >
                {t.icon} <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Image mode (3D turnaround toggle) */}
        {agentType === "image" && (
          <div className="flex flex-col gap-2">
            <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
              Modo da imagem
            </div>
            <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
              {[
                { id: "standard", label: "Normal" },
                { id: "turnaround3d", label: "3D" },
              ].map((mode) => {
                const isActive = image3dMode ? mode.id === "turnaround3d" : mode.id === "standard";
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      const nextIs3d = mode.id === "turnaround3d";
                      setImage3dMode(nextIs3d);
                      if (nextIs3d) setImageQty("x4");
                      if (!nextIs3d) setImage3dReadyMode(false);
                    }}
                    className="min-h-9 rounded-xl px-2 text-[12px] font-semibold transition-all cursor-pointer"
                    style={{
                      background: isActive ? "rgba(255,255,255,0.14)" : "transparent",
                      color: isActive ? "#ffffff" : "rgba(255,255,255,0.42)",
                    }}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
            {image3dMode && (
              <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
                {[
                  { id: "create", label: "Criar base" },
                  { id: "ready", label: "Imagem pronta" },
                ].map((mode) => {
                  const isActive = image3dReadyMode ? mode.id === "ready" : mode.id === "create";
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setImage3dReadyMode(mode.id === "ready")}
                      className="min-h-8 rounded-xl px-2 text-[11px] font-semibold transition-all cursor-pointer"
                      style={{
                        background: isActive ? "rgba(157,124,255,0.18)" : "transparent",
                        color: isActive ? "#ffffff" : "rgba(255,255,255,0.42)",
                      }}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 transition-colors hover:bg-white/[0.07]">
          <span className="flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold text-white/85">Cortex</span>
            <span className="text-[10px] leading-snug text-white/45">Usar e gravar memoria cognitiva nas execucoes</span>
          </span>
          <input
            type="checkbox"
            checked={useCortexMemory}
            onChange={(e) => setUseCortexMemory(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-6 w-10 shrink-0 rounded-full border border-white/10 bg-white/10 transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white/70 after:transition-transform peer-checked:bg-[#8B5CF6]/80 peer-checked:after:translate-x-4 peer-checked:after:bg-white" />
        </label>

        <div className="flex flex-col gap-2">
          <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Modelo do agente</div>
          <CustomDropdown
            value={agentModel}
            onChange={(value) => {
              if (isAgentModel(value)) setAgentModel(value);
            }}
            options={AGENT_MODEL_OPTIONS}
            title="Modelo usado pelo chat; Cerebras/ZenMux + MCP habilita ferramentas de navegador."
          />
        </div>

        {/* Ratio + Quantity */}
        {agentType !== "project" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Proporção</div>
              <div className="grid min-h-[116px] grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
                {["16:9", "4:3", "1:1", "3:4", "9:16"].map((r) => {
                  const currentRatio = (agentType === "image" || agentType === "ad-creative") ? imageRatio : videoRatio;
                  const isActive = currentRatio === r;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        if (agentType === "image" || agentType === "ad-creative") setImageRatio(r);
                        else setVideoRatio(r);
                      }}
                      className="min-h-8 rounded-xl px-2 font-mono text-[13px] transition-all cursor-pointer"
                      style={{
                        background: isActive ? "#ffffff" : "transparent",
                        color: isActive ? "#080808" : "rgba(255,255,255,0.42)",
                        fontWeight: isActive ? 700 : 400,
                      }}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
                {agentType === "ad-creative" ? "Imagens" : "Quantidade"}
              </div>
              {agentType === "ad-creative" ? (
                <div className="flex min-h-[116px] flex-col justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[16px] font-bold text-white">
                      {imageQty.startsWith("x") ? imageQty.slice(1) : "20"}
                    </span>
                    <span className="font-mono text-[9px] uppercase tracking-wider text-white/45">Imagens</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={40}
                    step={1}
                    value={imageQty.startsWith("x") ? Number(imageQty.slice(1)) : 20}
                    onChange={(e) => {
                      setImageQty(`x${e.target.value}`);
                    }}
                    className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>
              ) : (
                <div className="grid min-h-[116px] grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1.5">
                  {["1x", "x2", "x3", "x4"].map((q) => {
                    const currentQty = agentType === "image" && image3dMode ? "x4" : (agentType === "image" ? imageQty : videoQty);
                    const isDisabled = (agentType === "video" && (q === "x3" || q === "x4")) || (agentType === "image" && image3dMode && q !== "x4");
                    const isActive = currentQty === q && !isDisabled;
                    return (
                      <button
                        key={q}
                        type="button"
                        disabled={isDisabled}
                        onClick={() => {
                          if (agentType === "image" && image3dMode) return;
                          if (agentType === "image") setImageQty(q);
                          else setVideoQty(q === "x3" || q === "x4" ? "x2" : q);
                        }}
                        className="min-h-8 rounded-xl px-2 font-mono text-[13px] transition-all"
                        style={{
                          background: isActive ? "#ffffff" : "transparent",
                          color: isActive ? "#080808" : isDisabled ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.42)",
                          fontWeight: isActive ? 700 : 400,
                          cursor: isDisabled ? "not-allowed" : "pointer",
                          opacity: isDisabled ? 0.25 : 1,
                        }}
                      >
                        {q}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </motion.div>
    );
  };

  useEffect(() => {
    const savedConversations = readJsonArray<ChatConversation>(readFlowStorage(CHAT_CONVERSATIONS_KEY));
    const legacyMessages = readJsonArray<ChatMessageState>(readFlowStorage(CHAT_HISTORY_KEY));
    const initialConversations = savedConversations.length > 0
      ? savedConversations
      : (legacyMessages.length > 0 ? [createChatConversation(legacyMessages)] : [createChatConversation()]);
    const savedActiveId = readFlowStorage(ACTIVE_CHAT_KEY);
    const activeConversation = initialConversations.find((conversation) => conversation.id === savedActiveId) || initialConversations[0];
    autoDownloaded3dModelsRef.current = new Set(
      initialConversations.flatMap((conversation) =>
        conversation.messages.flatMap((message) => message.model3dResult?.paths || (message.model3dResult?.path ? [message.model3dResult.path] : []))
      )
    );

    queueMicrotask(() => {
      setChatConversations(initialConversations);
      setActiveConversationId(activeConversation.id);
      setChatMessages(activeConversation.messages);
      setHasLoadedConversations(true);
    });

    const hydrateArchive = async () => {
      try {
        await fetch('/api/conversations/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversations: initialConversations.map((conversation) => ({
            ...conversation,
            messages: conversation.messages.map((message) => ({
              id: message.id,
              role: message.role,
              content: message.content,
              timestamp: message.timestamp,
              metadata: { ...message, attachedImage: undefined }
            }))
          })) })
        });
        const listResponse = await fetch('/api/conversations?limit=200');
        if (!listResponse.ok) return;
        const list = await listResponse.json() as { conversations?: Array<{ id: string; externalConversationId: string; title: string; createdAt: string; updatedAt: string }> };
        const loaded = await Promise.all((list.conversations || []).map(async (item) => {
          const response = await fetch(`/api/conversations/${encodeURIComponent(item.id)}?limit=500`);
          if (!response.ok) return null;
          const detail = await response.json() as { messages?: Array<{ externalMessageId: string; role: 'user' | 'assistant'; content: string; createdAt: string; metadata?: Record<string, unknown> }> };
          return {
            id: item.externalConversationId,
            title: item.title,
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
            messages: (detail.messages || []).map((message) => ({
              ...(message.metadata || {}),
              id: message.externalMessageId,
              role: message.role,
              content: message.content,
              timestamp: message.createdAt,
            } as ChatMessageState))
          } satisfies ChatConversation;
        }));
        const archived = loaded.filter((item): item is ChatConversation => Boolean(item));
        if (!archived.length) return;
        const nextActiveId = archived.some((item) => item.id === savedActiveId) ? savedActiveId! : archived[0].id;
        const active = archived.find((item) => item.id === nextActiveId)!;
        setChatConversations(archived);
        setActiveConversationId(active.id);
        setChatMessages(active.messages);
      } catch (error) {
        console.warn('Falha ao carregar arquivo SQLite; mantendo fallback local:', error);
      }
    };
    void hydrateArchive();
  }, []);

  useEffect(() => {
    const recoverJobId = searchParams.get("recover3d") || "";
    const stale3dJobIds = chatMessages
      .filter((msg) => msg.jobId && msg.plan?.imagePackageMode === "turnaround3d" && !msg.model3dResult?.path)
      .map((msg) => msg.jobId as string);
    const alreadyRecovered = recoverJobId && chatMessages.some((msg) =>
      msg.jobId === recoverJobId && Boolean(msg.model3dResult?.path)
    );
    if (!hasLoadedConversations || hasAttempted3dRecoveryRef.current) return;
    hasAttempted3dRecoveryRef.current = true;
    if (alreadyRecovered || (!recoverJobId && chatMessages.length > 0 && stale3dJobIds.length === 0)) return;

    let cancelled = false;
    const recoverLatest3dModel = async () => {
      try {
        const res = await fetch(recoverJobId ? `/api/jobs?jobId=${encodeURIComponent(recoverJobId)}` : "/api/jobs");
        if (!res.ok) return;
        const data = await res.json() as { jobs?: FlowJobSnapshot[] };
        const recoverableJobs = recoverJobId
          ? (data.jobs || [])
          : (data.jobs || []).filter((job) => !chatMessages.length || stale3dJobIds.includes(job.id || ""));
        const latest3dJob = (recoverJobId ? recoverableJobs : recoverableJobs
          .filter((job) => job.status === "completed" && buildModel3dResultFromJob(job))
          .sort((a, b) => Date.parse(b.updated_at || "") - Date.parse(a.updated_at || "")))[0];
        if (!latest3dJob || !latest3dJob.id || cancelled) return;

        const imagePaths = extractImagePathsFromJob(latest3dJob.source_video_transcription);
        const finalPath = latest3dJob.final_video_path || imagePaths[0] || "";
        const model3dResult = buildModel3dResultFromJob(latest3dJob);
        if (!model3dResult) return;

        const recoveredMessage: ChatMessageState = {
          id: createChatId("assistant"),
          role: "assistant",
          content: "Objeto 3D gerado no Hunyuan e recuperado para visualizacao no agente.",
          timestamp: new Date().toISOString(),
          plan: {
            kind: "image",
            flow: "image",
            originalPrompt: latest3dJob.topic || "Objeto 3D gerado",
            prompt: latest3dJob.topic || "Objeto 3D gerado",
            explanation: "Resultado 3D recuperado de um job concluido.",
            model: "gemini",
            aspectRatio: "1:1",
            imagePackageMode: "turnaround3d",
            turnaroundViews: ["front", "left", "right", "back"]
          },
          jobId: latest3dJob.id,
          jobType: "image",
          jobStatus: "completed",
          imageResult: finalPath ? {
            success: true,
            path: finalPath,
            filename: getResultFilename(finalPath),
            paths: imagePaths.length > 0 ? imagePaths : [finalPath],
            createdAt: latest3dJob.updated_at || new Date().toISOString()
          } : null,
          model3dResult,
          projectResult: null
        };

        if (!cancelled) {
          setChatMessages((previous) => {
            const existingIndex = previous.findIndex((msg) => msg.jobId === latest3dJob.id);
            if (existingIndex < 0) return previous.length > 0 && recoverJobId ? [...previous, recoveredMessage] : [recoveredMessage];
            return previous.map((msg, index) => index === existingIndex ? { ...msg, ...recoveredMessage, id: msg.id } : msg);
          });
        }
      } catch (err) {
        console.warn("Falha ao recuperar ultimo modelo 3D gerado:", err);
      }
    };

    void recoverLatest3dModel();
    return () => {
      cancelled = true;
    };
  }, [hasLoadedConversations, chatMessages, searchParams]);

  useEffect(() => {
    localStorage.setItem(USE_CORTEX_MEMORY_KEY, String(useCortexMemory));
  }, [useCortexMemory]);

  useEffect(() => {
    localStorage.setItem(AGENT_MODEL_KEY, agentModel);
  }, [agentModel]);

  useEffect(() => {
    if (!activeConversationId) return;
    try {
      const sanitizedMessages = sanitizeChatMessages(chatMessages);
      const updatedAt = new Date().toISOString();
      queueMicrotask(() => {
        setChatConversations((previous) =>
          previous.map((conversation) =>
            conversation.id === activeConversationId
              ? {
                  ...conversation,
                  title: getConversationTitleWithBranch(sanitizedMessages, conversation.title),
                  updatedAt,
                  messages: sanitizedMessages
                }
              : conversation
          )
        );
      });
    } catch (e) {
      console.warn("Falha ao salvar o histórico de chat no LocalStorage:", e);
    }
  }, [chatMessages, activeConversationId]);

  useEffect(() => {
    const container = chatScrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      shouldAutoScrollRef.current = isChatNearBottom(container);
    };

    handleScroll();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (!activeConversationId) return;
    shouldAutoScrollRef.current = true;
    requestAnimationFrame(() => {
      scrollChatToBottom();
    });
  }, [activeConversationId, scrollChatToBottom]);

  useLayoutEffect(() => {
    if (!shouldAutoScrollRef.current) return;

    const frame = requestAnimationFrame(() => {
      scrollChatToBottom();
    });

    return () => cancelAnimationFrame(frame);
  }, [chatMessages, isLoading, scrollChatToBottom]);

  useEffect(() => {
    if (chatConversations.length === 0) return;
    try {
    } catch (e) {
      console.warn("Falha ao salvar chatConversations no LocalStorage:", e);
    }
  }, [chatConversations]);

  useEffect(() => {
    if (!activeConversationId) return;
    try {
      localStorage.setItem(ACTIVE_CHAT_KEY, activeConversationId);
    } catch (e) {
      console.warn("Falha ao salvar activeConversationId no LocalStorage:", e);
    }
  }, [activeConversationId]);

  useEffect(() => {
    if (!hasLoadedConversations) return;

    const pendingDownloads = chatMessages.flatMap((message) => {
      if (message.jobStatus !== "completed" || !message.model3dResult?.path) return [];
      const paths = message.model3dResult.paths?.length ? message.model3dResult.paths : [message.model3dResult.path];
      return paths
        .filter((modelPath) => modelPath && !autoDownloaded3dModelsRef.current.has(modelPath))
        .map((modelPath) => ({ messageId: message.id, modelPath, filename: getResultFilename(modelPath) }));
    });

    if (pendingDownloads.length === 0) return;

    pendingDownloads.forEach(({ modelPath }) => {
      autoDownloaded3dModelsRef.current.add(modelPath);
      const downloadFrame = document.createElement("iframe");
      downloadFrame.src = getFlowDownloadUrl(modelPath);
      downloadFrame.style.display = "none";
      document.body.appendChild(downloadFrame);
      window.setTimeout(() => downloadFrame.remove(), 60000);
    });

    setChatMessages((previous) =>
      previous.map((message) => {
        const downloadedForMessage = pendingDownloads.filter((item) => item.messageId === message.id);
        if (downloadedForMessage.length === 0) return message;
        return {
          ...message,
          jobLogs: [
            ...(message.jobLogs || []),
            ...downloadedForMessage.map((item) =>
              `[${new Date().toLocaleTimeString()}] Download automatico do modelo 3D iniciado: ${item.filename}`
            )
          ]
        };
      })
    );
  }, [chatMessages, hasLoadedConversations]);

  useEffect(() => {
    const bodyEl = document.body;
    const mainEl = document.querySelector('main');
    const originalBodyOverflow = bodyEl.style.overflow;

    bodyEl.style.overflow = 'hidden';

    if (mainEl) {
      const originalBg = mainEl.style.backgroundColor;
      const originalOverflow = mainEl.style.overflow;
      // The cinematic background is rendered by this route. Keep the shared
      // dashboard container transparent so it is not painted over.
      mainEl.style.backgroundColor = 'transparent';
      mainEl.style.overflow = 'hidden';
      return () => {
        bodyEl.style.overflow = originalBodyOverflow;
        mainEl.style.backgroundColor = originalBg;
        mainEl.style.overflow = originalOverflow;
      };
    }

    return () => {
      bodyEl.style.overflow = originalBodyOverflow;
    };
  }, []);

  useEffect(() => {
    if (!showSettings) return;

    function handleClickOutside(event: MouseEvent) {
      if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSettings]);

  useEffect(() => {
    if (!expandedResultImage) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setExpandedResultImage(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [expandedResultImage]);

  // Polling events
  useEffect(() => {
    const needsModel3dReconcile = (message: ChatMessageState) =>
      message.plan?.imagePackageMode === 'turnaround3d' && !message.model3dResult?.path;
    const isWithin3dFailureReconcileWindow = (message: ChatMessageState) => {
      if (!message.jobId || message.jobStatus !== "failed" || !needsModel3dReconcile(message)) return false;
      return (failed3dReconcileUntilRef.current[message.jobId] || 0) > Date.now();
    };

    const getActiveJobs = () => chatMessagesRef.current.filter((m) => {
      if (!m.jobId || m.jobStatus === "completed") return false;
      if (m.jobStatus === "failed") return isWithin3dFailureReconcileWindow(m);
      return m.jobStatus === "running" || needsModel3dReconcile(m);
    });
    if (getActiveJobs().length === 0) return;

    let isMounted = true;
    const poll = async () => {
      if (!isMounted) return;
      const activeJobs = getActiveJobs();
      if (activeJobs.length === 0) return;
      let updated = false;
      const nextMessages = chatMessagesRef.current.map((message) => ({
        ...message,
        jobLogs: message.jobLogs ? [...message.jobLogs] : message.jobLogs,
      }));

      for (const msg of activeJobs) {
        try {
          const res = await fetch(`/api/jobs/events?jobId=${msg.jobId}`);
          if (!res.ok) continue;
          const data = await res.json();
          const events = data.events || [];

          const msgIndex = nextMessages.findIndex(m => m.id === msg.id);
          if (msgIndex < 0) continue;

          const currentLogs = nextMessages[msgIndex].jobLogs || [];
          const newEvents = events.filter((e: any) => !currentLogs.some((log: string) => log.includes(e.id)));
          
          if (newEvents.length > 0) {
            updated = true;
            nextMessages[msgIndex].jobLogs = [
              ...currentLogs,
              ...newEvents.map((e: any) => `[${new Date(e.created_at).toLocaleTimeString()}] [${e.id}] ${e.message}`)
            ];
          }

          const hasFinished = events.some((e: any) => e.event_type === "completed" || e.event_type === "failed");
          if (hasFinished) {
            updated = true;
            const jobRes = await fetch(`/api/jobs?jobId=${msg.jobId}`);
            if (jobRes.ok) {
              const jobData = await jobRes.json();
              const job = jobData.jobs?.[0];
              if (job) {
                if (job.status === "completed") {
                  nextMessages[msgIndex].jobStatus = 'completed';
                  const finalPath = job.final_video_path || "";
                  const model3dResult = buildModel3dResultFromJob(job);
                  nextMessages[msgIndex].projectResult = null;
                  if (msg.jobId) delete failed3dReconcileUntilRef.current[msg.jobId];
                  if (model3dResult) {
                    nextMessages[msgIndex].model3dResult = model3dResult;
                  }
                  if (msg.jobType === "image" || msg.jobType === "ad-creative") {
                     nextMessages[msgIndex].imageResult = buildImageResultFromJob(job);
                  } else if (msg.jobType === "video") {
                     nextMessages[msgIndex].videoResult = {
                       success: true,
                       path: finalPath,
                       filename: getResultFilename(finalPath),
                       createdAt: job.updated_at
                     };
                  } else {
                     nextMessages[msgIndex].projectResult = {
                       success: true,
                       jobId: msg.jobId!,
                       videoPath: finalPath
                     };
                  }
                } else {
                  nextMessages[msgIndex].jobStatus = 'failed';
                  const finalPath = job.final_video_path || "";
                  const imagePaths = (msg.jobType === "image" || msg.jobType === "ad-creative")
                    ? extractImagePathsFromJob(job.source_video_transcription)
                    : [];
                  if (needsModel3dReconcile(nextMessages[msgIndex]) && (imagePaths.length > 0 || finalPath)) {
                    failed3dReconcileUntilRef.current[msg.jobId!] = Date.now() + 10 * 60 * 1000;
                  }
                  if ((msg.jobType === "image" || msg.jobType === "ad-creative") && (imagePaths.length > 0 || finalPath)) {
                    nextMessages[msgIndex].imageResult = {
                      success: true,
                      path: finalPath,
                      filename: getResultFilename(finalPath),
                      paths: imagePaths.length > 0 ? imagePaths : [finalPath],
                      createdAt: job.updated_at
                    };
                  }
                  nextMessages[msgIndex].projectResult = {
                     success: false,
                     error: job.error_message || "Falha na execução."
                  };
                }
              }
            }
          }
        } catch (err) {}
      }
      if (updated && isMounted) {
        const activeMessageIds = new Set(activeJobs.map((message) => message.id));
        const updatesById = new Map(nextMessages
          .filter((message) => activeMessageIds.has(message.id))
          .map((message) => [message.id, message]));
        setChatMessages((previous) => previous.map((message) => updatesById.get(message.id) || message));
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [activeJobPollingKey]);

  const speakAssistantResponse = useCallback(async (content: string) => {
    const text = getAssistantSpeechText(content);
    if (!text) return;
    const playbackSession = ++voicePlaybackSessionRef.current;

    activeAssistantSpeechRef.current = text;
    voiceSpeakingRef.current = true;
    setVoiceSpeaking(true);
    setVoiceStatus("Kaoz.1 esta falando...");
    setVoiceError("");

    try {
      voiceAudioRef.current?.pause();

      const ttsRes = await fetch("/api/tts/config");
      const ttsConfig = await ttsRes.json().catch(() => null);

      if (ttsConfig?.provider === "cartesia") {
        let emotion = ttsConfig.cartesiaEmotion || "auto";
        if (emotion === "happy") emotion = "positivity";
        if (emotion === "sad") emotion = "sadness";
        if (emotion === "fear") emotion = "curiosity";

        let model = ttsConfig.cartesiaModel || "sonic-3.5";
        if (model === "sonic") model = "sonic-3.5";
        if (model === "sonic-multilingual") model = "sonic-3";

        const playback = playCartesiaVoiceWebSocket(
          ttsConfig.cartesiaApiKey,
          ttsConfig.cartesiaVoiceId,
          text,
          model,
          ttsConfig.cartesiaSpeed || "auto",
          emotion
        );
        cartesiaStreamCancelRef.current = playback.cancel;
        await playback.promise;
      } else if (ttsConfig?.provider === "browser") {
        await new Promise<void>((resolve, reject) => {
          const utterance = new SpeechSynthesisUtterance(text);
          utterance.onend = () => resolve();
          utterance.onerror = () => reject(new Error("Falha na sintese de voz do navegador."));
          window.speechSynthesis.speak(utterance);
        });
      } else {
        // Fallback to OmniVoice
        const res = await fetch(ttsConfig?.provider === "fish-audio" ? "/api/fish-audio/speak" : "/api/omnivoice/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text })
        });
        const data = await res.json() as { audioPath?: string; error?: string };
        if (!res.ok || !data.audioPath) {
          throw new Error(data.error || "Nao foi possivel gerar a voz do Kaoz.1.");
        }

        const audio = new Audio(data.audioPath);
        voiceAudioRef.current = audio;
        await new Promise<void>((resolve, reject) => {
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error("Nao foi possivel tocar o audio gerado."));
          void audio.play().catch(reject);
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setVoiceError(message);
      setVoiceStatus("Nao consegui falar a resposta.");
    } finally {
      if (voicePlaybackSessionRef.current !== playbackSession) return;
      activeAssistantSpeechRef.current = "";
      voiceSpeakingRef.current = false;
      setVoiceSpeaking(false);
      if (voiceEnabledRef.current) {
        setVoiceStatus("Voz ativada. Pode falar.");
        try {
          voiceRecognitionRef.current?.start();
        } catch {
          // The recognizer may already be active.
        }
      }
    }
  }, []);

  const handleSendMessage = async (message: string, files: any[], pastedContent: any[], options: SendMessageOptions = {}) => {
    if (editing3dImageMessageId) {
      await handleEdit3dBaseImage(editing3dImageMessageId, message, editing3dBaseImagePath);
      return;
    }

    let content = message;
    if (pastedContent.length > 0) {
      content += "\n\n" + pastedContent.map((p: any) => p.content).join("\n\n");
    }
    
    let referenceImageBase64: string | null = selectedElementReference?.imageData || null;
    let referenceSource: ImageReferenceSource = selectedElementReference ? 'selected-element' : 'none';
    let referenceXPath: string | null = selectedElementReference?.xpath || null;
    if (files.length > 0) {
      const file = files[0].file;
      referenceImageBase64 = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(typeof e.target?.result === "string" ? e.target.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (referenceImageBase64) {
        referenceSource = 'upload';
        referenceXPath = null;
        content += `\n\n[Imagem de referência anexada]`;
      }
    } else if (selectedElementReference) {
      content += `\n\n[Elemento visual selecionado como referência: ${selectedElementReference.label || selectedElementReference.xpath}]`;
    }

    const chatModel: AgentModel = agentModel;

    const userMsg: ChatMessageState = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      attachedImage: referenceImageBase64
    };

    shouldAutoScrollRef.current = true;
    setChatMessages(prev => [...prev, userMsg]);
    if (selectedElementReference) setSelectedElementReference(null);
    setIsLoading(true);

    const shouldUseSkillBuilder = skillBuilderActive || isBuildSkillsIntent(message);
    if (shouldUseSkillBuilder) {
      const assistantId = createChatId("assistant");
      try {
        const builderMessages = chatMessages.concat(userMsg).slice(-12).map((item) => ({
          role: item.role,
          content: item === userMsg ? item.content.replace(/^\s*\/build-skills\s*/i, "") : item.content,
        }));
        const response = await fetch("/api/skills/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: builderMessages }),
        });
        const data = await response.json() as {
          message?: string;
          ready?: boolean;
          skill?: ChatMessageState["skillDraft"];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error || "O criador de skills não conseguiu responder.");
        setSkillBuilderActive(!data.ready);
        setChatMessages(prev => [...prev, {
          id: assistantId,
          role: 'assistant',
          content: data.message || "Preparei o rascunho da skill para sua revisão.",
          timestamp: new Date().toISOString(),
          skillDraft: data.ready ? data.skill : null,
        }]);
      } catch (error) {
        setSkillBuilderActive(false);
        setChatMessages(prev => [...prev, {
          id: assistantId,
          role: 'assistant',
          content: `Não consegui criar a skill: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: new Date().toISOString(),
        }]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const geminiMessages = chatMessages.concat(userMsg)
      .slice(-20)
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

    const assistantMessageId = createChatId("assistant");
    let streamedContent = "";
    const appendAssistantChunk = (chunk: string) => {
      if (!chunk) return;

      streamedContent += chunk;
      shouldAutoScrollRef.current = true;
      setChatMessages(prev => {
        const existingIndex = prev.findIndex(m => m.id === assistantMessageId);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = {
            ...next[existingIndex],
            content: streamedContent
          };
          return next;
        }

        return [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: streamedContent,
            timestamp: new Date().toISOString()
          }
        ];
      });
    };

    const showAssistantStatus = (statusText: string) => {
      if (!statusText || streamedContent) return;

      shouldAutoScrollRef.current = true;
      setChatMessages(prev => {
        const existingIndex = prev.findIndex(m => m.id === assistantMessageId);
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = {
            ...next[existingIndex],
            content: statusText
          };
          return next;
        }

        return [
          ...prev,
          {
            id: assistantMessageId,
            role: 'assistant',
            content: statusText,
            timestamp: new Date().toISOString()
          }
        ];
      });
    };

    const upsertAgentMessage = (agentMsg: ChatMessageState) => {
      setChatMessages(prev => {
        const existingIndex = prev.findIndex(m => m.id === agentMsg.id);
        if (existingIndex < 0) return [...prev, agentMsg];

        const next = [...prev];
        next[existingIndex] = agentMsg;
        return next;
      });
    };

    try {
      cancelAllVoicePlayback();
      const playbackSession = voicePlaybackSessionRef.current;
      const voiceContext = getAgentVoiceContext(message, options.speakResponse === true);
      let voiceExpressionContext: VoiceExpressionContext = {
        mode: voiceContext.layers.includes("amused") ? "playful" : "neutral",
        energy: 0.5,
        warmth: 0.65,
        seriousness: 0.5,
        playfulness: voiceContext.layers.includes("amused") ? 0.8 : 0.4,
        explicitLayers: voiceContext.layers,
        explicit: voiceContext.explicit
      };
      const fishExpressionReplyState = createFishExpressionReplyState();
      const ttsRes = await fetch("/api/tts/config").catch(() => null);
      const ttsConfig = ttsRes ? await ttsRes.json().catch(() => null) : null;

      let cartesiaStream: any = null;
      const shouldBatchFishAudio = options.speakResponse && ttsConfig?.provider === "fish-audio";
      if (options.speakResponse && ttsConfig?.provider === "cartesia") {
        let emotion = ttsConfig.cartesiaEmotion || "auto";
        if (emotion === "happy") emotion = "positivity";
        if (emotion === "sad") emotion = "sadness";
        if (emotion === "fear") emotion = "curiosity";

        let model = ttsConfig.cartesiaModel || "sonic-3.5";
        if (model === "sonic") model = "sonic-3.5";
        if (model === "sonic-multilingual") model = "sonic-3";
        const voiceControls = resolveCartesiaVoiceControls(
          voiceContext,
          ttsConfig.cartesiaSpeed || "auto",
          emotion
        );

        voiceSpeakingRef.current = true;
        setVoiceSpeaking(true);
        setVoiceStatus("Kaoz.1 esta falando...");

        try {
          cartesiaStream = playCartesiaVoiceStream(
            ttsConfig.cartesiaApiKey,
            ttsConfig.cartesiaVoiceId,
            model,
            voiceControls.speed,
            voiceControls.emotion
          );
          cartesiaStreamCancelRef.current = cartesiaStream.cancel;
          
          cartesiaStream.promise.then(() => {
            if (voicePlaybackSessionRef.current !== playbackSession) return;
            voiceSpeakingRef.current = false;
            setVoiceSpeaking(false);
            if (voiceEnabledRef.current) {
              setVoiceStatus("Voz ativada. Pode falar.");
            }
          }).catch((err: any) => {
            console.error("Erro na reprodução do stream Cartesia:", err);
          });
        } catch (streamErr) {
          console.error("Erro ao iniciar o stream Cartesia:", streamErr);
        }
      }

      const speakTextChunk = (textToSpeak: string, isLast = false) => {
        if (!options.speakResponse || voicePlaybackSessionRef.current !== playbackSession) return;
        const compiledSpeech = ttsConfig?.provider === "fish-audio"
          ? compileFishAudioSpeech(
              textToSpeak,
              voiceExpressionContext,
              ttsConfig.fishAudioExpressionLevel || "natural",
              ttsConfig.fishAudioModel,
              fishExpressionReplyState
            )
          : {
              speechText: compileAgentSpeech(textToSpeak, voiceContext, ttsConfig?.provider || "omnivoice"),
              transcriptText: getAssistantSpeechText(textToSpeak)
            };
        const speechText = compiledSpeech.speechText;
        if (!speechText) {
          if (cartesiaStream && isLast) cartesiaStream.sendChunk(" ", true);
          return;
        }

        activeAssistantSpeechRef.current = `${activeAssistantSpeechRef.current} ${compiledSpeech.transcriptText}`.trim();

        if (cartesiaStream) {
          cartesiaStream.sendChunk(speechText, isLast);
          return;
        }

        let fishAudioPathPromise: Promise<string> | null = null;
        if (ttsConfig?.provider === "fish-audio") {
          fishAudioPathPromise = fetch("/api/fish-audio/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: speechText })
          }).then(async (res) => {
            const data = await res.json() as { audioPath?: string; error?: string };
            if (!res.ok || !data.audioPath) {
              throw new Error(data.error || "Nao foi possivel gerar a voz do Kaoz.1.");
            }
            return data.audioPath;
          });
          void fishAudioPathPromise.catch(() => {});
        }
        
        speechQueueRef.current?.enqueue(() => {
          if (ttsConfig?.provider === "browser") {
            voiceSpeakingRef.current = true;
            setVoiceSpeaking(true);
            setVoiceStatus("Kaoz.1 esta falando...");
            
            let utterance: SpeechSynthesisUtterance | null = null;
            const promise = new Promise<void>((resolve, reject) => {
              utterance = new SpeechSynthesisUtterance(speechText);
              utterance.onend = () => resolve();
              utterance.onerror = () => reject(new Error("Falha na sintese de voz do navegador."));
              window.speechSynthesis.speak(utterance);
            });
            return {
              promise: promise.catch(() => {}),
              cancel: () => {
                if (utterance) window.speechSynthesis.cancel();
              }
            };
          } else {
            // Fallback to OmniVoice
            voiceSpeakingRef.current = true;
            setVoiceSpeaking(true);
            setVoiceStatus("Kaoz.1 esta falando...");
            let audio: HTMLAudioElement | null = null;
            let isCancelled = false;

            const promise = new Promise<void>(async (resolve, reject) => {
              try {
                if (isCancelled) { resolve(); return; }
                const audioPath = fishAudioPathPromise || fetch("/api/omnivoice/speak", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ text: speechText })
                  }).then(async (res) => {
                    const data = await res.json() as { audioPath?: string; error?: string };
                    if (!res.ok || !data.audioPath) {
                      throw new Error(data.error || "Nao foi possivel gerar a voz do Kaoz.1.");
                    }
                    return data.audioPath;
                  });
                const audioUrl = await audioPath;
                if (isCancelled) { resolve(); return; }

                audio = new Audio(audioUrl);
                voiceAudioRef.current = audio;
                
                audio.onended = () => resolve();
                audio.onerror = () => reject(new Error("Nao foi possivel tocar o audio gerado."));
                void audio.play().catch(reject);
              } catch (err) {
                reject(err);
              }
            });

            return {
              promise: promise.catch(() => {}),
              cancel: () => {
                isCancelled = true;
                if (audio) {
                  try {
                    audio.pause();
                    audio.currentTime = 0;
                  } catch {}
                }
              }
            };
          }
        });
      };

      const requestedImageOperation: ImageGenerationOperation =
        referenceImageBase64 && !image3dMode && isImageEditIntent(message)
          ? "edit"
          : resolveImageGenerationOperation({
              imagePackageMode: image3dMode ? "turnaround3d" : undefined,
              referenceImage: referenceImageBase64,
            });

      const res = await fetch("/api/flow/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: geminiMessages,
          referenceImage: referenceImageBase64,
          requestedFlow: agentType,
          imageOperation: requestedImageOperation,
          imageAspectRatio: imageRatio,
          useCortexMemory,
          model: chatModel,
          stream: true,
          voiceActive: options.speakResponse === true,
          sessionId: activeConversationId,
          archiveContext: {
            conversationId: activeConversationId,
            userMessageId: userMsg.id,
            assistantMessageId,
            title: activeConversation?.title || getConversationTitle(chatMessages.concat(userMsg))
          }
        })
      });
      if (!res.ok) {
        const errorPayload = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(errorPayload.error || `Falha no chat (HTTP ${res.status}).`);
      }
      let streamedData: FlowChatResponse | null = null;
      if (res.body && res.headers.get("content-type")?.includes("text/event-stream")) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let sentenceBuffer = "";

        const processStreamTextChunk = async (text: string) => {
          if (shouldBatchFishAudio) {
            sentenceBuffer = queueCompleteSpeechSentences(sentenceBuffer + text, speakTextChunk, 80);
          } else {
            sentenceBuffer = queueCompleteSpeechSentences(sentenceBuffer + text, speakTextChunk);
          }

          for (let i = 0; i < text.length; i += 4) {
            appendAssistantChunk(text.slice(i, i + 4));
            await new Promise(r => setTimeout(r, 15));
          }
        };

        const processStreamBlock = async (block: string) => {
          const parsed = parseFlowChatStreamEvent(block);
          if (!parsed) return;

          if (parsed.event === "chunk") {
            await processStreamTextChunk(parsed.data.text || "");
          } else if (parsed.event === "voice-context" && parsed.data.context) {
            voiceExpressionContext = parsed.data.context;
          } else if (parsed.event === "status") {
            showAssistantStatus(parsed.data.text || "");
          } else if (parsed.event === "final") {
            streamedData = parsed.data;
          } else if (parsed.event === "error") {
            throw new Error(parsed.data.error || "Falha no stream do chat.");
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            await processStreamBlock(block);
          }
        }

        buffer += decoder.decode();
        if (buffer.trim()) {
          await processStreamBlock(buffer);
        }

        if (sentenceBuffer.trim()) {
          speakTextChunk(sentenceBuffer.trim(), true);
        } else if (cartesiaStream) {
          speakTextChunk(" ", true);
        }

        if (!streamedData) {
          throw new Error("O stream do chat terminou sem resposta final.");
        }
      }

      const data: FlowChatResponse = streamedData || await res.json();
      
      const agentMsg: ChatMessageState = {
        id: assistantMessageId,
        role: 'assistant',
        content: data.message || "Aqui está o que preparei.",
        timestamp: new Date().toISOString(),
        artifacts: data.artifacts,
        artifactError: data.artifactError,
      };

      if (data.action && data.action.flow) {
        const plannedKind = data.action.flow === 'refine' ? 'project' : data.action.flow;
        const isAdCreative = plannedKind === 'ad-creative';
        const requestedImageCount = (plannedKind === 'image' || isAdCreative) && !image3dMode
          ? normalizeRequestedImageCount(data.action.requestedImageCount) || extractRequestedImageCount(message) || (isAdCreative ? (imageQty.startsWith("x") ? Number(imageQty.slice(1)) : 20) : undefined)
          : undefined;

        agentMsg.plan = {
          kind: plannedKind, 
          flow: data.action.flow,
          originalPrompt: message,
          prompt: data.action.optimizedPrompt || message,
          explanation: data.action.explanation || "",
          model: chatModel,
          aspectRatio: (plannedKind === 'image' || isAdCreative) ? imageRatio : videoRatio,
          mediaModel: (plannedKind === 'image' || isAdCreative) ? imageModel : videoModel,
          referenceImage: referenceImageBase64,
          imageOperation: requestedImageOperation,
          referenceSource: referenceImageBase64 ? referenceSource : 'none',
          referenceXPath,
          targetJobId: data.action.targetJobId,
          strategy: data.action.strategy,
          scriptOutline: data.action.scriptOutline,
          creativeSteps: data.action.creativeSteps,
          requestedImageCount,
          imagePackageMode: plannedKind === 'image' && image3dMode ? 'turnaround3d' : undefined,
          requires3dBasePreparation: plannedKind === 'image' && image3dMode && Boolean(referenceImageBase64) && !image3dReadyMode,
          quantity: (plannedKind === 'image' || isAdCreative) ? imageQty : videoQty,
          useCortexMemory,
          adCreativePlan: data.action.adCreativePlan
        };

        if (plannedKind === 'image' && image3dMode && referenceImageBase64 && image3dReadyMode) {
          agentMsg.plan.explanation = "Imagem pronta recebida. Aprove para gerar apenas as variações de ângulo usando essa imagem como base.";
          agentMsg.content = "Vou usar a imagem anexada como base pronta e gerar somente os ângulos do pacote 3D.";
        } else if (plannedKind === 'image' && image3dMode && referenceImageBase64) {
          agentMsg.plan.explanation = "Imagem recebida. Gere primeiro a base 3D para revisão; os ângulos só serão produzidos depois da sua aprovação.";
          agentMsg.content = "Preparei o plano da base 3D. Clique em Gerar base para revisão antes de continuar para os ângulos.";
        }
      }

      upsertAgentMessage(agentMsg);
    } catch (err) {
       console.error(err);
       const errorMessage = err instanceof Error ? err.message : String(err);
       upsertAgentMessage({
         id: assistantMessageId,
         role: 'assistant',
         content: `Nao consegui processar esta solicitacao: ${errorMessage}`,
         timestamp: new Date().toISOString(),
       });
    } finally {
       setIsLoading(false);
     }
  };

  const handleVoiceCommand = async (command: string) => {
    const cleanCommand = normalizeVoiceText(command);
    if (!cleanCommand || isLoading) return;

    setVoiceStatus("Kaoz.1 esta pensando...");
    setVoiceError("");
    setDraftMessage("");

    await handleSendMessage(cleanCommand, [], [], { speakResponse: true });
  };

  const handleSaveSkillDraft = async (messageId: string) => {
    const target = chatMessages.find((item) => item.id === messageId);
    if (!target?.skillDraft || target.skillDraft.saveStatus === 'saving') return;
    const updateDraft = (patch: Partial<NonNullable<ChatMessageState["skillDraft"]>>) => {
      setChatMessages(prev => prev.map((item) => item.id === messageId && item.skillDraft
        ? { ...item, skillDraft: { ...item.skillDraft, ...patch } }
        : item));
    };
    updateDraft({ saveStatus: 'saving', saveError: undefined });
    try {
      const response = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: "1.0.0",
          enabled: true,
          approvalMode: "plan",
          preferredTools: [],
          requiredCapabilities: [],
          tools: [],
          ...target.skillDraft,
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "Falha ao salvar a skill.");
      updateDraft({ saveStatus: 'saved' });
      setAvailableSkills(prev => prev.some((skill) => skill.id === target.skillDraft!.id)
        ? prev
        : [...prev, { id: target.skillDraft!.id, name: target.skillDraft!.name, description: target.skillDraft!.description }]);
    } catch (error) {
      updateDraft({ saveStatus: 'error', saveError: error instanceof Error ? error.message : String(error) });
    }
  };

  const handleVoiceTranscript = (transcript: string) => {
    if (voiceSpeakingRef.current && isLikelyAssistantEcho(transcript, activeAssistantSpeechRef.current)) {
      return;
    }
    cancelAllVoicePlayback();

    void handleVoiceCommand(transcript);
  };

  const startVoiceWakeListening = () => {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceError("Reconhecimento de voz nativo indisponivel neste navegador.");
      setVoiceStatus("Voz indisponivel.");
      return;
    }

    try {
      const microphoneSession = acquireMicrophoneSession();
      voiceMicrophoneReleaseRef.current = microphoneSession.release;
    } catch (error) {
      setVoiceError(error instanceof Error ? error.message : "O microfone ja esta em uso.");
      setVoiceStatus("Voz indisponivel.");
      return;
    }

    voiceRecognitionRef.current?.abort();
    const recognition = new Recognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "pt-BR";
    recognition.onresult = (event) => {
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript;
        if (result?.isFinal && transcript) {
          handleVoiceTranscript(transcript);
        } else if (transcript) {
          interim += transcript;
        }
      }
      if (
        interim &&
        voiceSpeakingRef.current &&
        !isLikelyAssistantEcho(interim, activeAssistantSpeechRef.current)
      ) {
        cancelAllVoicePlayback();
        setVoiceStatus("Entendi, pode continuar.");
      }
      setVoiceTranscript(interim);
    };
    let endedWithError = false;
    recognition.onerror = (event) => {
      endedWithError = true;
      const errorMessage = event.message || event.error || "Falha no reconhecimento de voz.";
      setVoiceError(errorMessage);
      setVoiceStatus("Voz desligada apos erro de microfone.");
      voiceEnabledRef.current = false;
      setVoiceEnabled(false);
      voiceMicrophoneReleaseRef.current?.();
      voiceMicrophoneReleaseRef.current = null;
    };
    recognition.onend = () => {
      if (!voiceEnabledRef.current || endedWithError) return;
      window.setTimeout(() => {
        if (!voiceEnabledRef.current) return;
        try {
          recognition.start();
          setVoiceStatus("Voz ativada. Pode falar.");
        } catch {
          setVoiceStatus("Escuta pausada.");
        }
      }, 350);
    };

    voiceRecognitionRef.current = recognition;
    voiceEnabledRef.current = true;
    setVoiceEnabled(true);
    setVoiceError("");
    setVoiceStatus("Voz ativada. Pode falar.");

    try {
      recognition.start();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Nao foi possivel iniciar o microfone.";
      setVoiceError(message);
      setVoiceStatus("Voz indisponivel.");
      voiceMicrophoneReleaseRef.current?.();
      voiceMicrophoneReleaseRef.current = null;
    }
  };

  const stopVoiceWakeListening = () => {
    voiceEnabledRef.current = false;
    voiceAwaitingCommandRef.current = false;
    setVoiceEnabled(false);
    setVoiceAwaitingCommand(false);
    setVoiceStatus("Voz desligada.");
    setVoiceTranscript("");
    voiceRecognitionRef.current?.abort();
    voiceRecognitionRef.current = null;
    voiceMicrophoneReleaseRef.current?.();
    voiceMicrophoneReleaseRef.current = null;
    cancelAllVoicePlayback();
    voiceAudioRef.current = null;
  };

  const toggleVoiceMode = () => {
    if (voiceEnabledRef.current) {
      stopVoiceWakeListening();
    } else {
      startVoiceWakeListening();
    }
  };

  useEffect(() => {
    return () => {
      voiceEnabledRef.current = false;
      voiceRecognitionRef.current?.abort();
      voiceMicrophoneReleaseRef.current?.();
      voiceMicrophoneReleaseRef.current = null;
      cancelAllVoicePlayback();
    };
  }, [cancelAllVoicePlayback]);

  const handlePrepare3dBase = async (msgId: string) => {
    if (preparing3dBaseMessageId || applyingPlanIdsRef.current.has(msgId)) return;
    const targetMessage = chatMessages.find((message) => message.id === msgId);
    const plan = targetMessage?.plan;
    if (!plan?.requires3dBasePreparation || !plan.referenceImage) return;

    applyingPlanIdsRef.current.add(msgId);
    setPreparing3dBaseMessageId(msgId);
    try {
      const baseImageData = await generate3dBaseImage({
        prompt: build3dBasePrompt(plan.prompt || plan.originalPrompt),
        aspectRatio: plan.aspectRatio || imageRatio,
        model: plan.mediaModel || imageModel,
        referenceImage: plan.referenceImage,
        forceReferenceUpload: true,
        operation: 'reference',
      });
      const baseImagePath = baseImageData.path || baseImageData.paths?.[0] || null;
      if (!baseImagePath) throw new Error('O Flow nao retornou o caminho da imagem base 3D.');

      setChatMessages((previous) => previous.map((message) => message.id === msgId
        ? {
            ...message,
            content: 'Gerei a imagem base para revisao. Aprove para continuar os angulos ou edite a base antes.',
            imageResult: baseImageData,
            plan: message.plan ? {
              ...message.plan,
              referenceImage: null,
              referenceImagePath: baseImagePath,
              referenceSource: 'generated',
              requires3dBasePreparation: false,
            } : message.plan,
          }
        : message
      ));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setChatMessages((previous) => previous.map((message) => message.id === msgId
        ? {
            ...message,
            content: `Nao consegui gerar a imagem base 3D: ${errorMessage}`,
            jobLogs: [...(message.jobLogs || []), `[${new Date().toLocaleTimeString()}] Falha ao gerar base 3D: ${errorMessage}`],
          }
        : message
      ));
    } finally {
      applyingPlanIdsRef.current.delete(msgId);
      setPreparing3dBaseMessageId(null);
    }
  };

  const handleApplyPlan = async (msgId: string) => {
    if (applyingPlanIdsRef.current.has(msgId)) return;
    const msg = chatMessages.find((message) => message.id === msgId);
    if (!msg?.plan || msg.jobId || msg.jobStatus === 'running') return;

    applyingPlanIdsRef.current.add(msgId);
    shouldAutoScrollRef.current = true;
    setChatMessages((previous) => previous.map((message) => message.id === msgId
      ? {
          ...message,
          jobStatus: 'running',
          jobLogs: [`[${new Date().toLocaleTimeString()}] Iniciando a execução do plano...`],
          jobType: msg.plan!.kind,
        }
      : message
    ));

    try {
      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          requestId: msg.id,
          prompt: msg.plan.originalPrompt,
          imageOperation: msg.plan.imageOperation,
          referenceSource: msg.plan.referenceSource,
          referenceXPath: msg.plan.referenceXPath,
          useCortexMemory: msg.plan.useCortexMemory ?? useCortexMemory,
          model: msg.plan.model,
          aspectRatio: msg.plan.aspectRatio,
          imageModel: (msg.plan.kind === 'image' || msg.plan.kind === 'ad-creative') ? msg.plan.mediaModel : undefined,
          imageQuantity: (msg.plan.kind === 'image' || msg.plan.kind === 'ad-creative') ? msg.plan.quantity : undefined,
          requestedImageCount: (msg.plan.kind === 'image' || msg.plan.kind === 'ad-creative') ? msg.plan.requestedImageCount : undefined,
          imagePackageMode: msg.plan.imagePackageMode,
          turnaroundViews: msg.plan.turnaroundViews,
          referenceImage: msg.plan.referenceImage || undefined,
          referenceImagePath: msg.plan.referenceImagePath || undefined,
          videoModel: msg.plan.kind === 'project' || msg.plan.kind === 'video' ? msg.plan.mediaModel : undefined,
          videoQuantity: msg.plan.kind === 'video' ? msg.plan.quantity : undefined,
          approvedPlan: {
            flow: msg.plan.flow,
            optimizedPrompt: msg.plan.prompt,
            explanation: msg.plan.explanation,
            targetJobId: msg.plan.targetJobId ?? null,
            strategy: msg.plan.strategy,
            scriptOutline: msg.plan.scriptOutline ?? null,
            creativeSteps: msg.plan.creativeSteps,
            visualReferenceInstructions: msg.plan.visualReferenceInstructions,
            requestedImageCount: msg.plan.requestedImageCount,
            imagePackageMode: msg.plan.imagePackageMode,
            turnaroundViews: msg.plan.turnaroundViews,
            useCortexMemory: msg.plan.useCortexMemory ?? useCortexMemory,
            adCreativePlan: msg.plan.adCreativePlan
          }
        })
      });
      const data = await res.json();
      setChatMessages((previous) => previous.map((message) => {
        if (message.id !== msgId) return message;
        if (res.ok && data.success && data.jobId) {
          return {
            ...message,
            jobId: data.jobId,
            jobLogs: [...(message.jobLogs || []), `[${new Date().toLocaleTimeString()}] Job criado: ${data.jobId}`],
          };
        }
        return {
          ...message,
          jobStatus: 'failed',
          jobLogs: [...(message.jobLogs || []), `[${new Date().toLocaleTimeString()}] Falha: ${data.error || 'Não foi possível criar o job.'}`],
        };
      }));
    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setChatMessages((previous) => previous.map((message) => message.id === msgId
        ? {
            ...message,
            jobStatus: 'failed',
            jobLogs: [...(message.jobLogs || []), `[${new Date().toLocaleTimeString()}] Falha: ${errorMessage}`],
          }
        : message
      ));
    } finally {
      applyingPlanIdsRef.current.delete(msgId);
    }
  };

  const handleGenerate3dObject = async (msgId: string) => {
    const msgIndex = chatMessages.findIndex(m => m.id === msgId);
    if (msgIndex < 0) return;
    const msg = chatMessages[msgIndex];
    const imagePaths = msg.imageResult?.paths?.length ? msg.imageResult.paths : (msg.imageResult?.path ? [msg.imageResult.path] : []);
    if (!msg.jobId || imagePaths.length === 0) return;

    const nextMessages = [...chatMessages];
    nextMessages[msgIndex].jobStatus = "running";
    nextMessages[msgIndex].projectResult = null;
    nextMessages[msgIndex].jobLogs = [
      ...(nextMessages[msgIndex].jobLogs || []),
      `[${new Date().toLocaleTimeString()}] Enviando imagens aprovadas para o Hunyuan 3D...`
    ];
    failed3dReconcileUntilRef.current[msg.jobId] = Date.now() + 10 * 60 * 1000;
    shouldAutoScrollRef.current = true;
    setChatMessages(nextMessages);

    try {
      const res = await fetch("/api/flow/hunyuan3d", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: msg.jobId,
          imagePaths
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Falha ao iniciar geracao do objeto 3D.");
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setChatMessages((previous) =>
        previous.map((item) =>
          item.id === msgId
            ? {
                ...item,
                jobStatus: "failed",
                projectResult: { success: false, error: errMsg },
                jobLogs: [...(item.jobLogs || []), `[${new Date().toLocaleTimeString()}] Falha: ${errMsg}`]
              }
            : item
        )
      );
    }
  };

  const handleRegenerate3dImage = async (msgId: string, imageIndex: number) => {
    const msgIndex = chatMessages.findIndex(m => m.id === msgId);
    if (msgIndex < 0 || imageIndex <= 0) return;

    const msg = chatMessages[msgIndex];
    if (!msg.jobId || msg.plan?.imagePackageMode !== "turnaround3d") return;

    setRegenerating3dImage({ messageId: msgId, imageIndex });
    setChatMessages((previous) =>
      previous.map((item) =>
        item.id === msgId
          ? {
              ...item,
              jobLogs: [
                ...(item.jobLogs || []),
                `[${new Date().toLocaleTimeString()}] Regenerando imagem ${imageIndex + 1} do pacote 3D...`
              ]
            }
          : item
      )
    );

    try {
      const res = await fetch("/api/flow/regenerate-3d-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: msg.jobId,
          imageIndex,
          aspectRatio: msg.plan.aspectRatio,
          model: msg.plan.mediaModel
        })
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Falha ao regenerar a imagem.");
      }

      setChatMessages((previous) =>
        previous.map((item) =>
          item.id === msgId
            ? {
                ...item,
                jobStatus: "completed",
                model3dResult: null,
                imageResult: data.imageResult,
                projectResult: null,
                jobLogs: [
                  ...(item.jobLogs || []),
                  `[${new Date().toLocaleTimeString()}] Imagem ${imageIndex + 1} regenerada.`
                ]
              }
            : item
        )
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setChatMessages((previous) =>
        previous.map((item) =>
          item.id === msgId
            ? {
                ...item,
                jobLogs: [
                  ...(item.jobLogs || []),
                  `[${new Date().toLocaleTimeString()}] Falha ao regenerar imagem: ${errMsg}`
                ]
              }
            : item
        )
      );
    } finally {
      setRegenerating3dImage(null);
    }
  };

  const handleCancelPlan = (msgId: string) => {
    const nextMessages = [...chatMessages];
    const msgIndex = nextMessages.findIndex(m => m.id === msgId);
    if (msgIndex >= 0) {
      nextMessages[msgIndex].plan = null;
      setChatMessages(nextMessages);
    }
  };

  const handleStartEdit3dBaseImage = (messageId: string) => {
    const targetMessage = chatMessages.find((msg) => msg.id === messageId);
    const sourceImagePath = targetMessage ? get3dEditSourcePath(targetMessage) : null;
    if (!targetMessage?.plan || !sourceImagePath) return;

    setEditing3dImageMessageId(messageId);
    setEditing3dBaseImagePath(sourceImagePath);
    setDraftMessage("");
  };

  const handleEdit3dBaseImage = async (messageId: string, correctionPrompt: string, sourceImagePath?: string | null) => {
    const cleanPrompt = correctionPrompt.trim();
    if (!cleanPrompt) return;

    const targetMessage = chatMessages.find((msg) => msg.id === messageId);
    const referenceImagePath = sourceImagePath?.trim();
    if (!targetMessage?.plan || !referenceImagePath) return;

    const userMsg: ChatMessageState = {
      id: Date.now().toString(),
      role: "user",
      content: cleanPrompt,
      timestamp: new Date().toISOString()
    };

    setChatMessages((previous) => [...previous, userMsg]);
    setIsLoading(true);

    try {
      const editedImage = await generate3dBaseImage({
        prompt: build3dImageEditPrompt(targetMessage.plan.prompt || targetMessage.plan.originalPrompt, cleanPrompt),
        aspectRatio: targetMessage.plan.aspectRatio || imageRatio,
        model: targetMessage.plan.mediaModel || imageModel,
        referenceImagePath,
        forceReferenceUpload: true,
        useExistingFlowReference: false,
        operation: 'edit'
      });
      const editedImagePath = editedImage.path || editedImage.paths?.[0] || null;
      if (!editedImagePath) {
        throw new Error("A imagem editada foi gerada, mas nenhum caminho foi retornado.");
      }
      const updatedPlan: PendingPlan = {
        ...targetMessage.plan,
        referenceImage: null,
        referenceImagePath: editedImagePath,
        editSourceImagePath: referenceImagePath,
        imageOperation: 'turnaround3d',
        referenceSource: 'generated',
        referenceXPath: null,
      };

      setChatMessages((previous) =>
        previous.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                content: "Atualizei a imagem base com as correções e vou continuar o pacote 3D usando esta versão.",
                imageResult: editedImage,
                model3dResult: null,
                projectResult: null,
                plan: updatedPlan,
                jobStatus: "running",
                jobType: updatedPlan.kind,
                jobLogs: [`[${new Date().toLocaleTimeString()}] Imagem base editada. Iniciando geração dos ângulos 3D...`]
              }
            : msg
        )
      );
      setEditing3dImageMessageId(null);
      setEditing3dBaseImagePath(null);
      setDraftMessage("");

      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          requestId: `${messageId}:edited:${editedImagePath}`,
          prompt: updatedPlan.originalPrompt,
          imageOperation: updatedPlan.imageOperation,
          referenceSource: updatedPlan.referenceSource,
          useCortexMemory: updatedPlan.useCortexMemory ?? useCortexMemory,
          model: updatedPlan.model,
          aspectRatio: updatedPlan.aspectRatio,
          imageModel: updatedPlan.kind === 'image' || updatedPlan.kind === 'ad-creative' ? updatedPlan.mediaModel : undefined,
          imageQuantity: updatedPlan.kind === 'image' || updatedPlan.kind === 'ad-creative' ? updatedPlan.quantity : undefined,
          requestedImageCount: updatedPlan.kind === 'image' || updatedPlan.kind === 'ad-creative' ? updatedPlan.requestedImageCount : undefined,
          imagePackageMode: updatedPlan.imagePackageMode,
          turnaroundViews: updatedPlan.turnaroundViews,
          referenceImagePath: updatedPlan.referenceImagePath || undefined,
          videoModel: updatedPlan.kind === 'project' || updatedPlan.kind === 'video' ? updatedPlan.mediaModel : undefined,
          videoQuantity: updatedPlan.kind === 'video' ? updatedPlan.quantity : undefined,
          approvedPlan: {
            flow: updatedPlan.flow,
            optimizedPrompt: updatedPlan.prompt,
            explanation: updatedPlan.explanation,
            targetJobId: updatedPlan.targetJobId ?? null,
            strategy: updatedPlan.strategy,
            scriptOutline: updatedPlan.scriptOutline ?? null,
            creativeSteps: updatedPlan.creativeSteps,
            visualReferenceInstructions: updatedPlan.visualReferenceInstructions,
            requestedImageCount: updatedPlan.requestedImageCount,
            imagePackageMode: updatedPlan.imagePackageMode,
            turnaroundViews: updatedPlan.turnaroundViews,
            useCortexMemory: updatedPlan.useCortexMemory ?? useCortexMemory,
            adCreativePlan: updatedPlan.adCreativePlan
          }
        })
      });
      const data = await res.json();

      setChatMessages((previous) =>
        previous.map((msg) =>
          msg.id === messageId
            ? data.success && data.jobId
              ? {
                  ...msg,
                  jobId: data.jobId,
                  jobLogs: [
                    ...(msg.jobLogs || []),
                    `[${new Date().toLocaleTimeString()}] Job criado: ${data.jobId}`
                  ]
                }
              : {
                  ...msg,
                  jobStatus: "failed",
                  jobLogs: [
                    ...(msg.jobLogs || []),
                    `[${new Date().toLocaleTimeString()}] Falha: ${data.error || "Não foi possível iniciar o pacote 3D."}`
                  ]
                }
            : msg
        )
      );
    } catch (err) {
      console.error(err);
      setChatMessages((previous) => [
        ...previous,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Não consegui editar a imagem base: ${err instanceof Error ? err.message : String(err)}`,
          timestamp: new Date().toISOString()
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const canEditConversation = !isLoading && !chatMessages.some((msg) => msg.jobStatus === "running");

  const createConversationBranch = (branchMessages: ChatMessageState[]) => {
    const sanitizedBranchMessages = sanitizeChatMessages(branchMessages);
    const currentTitle = activeConversation?.title || getConversationTitle(sanitizedBranchMessages);
    const cleanTitle = currentTitle.startsWith(BRANCH_TITLE_PREFIX) 
      ? currentTitle.substring(BRANCH_TITLE_PREFIX.length)
      : currentTitle;
    const branchTitle = `${BRANCH_TITLE_PREFIX}${cleanTitle}`;
    const branchConversation = createChatConversation(sanitizedBranchMessages, branchTitle);
    const currentMessages = sanitizeChatMessages(chatMessages);
    const updatedAt = new Date().toISOString();

    setChatConversations((previous) => [
      branchConversation,
      ...previous.map((conversation) =>
        conversation.id === activeConversationId
          ? {
              ...conversation,
              title: getConversationTitleWithBranch(currentMessages, conversation.title),
              updatedAt,
              messages: currentMessages
            }
          : conversation
      )
    ]);
    setActiveConversationId(branchConversation.id);
    setChatMessages(branchConversation.messages);
  };

  const handleReturnToMessage = (messageId: string) => {
    if (!canEditConversation) return;

    const messageIndex = chatMessages.findIndex((msg) => msg.id === messageId);
    if (messageIndex < 0) return;

    setEditing3dImageMessageId(null);
    setEditAttachmentFile(null);
    setDraftMessage("");
    setChatMessages(chatMessages.slice(0, messageIndex + 1));
  };

  const handleEditMessage = (messageId: string) => {
    if (!canEditConversation) return;

    const messageIndex = chatMessages.findIndex((msg) => msg.id === messageId);
    const message = chatMessages[messageIndex];
    if (!message || message.role !== "user") return;

    setDraftMessage(getEditableMessageContent(message.content));
    setEditAttachmentFile(message.attachedImage ? createImageFileFromDataUrl(message.attachedImage) : null);
    setEditing3dImageMessageId(null);
    setChatMessages(chatMessages.slice(0, messageIndex));
  };

  const handleBranchFromMessage = (messageId: string) => {
    if (!canEditConversation) return;

    const messageIndex = chatMessages.findIndex((msg) => msg.id === messageId);
    if (messageIndex < 0) return;

    createConversationBranch(chatMessages.slice(0, messageIndex + 1));
  };

  const handleStopJob = async (msgId: string, jobId: string) => {
    setChatMessages((previous) =>
      previous.map((msg) =>
        msg.id === msgId
          ? {
              ...msg,
              jobStatus: "failed",
              projectResult: {
                ...(msg.projectResult || {}),
                success: false,
                error: "Cancelado pelo usuario."
              },
              jobLogs: [
                ...(msg.jobLogs || []),
                `[${new Date().toLocaleTimeString()}] Cancelamento solicitado pelo usuario.`
              ]
            }
          : msg
      )
    );

    try {
      await fetch("/api/jobs/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId })
      });
    } catch (err) {
      console.error("Falha ao cancelar job:", err);
    }
  };

  const handleEvaluateJob = async (messageId: string, jobId: string, feedback: 'good' | 'bad') => {
    setChatMessages((prev) =>
      prev.map((msg) => (msg.id === messageId ? { ...msg, feedback } : msg))
    );
    setChatConversations((prev) => {
      const updated = prev.map((conv) => {
        if (conv.id === activeConversationId) {
          return {
            ...conv,
            messages: conv.messages.map((m) =>
              m.id === messageId ? { ...m, feedback } : m
            )
          };
        }
        return conv;
      });
      return updated;
    });
    try {
      await fetch('/api/jobs/evaluate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, feedback })
      });
    } catch (err) {
      console.error("Falha ao avaliar:", err);
    }
  };

  const activeConversation = chatConversations.find((conversation) => conversation.id === activeConversationId) || null;

  const handleSelectConversation = (conversationId: string) => {
    const conversation = chatConversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    setActiveConversationId(conversation.id);
    setChatMessages(conversation.messages);
    setDraftMessage("");
  };

  const handleCreateConversation = () => {
    if (chatConversations.length > 0 && chatConversations[0].messages.length === 0) {
      setActiveConversationId(chatConversations[0].id);
      setChatMessages([]);
      setDraftMessage("");
      return;
    }

    const conversation = createChatConversation();
    setChatConversations((previous) => [conversation, ...previous]);
    setActiveConversationId(conversation.id);
    setChatMessages([]);
    setDraftMessage("");
  };

  const handleExportConversation = () => {
    if (!activeConversation) return;
    const messages = sanitizeChatMessages(chatMessages);
    const exportConversation = {
      ...activeConversation,
      title: activeConversation.title
    };
    const slug = exportConversation.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "chat";
    downloadTextFile(formatChatExport(exportConversation, messages), `kaoz1-${slug}.md`);
  };

  const handleDeleteConversation = () => {
    const activeIndex = chatConversations.findIndex((conversation) => conversation.id === activeConversationId);
    if (activeIndex < 0) return;

    const remainingConversations = chatConversations.filter((conversation) => conversation.id !== activeConversationId);
    const nextConversation = remainingConversations[activeIndex] || remainingConversations[activeIndex - 1] || createChatConversation();
    const nextConversations = remainingConversations.length > 0 ? remainingConversations : [nextConversation];

    setChatConversations(nextConversations);
    setActiveConversationId(nextConversation.id);
    setChatMessages(nextConversation.messages);
    setDraftMessage("");
    void fetch(`/api/conversations?externalConversationId=${encodeURIComponent(activeConversationId)}`, { method: 'DELETE' });
  };

  const handleDeleteSpecificConversation = (conversationId: string) => {
    const remainingConversations = chatConversations.filter((c) => c.id !== conversationId);
    
    if (conversationId === activeConversationId) {
      const activeIndex = chatConversations.findIndex((c) => c.id === conversationId);
      const nextConversation = remainingConversations[activeIndex] || remainingConversations[activeIndex - 1] || createChatConversation();
      
      setChatConversations(remainingConversations.length > 0 ? remainingConversations : [nextConversation]);
      setActiveConversationId(nextConversation.id);
      setChatMessages(nextConversation.messages);
      setDraftMessage("");
    } else {
      setChatConversations(remainingConversations.length > 0 ? remainingConversations : [createChatConversation()]);
    }
    void fetch(`/api/conversations?externalConversationId=${encodeURIComponent(conversationId)}`, { method: 'DELETE' });
  };

  const handleRenameConversation = (conversationId: string, newTitle: string) => {
    setChatConversations((prev) => 
      prev.map((c) => (c.id === conversationId ? { ...c, title: newTitle } : c))
    );
    void fetch('/api/conversations', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ externalConversationId: conversationId, title: newTitle }) });
  };

  const handleExportSpecificConversation = (conversationId: string) => {
    const conversation = chatConversations.find((c) => c.id === conversationId);
    if (!conversation) return;
    
    const messages = conversationId === activeConversationId ? chatMessages : conversation.messages;
    const sanitized = sanitizeChatMessages(messages);
    
    const exportConversation = {
      ...conversation,
      title: conversation.title
    };
    
    const slug = exportConversation.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "chat";
      
    downloadTextFile(formatChatExport(exportConversation, sanitized), `kaoz1-${slug}.md`);
  };

  const handleRightClickConversation = (e: React.MouseEvent, conversationId: string) => {
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      value: conversationId
    });
  };

  const handleRenameStart = (conversationId: string) => {
    const conversation = chatConversations.find(c => c.id === conversationId);
    if (conversation) {
      setEditingConversationId(conversationId);
      setEditingConversationText(conversation.title);
    }
    setContextMenu(null);
  };

  return (
    <div className="flow-page-shell relative isolate flex flex-col overflow-hidden bg-transparent text-white select-none" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div className="flow-cinematic-background" aria-hidden="true">
        <div className="flow-cinematic-background__art" />
        <div className="flow-cinematic-background__overlay" />
        <div className="flow-cinematic-background__grain" />
      </div>

      {/* ── Top Backdrop Overlay ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 h-20 bg-gradient-to-b from-[#080808]/90 via-[#080808]/40 to-transparent backdrop-blur-[2px]" />

      {/* ── Header ── */}
      <header
        ref={headerRef}
        onMouseEnter={() => setIsHeaderHovered(true)}
        onClick={() => {
          if (!isHeaderHovered) {
            setIsHeaderHovered(true);
          }
        }}
        style={{
          transition: "all 600ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
        className={`absolute top-4 left-1/2 -translate-x-1/2 z-50 shadow-2xl select-none rounded-full
          ${isHeaderHovered 
            ? "w-[calc(100%-2rem)] max-w-5xl h-[64px]" 
            : "w-[220px] h-[52px] cursor-pointer"
          }`}
      >
        <GlassSurface
          // @ts-ignore
          width="100%"
          // @ts-ignore
          height="100%"
          borderRadius={32}
          blur={8}
          displace={5}
          distortionScale={-20}
          brightness={15}
          opacity={0.4}
          backgroundOpacity={0.02}
          className="w-full h-full border border-white/10 hover:border-white/20 transition-all duration-600 rounded-full"
        >
          <div className={`w-full h-full flex items-center justify-between transition-all duration-600 ${isHeaderHovered ? 'px-6' : 'px-4'}`}>
            <div className="flex items-center gap-3">
          <div 
            style={{
              transition: "all 600ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            className="w-8 h-8 rounded-full flex items-center justify-center border bg-[#9D7CFF]/15 border-[#9D7CFF]/25"
          >
            <Bot size={17} className="text-[#9D7CFF]" />
          </div>
          <div 
            style={{
              transition: "all 600ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
            className="flex flex-col"
          >
            <h1 className="text-sm font-semibold tracking-wide text-white/95 whitespace-nowrap">Kaoz.1 Chatbot</h1>
            <div 
              style={{
                transition: "all 600ms cubic-bezier(0.16, 1, 0.3, 1)",
              }}
              className={`overflow-hidden ${isHeaderHovered ? "max-h-5 opacity-100 mt-0.5" : "max-h-0 opacity-0"}`}
            >
              <p className="text-[10px] text-white/50 whitespace-nowrap">Assistente Autônomo AI UGC</p>
            </div>
          </div>
        </div>

        <AnimatePresence>
          {isHeaderHovered && (
            <motion.div
              initial={{ opacity: 0, x: 20, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 15, scale: 0.95 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              {chatConversations.length > 0 && (
                <CustomDropdown
                  value={activeConversationId}
                  onChange={handleSelectConversation}
                  options={chatConversations.map(c => ({ value: c.id, label: c.title }))}
                  onRightClickItem={handleRightClickConversation}
                  editingId={editingConversationId}
                  setEditingId={setEditingConversationId}
                  editingText={editingConversationText}
                  setEditingText={setEditingConversationText}
                  onRenameOption={handleRenameConversation}
                  title="Selecionar conversa"
                  className="w-[160px] xs:w-[200px] sm:w-[240px] md:w-[280px]"
                />
              )}
              <div className="flex items-center gap-1">
                <button 
                  onClick={(e) => { e.stopPropagation(); setIsBrowserOpen(!isBrowserOpen); }} 
                  className={`p-2 rounded-xl transition-all duration-300 cursor-pointer ${isBrowserOpen ? "bg-[#9D7CFF]/15 text-[#9D7CFF]" : "hover:bg-white/10 hover:text-white text-white/40"}`} 
                  title="Visão do Agente (Manus)"
                >
                  <Square size={16} />
                </button>
                <div className="w-[1px] h-4 bg-white/10 mx-1" />
                <button 
                  onClick={(e) => { e.stopPropagation(); handleCreateConversation(); }} 
                  className="p-2 hover:bg-[#9D7CFF]/15 hover:text-[#9D7CFF] rounded-xl transition-all duration-300 text-white/60 cursor-pointer" 
                  title="Nova conversa"
                >
                  <MessageSquarePlus size={16} />
                </button>
                <div className="w-[1px] h-4 bg-white/10 mx-1.5" />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsHeaderHovered(false);
                  }}
                  className="p-2 hover:bg-white/10 hover:text-white rounded-xl transition-all duration-300 text-white/40 cursor-pointer"
                  title="Recolher menu"
                >
                  <ChevronUp size={16} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
          </div>
        </GlassSurface>
      </header>

      {/* ── Chat Area ── */}
      <div ref={chatScrollContainerRef} className="relative z-10 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-4 pt-24 pb-48 md:px-10 lg:px-32">
            {chatMessages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center opacity-70 mt-10">
                <Bot size={48} className="text-[#9D7CFF] mb-4 opacity-80" />
                <h2 className="text-xl font-light tracking-tight mb-2">Olá! Eu sou o Kaoz.1.</h2>
                <p className="text-sm text-white/60 max-w-sm leading-relaxed">
                  Posso te ajudar a criar imagens, vídeos e criativos de anúncio. O que vamos criar hoje?
                </p>
              </div>
            )}

            {chatMessages.map(msg => (
              <div key={msg.id} className={`flex flex-col ${(msg.plan && !msg.jobId) || msg.artifacts?.length ? 'w-full max-w-[760px]' : 'max-w-[85%]'} ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
                <div className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className="shrink-0 mt-1">
                    {msg.role === 'user' ? (
                      <div className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center">
                        <User size={12} className="text-white/80" />
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-[#9D7CFF]/20 border border-[#9D7CFF]/30 flex items-center justify-center">
                        <Bot size={12} className="text-[#9D7CFF]" />
                      </div>
                    )}
                  </div>
                  <div 
                    className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
                    onContextMenu={(e) => {
                      if (!canEditConversation) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setContextMenu(null);
                      setMessageContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        messageId: msg.id,
                        role: msg.role
                      });
                    }}
                  >
                    <div className={`select-text cursor-text px-4 py-3 text-[13px] leading-relaxed rounded-2xl ${msg.role === 'user' ? 'flow-user-card rounded-tr-sm text-white' : 'flow-surface-card rounded-tl-sm text-white'} prose prose-invert max-w-none prose-sm prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10`}>
                      {(!msg.attachedImage || msg.content.replace('\n\n[Imagem de referência anexada]', '').trim() !== '') && (
                        <ReactMarkdown>
                          {msg.attachedImage ? msg.content.replace('\n\n[Imagem de referência anexada]', '').trim() : msg.content}
                        </ReactMarkdown>
                      )}
                      {msg.attachedImage && (
                        <div className={`${msg.content.replace('\n\n[Imagem de referência anexada]', '').trim() !== '' ? 'mt-3' : ''} rounded-lg overflow-hidden border border-white/10 max-w-[120px]`}>
                          <img src={msg.attachedImage} alt="Referência" className="w-full h-auto object-contain rounded-lg bg-black/20" />
                        </div>
                      )}
                    </div>

                    {msg.artifacts && msg.artifacts.length > 0 && (
                      <ArtifactCards artifacts={msg.artifacts} className="mt-1 max-w-[760px]" />
                    )}
                    {msg.artifactError && (
                      <div className="mt-1 rounded-xl border border-red-400/20 bg-red-400/5 px-3 py-2 text-[11px] text-red-300">
                        A resposta foi concluída, mas o arquivo não pôde ser criado: {msg.artifactError}
                      </div>
                    )}

                    {msg.skillDraft && (
                      <div className="mt-2 w-full max-w-lg rounded-[20px] border border-[#9D7CFF]/30 bg-[#0a0a0e] p-4 shadow-lg">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div><div className="text-[10px] font-bold uppercase tracking-widest text-[#9D7CFF]">Skill pronta para revisão</div><h3 className="mt-1 text-sm font-semibold text-white">{msg.skillDraft.name}</h3></div>
                          <code className="rounded-lg bg-white/5 px-2 py-1 text-[10px] text-white/50">/{msg.skillDraft.id}</code>
                        </div>
                        <p className="mb-3 text-[11px] leading-relaxed text-white/60">{msg.skillDraft.description}</p>
                        <details className="mb-3 rounded-xl border border-white/10 bg-black/30 p-3">
                          <summary className="cursor-pointer text-[11px] font-medium text-white/70">Ver instruções geradas</summary>
                          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-white/50">{msg.skillDraft.instructions}</pre>
                        </details>
                        {msg.skillDraft.references && msg.skillDraft.references.length > 0 && (
                          <details className="mb-3 rounded-xl border border-white/10 bg-black/30 p-3">
                            <summary className="cursor-pointer text-[11px] font-medium text-white/70">Ver arquivos de referência ({msg.skillDraft.references.length})</summary>
                            <div className="mt-3 space-y-3 max-h-56 overflow-auto">
                              {msg.skillDraft.references.map((ref) => (
                                <div key={ref.name} className="border-t border-white/5 pt-2 first:border-0 first:pt-0">
                                  <div className="text-[10px] font-bold text-[#9D7CFF]">{ref.name}</div>
                                  <pre className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-white/50">{ref.content}</pre>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {msg.skillDraft.scripts && msg.skillDraft.scripts.length > 0 && (
                          <details className="mb-3 rounded-xl border border-white/10 bg-black/30 p-3">
                            <summary className="cursor-pointer text-[11px] font-medium text-white/70">Ver scripts auxiliares ({msg.skillDraft.scripts.length})</summary>
                            <div className="mt-3 space-y-3 max-h-56 overflow-auto">
                              {msg.skillDraft.scripts.map((scr) => (
                                <div key={scr.name} className="border-t border-white/5 pt-2 first:border-0 first:pt-0">
                                  <div className="text-[10px] font-bold text-emerald-400">{scr.name}</div>
                                  <pre className="mt-1 whitespace-pre-wrap text-[10px] leading-relaxed text-white/50">{scr.content}</pre>
                                </div>
                              ))}
                            </div>
                          </details>
                        )}
                        {msg.skillDraft.saveError && <p className="mb-2 text-[10px] text-red-400">{msg.skillDraft.saveError}</p>}
                        <button
                          type="button"
                          onClick={() => void handleSaveSkillDraft(msg.id)}
                          disabled={msg.skillDraft.saveStatus === 'saving' || msg.skillDraft.saveStatus === 'saved'}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#9D7CFF] px-3 py-2 text-[11px] font-semibold text-black disabled:opacity-60"
                        >
                          {msg.skillDraft.saveStatus === 'saving' && <Loader2 size={12} className="animate-spin"/>}
                          {msg.skillDraft.saveStatus === 'saved' ? 'Skill instalada' : msg.skillDraft.saveStatus === 'saving' ? 'Instalando...' : 'Revisado — instalar skill'}
                        </button>
                      </div>
                    )}



                    {/* Plan Card */}
                    {msg.plan && !msg.jobId && msg.jobStatus !== 'running' && (
                      <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-[#0a0a0e] border border-[#9D7CFF]/30 shadow-lg">
                          <div className="text-[10px] font-bold uppercase tracking-widest text-[#9D7CFF] mb-2">
                            {msg.plan.kind === 'ad-creative' ? 'Plano de Criativos de Anúncio' : 'Plano do Agente'}
                          </div>
                          <div className="text-[12px] text-white/80 mb-3">{msg.plan.explanation}</div>
                          {msg.plan.requestedImageCount && (
                            <div className="text-[11px] text-white/60 mb-3">
                              Modo escala: {msg.plan.requestedImageCount} imagens em rodadas sequenciais.
                            </div>
                          )}

                          {msg.plan.imagePackageMode === 'turnaround3d' && msg.imageResult?.success && get3dEditSourcePath(msg) && (
                            <div className="mb-3 overflow-hidden rounded-xl border border-white/10 bg-black">
                              <img
                                src={getFlowMediaUrl(msg.imageResult.path || msg.imageResult.paths?.[0])}
                                alt="Imagem base 3D"
                                className="h-auto w-full object-cover"
                              />
                              <button
                                type="button"
                                onClick={() => handleStartEdit3dBaseImage(msg.id)}
                                className="flex w-full items-center justify-center gap-1.5 border-t border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] font-semibold text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
                              >
                                <Pencil size={12} />
                                Editar imagem
                              </button>
                            </div>
                          )}
                          
                          {msg.plan.kind === 'ad-creative' && msg.plan.adCreativePlan?.concepts && (
                            <div className="flex flex-col gap-2 mb-3 max-h-48 overflow-y-auto pr-1">
                              {msg.plan.adCreativePlan.concepts.map((concept, idx) => (
                                <div key={idx} className="bg-white/5 rounded-xl p-3 border border-white/5 text-[11px]">
                                  <div className="font-semibold text-[#9D7CFF] mb-1">{concept.conceptName}</div>
                                  <div className="text-white/80 mb-1.5"><strong className="text-white/60">Copy:</strong> &quot;{concept.copyText}&quot;</div>
                                  <div className="text-white/50 leading-relaxed"><strong className="text-white/60">Prompt Visual:</strong> {concept.visualPrompt}</div>
                                </div>
                              ))}
                            </div>
                          )}

                          {msg.plan.kind !== 'ad-creative' && (
                            <div className="bg-white/5 rounded-xl p-3 text-[11px] text-white/60 mb-3 border border-white/5">
                              <strong className="text-white/80 block mb-1">Prompt:</strong>
                              {msg.plan.prompt}
                            </div>
                          )}

                          {/* Plan actions */}
                          <div className="flex items-center gap-2 mt-2 pt-2 border-t border-white/5">
                            <button onClick={() => handleCancelPlan(msg.id)} className="flex-1 py-1.5 text-center text-[11px] text-white/40 hover:text-white/80 hover:bg-white/5 border border-white/10 rounded-xl transition-all cursor-pointer">
                              Recusar
                            </button>
                            {msg.plan.requires3dBasePreparation ? (
                              <button
                                onClick={() => void handlePrepare3dBase(msg.id)}
                                disabled={preparing3dBaseMessageId === msg.id}
                                className="flex-1 py-1.5 text-center text-[11px] font-semibold text-black bg-[#9D7CFF] hover:bg-[#b096ff] disabled:opacity-60 rounded-xl transition-all cursor-pointer"
                              >
                                {preparing3dBaseMessageId === msg.id ? 'Gerando base...' : 'Gerar base para revisao'}
                              </button>
                            ) : (
                              <button onClick={() => void handleApplyPlan(msg.id)} className="flex-1 py-1.5 text-center text-[11px] font-semibold text-black bg-[#9D7CFF] hover:bg-[#b096ff] rounded-xl transition-all cursor-pointer">
                                Aplicar
                              </button>
                            )}
                          </div>
                      </div>
                    )}

                    {/* Job executing progress */}
                    {msg.jobId && msg.jobStatus === 'running' && (
                      <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-[#0a0a0e]/90 border border-white/5 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-[#9D7CFF] flex items-center gap-1.5 font-semibold">
                            <Loader2 size={12} className="animate-spin" /> Processando tarefa...
                          </span>
                        </div>
                        {msg.plan?.imagePackageMode === 'turnaround3d' && msg.imageResult?.success && get3dEditSourcePath(msg) && (
                          <div className="overflow-hidden rounded-xl border border-white/10 bg-black">
                            <img
                              src={getFlowMediaUrl(msg.imageResult.path || msg.imageResult.paths?.[0])}
                              alt="Imagem base 3D editada"
                              className="h-auto w-full object-cover"
                            />
                          </div>
                        )}
                        {/* Terminal box for logs */}
                        <div className="h-28 overflow-y-auto rounded-xl bg-black p-3 font-mono text-[9px] text-[#4ADE80] border border-white/5 leading-normal flex flex-col gap-0.5 select-text">
                          {msg.jobLogs?.map((log, logIdx) => (
                            <div key={logIdx} className="flex gap-1.5">
                              <span className="text-white/20 select-none">{logIdx + 1}</span>
                              <span className="break-all">{log}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Job completed result (Image package) */}
                    {msg.jobId && (msg.jobStatus === 'completed' || msg.jobStatus === 'failed') && msg.imageResult && (
                       <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-[#0a0a0e]/90 border border-green-500/20 flex flex-col gap-3">
                         <div className="flex items-center gap-1.5 text-[11px] text-green-400 font-semibold">
                           <CheckCircle size={13} /> Geração de mídia concluída!
                         </div>
                         {msg.imageResult.paths && msg.imageResult.paths.length > 0 ? (
                           <div className="grid grid-cols-2 gap-2">
                             {msg.imageResult.paths.map((p, idx) => {
                               const isRegenerating = regenerating3dImage?.messageId === msg.id && regenerating3dImage.imageIndex === idx;
                               const canRegenerate = msg.plan?.imagePackageMode === 'turnaround3d' && idx > 0 && !msg.model3dResult?.path;
                               const imageLabel = TURNAROUND_IMAGE_LABELS[idx] || `Imagem ${idx + 1}`;

                               return (
                                 <div key={idx} className="relative group rounded-xl overflow-hidden border border-white/10 bg-black aspect-square cursor-pointer" onClick={() => setExpandedResultImage({ src: getFlowMediaUrl(p), alt: `Midia gerada ${idx + 1}`, downloadUrl: getFlowDownloadUrl(p) })}>
                                   <img src={getFlowMediaUrl(p)} alt={`Midia gerada ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                   <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                     <span className="text-[10px] text-white font-medium bg-black/60 px-2 py-1 rounded-md">Expandir</span>
                                   </div>
                                   {canRegenerate && (
                                     <button
                                       type="button"
                                       disabled={Boolean(regenerating3dImage)}
                                       onClick={(event) => {
                                         event.stopPropagation();
                                         void handleRegenerate3dImage(msg.id, idx);
                                       }}
                                       className="absolute right-1.5 top-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-black/70 text-white/80 transition-colors hover:border-[#9D7CFF]/50 hover:bg-[#9D7CFF]/25 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                                       title={`Gerar novamente: ${imageLabel}`}
                                     >
                                       {isRegenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                                     </button>
                                   )}
                                 </div>
                               );
                             })}
                           </div>
                         ) : (
                           msg.imageResult.path && (
                             <div className="relative group rounded-xl overflow-hidden border border-white/10 bg-black aspect-video cursor-pointer" onClick={() => setExpandedResultImage({ src: getFlowMediaUrl(msg.imageResult!.path), alt: "Midia gerada", downloadUrl: getFlowDownloadUrl(msg.imageResult!.path) })}>
                               <img src={getFlowMediaUrl(msg.imageResult.path)} alt="Midia gerada" className="w-full h-full object-cover" />
                             </div>
                           )
                         )}
                         {msg.imageResult.path && (
                            <a href={getFlowDownloadUrl(msg.imageResult.path)} download className="flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2 text-[11px] font-semibold text-green-400 hover:bg-green-500/20 transition-all cursor-pointer">
                              <Download size={12} /> Baixar Pacote Completo
                            </a>
                         )}
                         {msg.plan?.imagePackageMode === 'turnaround3d' && !msg.model3dResult?.path && (
                            <button
                              type="button"
                              onClick={() => handleGenerate3dObject(msg.id)}
                              className="flex items-center justify-center gap-1.5 rounded-xl bg-[#9D7CFF]/10 border border-[#9D7CFF]/25 px-3 py-2 text-[11px] font-semibold text-[#c7b7ff] hover:bg-[#9D7CFF]/20 transition-all cursor-pointer"
                            >
                              <Cpu size={12} /> {msg.jobStatus === 'failed' ? 'Recomeçar Geração 3D' : 'Gerar Objeto 3D'}
                            </button>
                         )}
                         {msg.model3dResult?.path && (
                            <div className="mt-2 w-full max-w-[280px]">
                              <ModelViewer3D
                                src={getFlowMediaUrl(msg.model3dResult.path)}
                                title={msg.model3dResult.filename || "Caricatura 3D"}
                              />
                            </div>
                         )}
                       </div>
                    )}

                    {/* Job completed result (Video) */}
                    {msg.jobId && msg.jobStatus === 'completed' && msg.videoResult && (
                       <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-[#0a0a0e]/90 border border-green-500/20 flex flex-col gap-3">
                         <div className="flex items-center gap-1.5 text-[11px] text-green-400 font-semibold">
                           <CheckCircle size={13} /> Vídeo gerado com sucesso!
                         </div>
                         <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black aspect-video">
                           <video src={msg.videoResult.path} controls className="w-full h-full object-cover" />
                         </div>
                         <a href={msg.videoResult.path} download className="flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2 text-[11px] font-semibold text-green-400 hover:bg-green-500/20 transition-all cursor-pointer">
                           <Download size={12} /> Baixar Vídeo
                         </a>
                       </div>
                    )}

                    {/* Job completed result (Project react video) */}
                    {msg.jobId && msg.jobStatus === 'completed' && msg.projectResult && msg.projectResult.success && (
                       <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-[#0a0a0e]/90 border border-green-500/20 flex flex-col gap-3">
                         <div className="flex items-center gap-1.5 text-[11px] text-green-400 font-semibold">
                           <CheckCircle size={13} /> Projeto de react finalizado!
                         </div>
                         {msg.projectResult.videoPath && (
                           <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black aspect-video">
                             <video src={msg.projectResult.videoPath} controls className="w-full h-full object-cover" />
                           </div>
                         )}
                         <div className="flex gap-2">
                           <a href={msg.projectResult.videoPath || "#"} download className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2 text-[11px] font-semibold text-green-400 hover:bg-green-500/20 transition-all cursor-pointer">
                             <Download size={12} /> Baixar Vídeo React
                           </a>
                         </div>
                       </div>
                    )}

                    {/* Job failed error */}
                    {(msg.jobStatus === 'failed' || (msg.projectResult && !msg.projectResult.success)) && (
                       <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-red-500/5 border border-red-500/20 flex flex-col gap-2">
                         <div className="flex items-center gap-1.5 text-[11px] text-red-400 font-semibold">
                           <AlertCircle size={13} /> Falha no processamento.
                         </div>
                         <p className="text-[11px] text-white/50 leading-relaxed select-text">
                           {msg.projectResult?.error || msg.jobLogs?.at(-1)?.replace(/^\[[^\]]+\]\s*/, "") || "Ocorreu um erro no pipeline do Kaoz.1."}
                         </p>
                         {msg.jobLogs && msg.jobLogs.length > 0 && (
                           <div className="mt-2 max-h-28 overflow-y-auto rounded-xl bg-black/60 p-3 font-mono text-[9px] text-red-400/90 border border-red-500/10 leading-normal flex flex-col gap-0.5 select-text">
                             {msg.jobLogs.slice(-5).map((log, logIdx) => (
                               <div key={logIdx} className="break-all">{log}</div>
                             ))}
                           </div>
                         )}
                       </div>
                    )}

                    {/* Job feedback actions */}
                    {msg.jobId && msg.jobStatus === 'completed' && (
                      <div className="flex items-center justify-between w-full px-1 mt-1 text-[10px] text-white/40">
                        <span>A qualidade ficou boa?</span>
                        <div className="flex items-center gap-2">
                          <button 
                            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                              msg.feedback === 'good' 
                                ? 'bg-green-500/20 text-green-400 scale-110' 
                                : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                            }`}
                            onClick={() => handleEvaluateJob(msg.id, msg.jobId!, 'good')}
                          >
                            <ThumbsUp size={13} fill={msg.feedback === 'good' ? 'currentColor' : 'none'} />
                          </button>
                          <button 
                            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                              msg.feedback === 'bad' 
                                ? 'bg-rose-500/20 text-rose-400 scale-110' 
                                : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                            }`}
                            onClick={() => handleEvaluateJob(msg.id, msg.jobId!, 'bad')}
                          >
                            <ThumbsDown size={13} fill={msg.feedback === 'bad' ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {isLoading && chatMessages[chatMessages.length - 1]?.role !== 'assistant' && (
              <div className="flex gap-3 self-start">
                <div className="w-7 h-7 rounded-full bg-[#9D7CFF]/20 border border-[#9D7CFF]/30 flex items-center justify-center shrink-0">
                   <Bot size={12} className="text-[#9D7CFF]" />
                </div>
                <div className="px-4 py-3 text-[13px] rounded-2xl bg-white/5 border border-white/10 rounded-tl-sm text-white/60 flex items-center gap-2">
                   <Loader2 size={14} className="animate-spin text-[#9D7CFF]/70" />
                   Kaoz.1 está pensando...
                </div>
              </div>
            )}

      </div>

      <AnimatePresence>
        {showSettings && (
          <motion.button
            type="button"
            className="absolute inset-0 z-30 cursor-default bg-black/25 backdrop-blur-[2px]"
            aria-label="Fechar menu de opções"
            onMouseDown={() => setShowSettings(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {expandedResultImage && (
          <motion.div
            className="absolute inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-md md:p-8"
            onMouseDown={() => setExpandedResultImage(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
          >
            <motion.div
              className="relative flex max-h-full w-full max-w-6xl items-center justify-center"
              onMouseDown={(event) => event.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <img
                src={expandedResultImage.src}
                alt={expandedResultImage.alt}
                className="max-h-[82vh] max-w-full rounded-2xl border border-white/10 bg-black/50 object-contain shadow-2xl shadow-black/60"
              />
              <div className="absolute right-3 top-3 flex items-center gap-2">
                <a
                  href={expandedResultImage.downloadUrl}
                  download
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/75 transition-colors hover:bg-black/75 hover:text-white"
                  title="Baixar imagem"
                >
                  <Download size={16} />
                </a>
                <button
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-black/55 text-white/75 transition-colors hover:bg-black/75 hover:text-white"
                  onClick={() => setExpandedResultImage(null)}
                  title="Fechar visualização"
                  aria-label="Fechar visualização"
                >
                  <X size={17} />
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isBrowserOpen && (
          <motion.div
            drag
            dragMomentum={false}
            initial={{ opacity: 0, scale: 0.9, x: 20 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.9, x: 20 }}
            className="absolute top-24 right-4 z-50 w-[420px] rounded-2xl border border-white/10 bg-[#0d0d12]/95 p-3 shadow-2xl shadow-black/60 backdrop-blur-xl flex flex-col gap-2 cursor-grab active:cursor-grabbing"
          >
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-2 text-xs font-medium text-white/70">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Navegador do Agente
              </div>
              <div className="flex items-center gap-3">
                <button 
                  onPointerDown={(e) => e.stopPropagation()} 
                  className="text-white/40 hover:text-white transition-colors cursor-pointer" 
                  title="Atualizar navegador"
                >
                  <RefreshCw size={13} />
                </button>
                <button 
                  onPointerDown={(e) => e.stopPropagation()} 
                  onClick={() => setIsBrowserOpen(false)} 
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                  title="Fechar"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div 
              className="relative aspect-video w-full overflow-hidden rounded-xl bg-black border border-white/5 cursor-default"
              onPointerDown={(e) => e.stopPropagation()}
            >
              {!browserImage && hasCheckedBrowserState && (
                <div className="absolute inset-0 z-10 flex h-full w-full items-center justify-center bg-black px-4 text-center text-xs text-white/35">
                  Nenhuma sessao visual do Flow ativa. Ferramentas MCP rodam em segundo plano.
                </div>
              )}
              {browserImage ? (
                <img src={browserImage} alt="Browser state" className="w-full h-full object-cover" draggable={false} />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-white/30 text-center px-4">
                  Aguardando inicialização do navegador...
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input Bar or Floating Settings Gear ── */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-[#080808] via-[#080808]/90 to-transparent pt-10 pb-6 px-4 md:px-10 lg:px-32 flex justify-center">
          <div className="pointer-events-auto w-full max-w-[900px] relative" ref={popoverRef} onWheel={handleInputOverlayWheel}>
            {selectedElementReference && (
              <div className="mb-2 flex items-center justify-between rounded-xl border border-[#9D7CFF]/30 bg-[#9D7CFF]/10 px-3 py-2 text-[11px] text-white/75">
                <span className="truncate">Referencia selecionada: {selectedElementReference.label || selectedElementReference.xpath}</span>
                <button type="button" onClick={() => setSelectedElementReference(null)} className="ml-3 text-white/50 hover:text-white" aria-label="Remover referencia selecionada">
                  <X size={13} />
                </button>
              </div>
            )}
            
            <AnimatePresence>
              {showSlashMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.98 }}
                  className="absolute bottom-[calc(100%+8px)] left-0 w-80 rounded-xl border border-white/10 bg-[#1a1a1a]/95 backdrop-blur-xl p-2 shadow-2xl z-50 overflow-hidden ring-1 ring-[#9D7CFF]/20"
                >
                  <p className="px-2 mb-2 mt-1 text-[10px] font-bold text-[#9D7CFF] uppercase tracking-wider">Skills de Automação</p>
                  
                  {skillsLoading ? (
                    <div className="px-3 py-4 text-xs text-white/50 text-center flex items-center justify-center gap-2">
                      <Loader2 className="animate-spin" size={14} /> Carregando...
                    </div>
                  ) : skillsError ? (
                    <div className="px-3 py-3 text-xs text-red-400 text-center">
                      {skillsError}
                    </div>
                  ) : filteredSkills.length === 0 ? (
                    <div className="px-3 py-3 text-xs text-white/50 text-center">
                      Nenhuma skill encontrada.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-1 max-h-[220px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10 pr-1">
                      {filteredSkills.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setDraftMessage(`/${s.id} `);
                            setShowSlashMenu(false);
                          }}
                          className="flex flex-col items-start rounded-lg px-3 py-2 hover:bg-white/10 text-left transition-colors"
                        >
                          <span className="text-sm font-medium text-white">{s.name}</span>
                          <span className="text-xs text-white/40 truncate w-full mt-0.5">{s.description || s.id}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
            <PromptInputBox
              onStop={() => {
                stop();
                const runningJob = chatMessages.find(m => m.jobId && m.jobStatus === 'running');
                if (runningJob) {
                  void handleStopJob(runningJob.id, runningJob.jobId!);
                }
              }}
              isLoading={isLoading}
              value={draftMessage}
              onValueChange={setDraftMessage}
              initialFile={editAttachmentFile}
              placeholder={editing3dImageMessageId ? "Descreva as correções para editar a imagem base..." : agentType === "image" && image3dMode && image3dReadyMode ? "Anexe a imagem pronta para gerar apenas os ângulos..." : agentType === "image" && image3dMode ? "Anexe uma imagem e envie para gerar o 3D..." : "Mande uma mensagem ou descreva o que quer criar..."}
              onSend={(message, files) => {
                setEditAttachmentFile(null);
                void handleSendMessage(message, (files ?? []).map(f => ({ file: f })), []);
              }}
              onOptionsClick={() => setShowSettings(!showSettings)}
              showOptions={showSettings}
              useCortexMemory={useCortexMemory}
              onCortexMemoryChange={setUseCortexMemory}
              voiceEnabled={voiceEnabled}
              voiceSpeaking={voiceSpeaking}
              voiceAwaitingCommand={voiceAwaitingCommand}
              voiceStatus={voiceStatus}
              voiceError={voiceError}
              voiceTranscript={voiceTranscript}
              onVoiceToggle={toggleVoiceMode}
            />
            <AnimatePresence>
              {showSettings && renderSettingsMenu(false)}
            </AnimatePresence>
          </div>
      </div>

      {contextMenu && (
        <div
          data-context-menu="true"
          className="fixed z-[100] min-w-[140px] bg-[#121214]/98 border border-white/10 rounded-xl shadow-2xl py-1.5 backdrop-blur-xl text-xs select-none"
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            boxShadow: "0 10px 30px -10px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.05) inset",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleRenameStart(contextMenu.value)}
            className="w-full text-left px-3 py-2 hover:bg-white/[0.04] text-white/90 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Pencil size={12} className="text-white/50" />
            Nomear
          </button>
          <button
            onClick={() => {
              handleExportSpecificConversation(contextMenu.value);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-white/[0.04] text-white/90 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Download size={12} className="text-white/50" />
            Exportar
          </button>
          <div className="h-[1px] bg-white/10 my-1" />
          <button
            onClick={() => {
              handleDeleteSpecificConversation(contextMenu.value);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-red-500/10 hover:text-red-400 text-white/90 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Trash2 size={12} className="text-red-500" />
            Excluir
          </button>
        </div>
      )}

      {messageContextMenu && (
        <div
          data-context-menu="true"
          className="fixed z-[100] min-w-[140px] bg-[#121214]/98 border border-white/10 rounded-xl shadow-2xl py-1.5 backdrop-blur-xl text-xs select-none"
          style={{
            position: "fixed",
            top: messageContextMenu.y,
            left: messageContextMenu.x,
            boxShadow: "0 10px 30px -10px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.05) inset",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              handleReturnToMessage(messageContextMenu.messageId);
              setMessageContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-white/[0.04] text-white/90 flex items-center gap-2 cursor-pointer transition-colors"
          >
            <Undo2 size={12} className="text-white/50" />
            Voltar
          </button>
          
          {messageContextMenu.role === "user" && (
            <button
              onClick={() => {
                handleEditMessage(messageContextMenu.messageId);
                setMessageContextMenu(null);
              }}
              className="w-full text-left px-3 py-2 hover:bg-white/[0.04] text-white/90 flex items-center gap-2 cursor-pointer transition-colors"
            >
              <Pencil size={12} className="text-white/50" />
              Editar
            </button>
          )}

          <button
            onClick={() => {
              handleBranchFromMessage(messageContextMenu.messageId);
              setMessageContextMenu(null);
            }}
            className="w-full text-left px-3 py-2 hover:bg-white/[0.04] text-[#c7b7ff] flex items-center gap-2 cursor-pointer transition-colors"
          >
            <MessageSquarePlus size={12} className="text-[#9D7CFF]/70" />
            Ramificar
          </button>
        </div>
      )}
    </div>
  );
}
