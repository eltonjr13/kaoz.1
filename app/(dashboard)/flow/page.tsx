"use client";

import { useEffect, useState, useRef } from "react";
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
  X,
  Settings
} from "lucide-react";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { FlyModeWizard } from "@/components/jobs/fly-mode-wizard";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion } from "framer-motion";

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

interface Avatar {
  id: string;
  name: string;
  image_path: string;
}

type AgentType = 'image' | 'video' | 'project' | 'ad-creative';
type PlannedFlow = AgentType | 'refine';
type ImagePackageMode = 'turnaround3d';
type TurnaroundView = 'front' | 'left' | 'right' | 'back' | 'top' | 'bottom';

interface PendingPlan {
  kind: AgentType;
  flow: PlannedFlow;
  originalPrompt: string;
  prompt: string;
  explanation: string;
  model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini';
  aspectRatio: string;
  quantity?: string;
  mediaModel?: string;
  avatarId?: string;
  avatarName?: string;
  referenceImage?: string | null;
  referenceImagePath?: string | null;
  targetJobId?: string | null;
  strategy?: string;
  scriptOutline?: string | null;
  creativeSteps?: string[];
  visualReferenceInstructions?: string;
  requestedImageCount?: number;
  imagePackageMode?: ImagePackageMode;
  turnaroundViews?: TurnaroundView[];
  useAvatarPersonality?: boolean;
  useCortexMemory?: boolean;
  adCreativePlan?: {
    concepts: {
      conceptName: string;
      copyText: string;
      visualPrompt: string;
    }[];
  } | null;
}

export interface ChatMessageState {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  plan?: PendingPlan | null;
  jobId?: string | null;
  jobType?: AgentType | null;
  jobStatus?: 'running' | 'completed' | 'failed' | null;
  jobLogs?: string[];
  imageResult?: GenerationResult | null;
  videoResult?: GenerationResult | null;
  projectResult?: { success: boolean; jobId?: string; videoPath?: string; error?: string } | null;
  showLogs?: boolean;
  feedback?: 'good' | 'bad' | null;
}

interface ChatConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessageState[];
}

const CHAT_HISTORY_KEY = "mrchicken:flow:chat_history";
const CHAT_CONVERSATIONS_KEY = "mrchicken:flow:chat_conversations";
const ACTIVE_CHAT_KEY = "mrchicken:flow:active_chat";
const USE_AVATAR_PERSONALITY_KEY = "mrchicken:flow:use_avatar_personality";
const USE_CORTEX_MEMORY_KEY = "mrchicken:flow:use_cortex_memory";
const BRANCH_TITLE_PREFIX = "Ramificação - ";
const MAX_SCALE_IMAGE_COUNT = 40;

const createChatId = (prefix: string) => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const sanitizeChatMessages = (messages: ChatMessageState[]) =>
  messages.map((msg) => {
    if (!msg.plan?.referenceImage) return msg;
    return {
      ...msg,
      plan: {
        ...msg.plan,
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

async function generate3dBaseImage(params: {
  prompt: string;
  aspectRatio: string;
  model: string;
  referenceImage?: string;
  referenceImagePath?: string;
  forceReferenceUpload?: boolean;
  useExistingFlowReference?: boolean;
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
      useExistingFlowReference: params.useExistingFlowReference
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
    "Do not generate a new character, new scene, new composition, or unrelated image.",
    "Preserve the same subject identity, pose, camera angle, crop, composition, style, lighting, colors, materials, background, and image proportions.",
    "Apply only the requested correction below. Keep every other visual detail unchanged.",
    "Keep or convert the result to a strict neutral model-sheet setup: one full-body character, centered, plain light gray background, no environment, no props, no text, no logos.",
    `Original 3D base brief: ${originalPrompt}`,
    `Requested correction: ${correctionPrompt}`,
    "Return one edited image only, not a variation sheet, not a collage, not a redesign."
  ].join(" ");

const getConversationTitle = (messages: ChatMessageState[]) => {
  const firstUserMessage = messages.find((msg) => msg.role === "user")?.content.trim();
  if (!firstUserMessage) return "Nova conversa";
  const firstLine = firstUserMessage.split(/\r?\n/)[0].trim();
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
};

const getConversationTitleWithBranch = (messages: ChatMessageState[], currentTitle: string) => {
  const title = getConversationTitle(messages);
  void currentTitle;
  return title;
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
    const author = msg.role === "user" ? "Usuario" : "MrChicken";
    lines.push(`## ${author} - ${formatExportDate(msg.timestamp)}`, "", msg.content, "");
    if (msg.plan) {
      lines.push("### Plano", "", `Tipo: ${msg.plan.kind}`, `Modelo: ${msg.plan.model}`, `Prompt: ${msg.plan.prompt}`, "");
    }
    if (msg.jobId) {
      lines.push("### Job", "", `ID: ${msg.jobId}`, `Status: ${msg.jobStatus || "pendente"}`, "");
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

const getEditableMessageContent = (content: string) =>
  content.replace(/\n\n\[Imagem de refer(?:ência|Ãªncia) anexada\]$/i, "");

export default function FlowDashboardPage() {
  const [chatMessages, setChatMessages] = useState<ChatMessageState[]>([]);
  const [chatConversations, setChatConversations] = useState<ChatConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("");
  const [agentModel, setAgentModel] = useState<'deepseek' | 'claude' | 'chatgpt' | 'gemini'>('gemini');
  const [agentType, setAgentType] = useState<AgentType>('image');
  const [flyModeActive, setFlyModeActive] = useState(false);
  
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [useAvatarPersonality, setUseAvatarPersonality] = useState(() =>
    typeof window === "undefined" ? true : localStorage.getItem(USE_AVATAR_PERSONALITY_KEY) !== "false"
  );
  const [useCortexMemory, setUseCortexMemory] = useState(() =>
    typeof window === "undefined" ? true : localStorage.getItem(USE_CORTEX_MEMORY_KEY) !== "false"
  );
  const [imageRatio, setImageRatio] = useState("16:9");
  const [imageQty, setImageQty] = useState("x2");
  const [imageModel, setImageModel] = useState("Nano Banana 2");
  const [image3dMode, setImage3dMode] = useState(false);
  
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [videoQty, setVideoQty] = useState("1x");
  const [videoModel, setVideoModel] = useState("Veo 3.1");

  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [expandedResultImage, setExpandedResultImage] = useState<{ src: string; alt: string; downloadUrl: string } | null>(null);
  const [draftMessage, setDraftMessage] = useState("");
  const [editing3dImageMessageId, setEditing3dImageMessageId] = useState<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);

  const renderSettingsMenu = (isFloatingRight = false) => {
    return (
      <motion.div
        ref={settingsMenuRef}
        className={`absolute bottom-full z-50 mb-3 flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-5 rounded-2xl border border-white/10 bg-[#0d0d12]/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl pointer-events-auto ${isFloatingRight ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left'}`}
        initial={{ opacity: 0, y: 10, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="flex flex-col gap-2">
          <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">Tipo preferido</div>
          <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/10 bg-white/[0.04] p-1 sm:grid-cols-4">
            {[
              { id: "image", label: "Imagem", icon: <ImageIcon size={13} /> },
              { id: "video", label: "Vídeo", icon: <Film size={13} /> },
              { id: "project", label: "React", icon: <Cpu size={13} /> },
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
          </div>
        )}

        {/* Operation Mode for ad-creative */}
        {agentType === "ad-creative" && (
          <div className="flex flex-col gap-2">
            <div className="px-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white/35">
              Modo de Operação
            </div>
            <div className="grid grid-cols-2 rounded-2xl border border-white/10 bg-white/[0.04] p-1">
              {[
                { id: "normal", label: "Normal" },
                { id: "fly", label: "Modo Fly ✈️" },
              ].map((mode) => {
                const isActive = flyModeActive ? mode.id === "fly" : mode.id === "normal";
                return (
                  <button
                    key={mode.id}
                    type="button"
                    onClick={() => {
                      setFlyModeActive(mode.id === "fly");
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
          </div>
        )}

        <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-3 transition-colors hover:bg-white/[0.07]">
          <span className="flex flex-col gap-0.5">
            <span className="text-[12px] font-semibold text-white/85">Personalidade do avatar</span>
            <span className="text-[10px] leading-snug text-white/45">Usar o tom do avatar nas respostas e roteiros</span>
          </span>
          <input
            type="checkbox"
            checked={useAvatarPersonality}
            onChange={(e) => setUseAvatarPersonality(e.target.checked)}
            className="peer sr-only"
          />
          <span className="relative h-6 w-10 shrink-0 rounded-full border border-white/10 bg-white/10 transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white/70 after:transition-transform peer-checked:bg-[#9D7CFF]/80 peer-checked:after:translate-x-4 peer-checked:after:bg-white" />
        </label>

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
    fetch("/api/avatars").then(res => res.json()).then(data => {
      const list = data.avatars || data;
      setAvatars(list);
      if (list.length > 0) setSelectedAvatarId(list[0].id);
    });

    const savedConversations = readJsonArray<ChatConversation>(localStorage.getItem(CHAT_CONVERSATIONS_KEY));
    const legacyMessages = readJsonArray<ChatMessageState>(localStorage.getItem(CHAT_HISTORY_KEY));
    const initialConversations = savedConversations.length > 0
      ? savedConversations
      : [createChatConversation(legacyMessages)];
    const savedActiveId = localStorage.getItem(ACTIVE_CHAT_KEY);
    const activeConversation = initialConversations.find((conversation) => conversation.id === savedActiveId) || initialConversations[0];

    queueMicrotask(() => {
      setChatConversations(initialConversations);
      setActiveConversationId(activeConversation.id);
      setChatMessages(activeConversation.messages);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem(USE_AVATAR_PERSONALITY_KEY, String(useAvatarPersonality));
  }, [useAvatarPersonality]);

  useEffect(() => {
    localStorage.setItem(USE_CORTEX_MEMORY_KEY, String(useCortexMemory));
  }, [useCortexMemory]);

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
      localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(sanitizedMessages));
    } catch (e) {
      console.warn("Falha ao salvar o histórico de chat no LocalStorage:", e);
    }
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, activeConversationId]);

  useEffect(() => {
    if (chatConversations.length === 0) return;
    localStorage.setItem(CHAT_CONVERSATIONS_KEY, JSON.stringify(chatConversations));
  }, [chatConversations]);

  useEffect(() => {
    if (!activeConversationId) return;
    localStorage.setItem(ACTIVE_CHAT_KEY, activeConversationId);
  }, [activeConversationId]);

  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const originalBg = mainEl.style.backgroundColor;
      mainEl.style.backgroundColor = '#080808';
      return () => { mainEl.style.backgroundColor = originalBg; };
    }
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
    const activeJobs = chatMessages.filter(m => m.jobId && m.jobStatus === 'running');
    if (activeJobs.length === 0) return;

    let isMounted = true;
    const poll = async () => {
      if (!isMounted) return;
      let updated = false;
      const nextMessages = [...chatMessages];

      for (const msg of activeJobs) {
        try {
          const res = await fetch(`/api/jobs/events?jobId=${msg.jobId}`);
          if (!res.ok) continue;
          const data = await res.json();
          const events = data.events || [];

          const msgIndex = nextMessages.findIndex(m => m.id === msg.id);
          if (msgIndex < 0) continue;

          const currentLogs = nextMessages[msgIndex].jobLogs || [];
          const newEvents = events.filter((e: any) => !currentLogs.some(log => log.includes(e.id)));
          
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
                  if (msg.jobType === "image" || msg.jobType === "ad-creative") {
                     const imagePaths = extractImagePathsFromJob(job.source_video_transcription);
                     nextMessages[msgIndex].imageResult = {
                       success: true,
                       path: finalPath,
                       filename: getResultFilename(finalPath),
                       paths: imagePaths.length > 0 ? imagePaths : (finalPath ? [finalPath] : []),
                       createdAt: job.updated_at
                     };
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
        setChatMessages(nextMessages);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [chatMessages]);

  const handleSendMessage = async (message: string, files: any[], pastedContent: any[]) => {
    if (editing3dImageMessageId) {
      await handleEdit3dBaseImage(editing3dImageMessageId, message);
      return;
    }

    let content = message;
    if (pastedContent.length > 0) {
      content += "\n\n" + pastedContent.map((p: any) => p.content).join("\n\n");
    }
    
    let referenceImageBase64: string | null = null;
    if (files.length > 0) {
      const file = files[0].file;
      referenceImageBase64 = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(typeof e.target?.result === "string" ? e.target.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (referenceImageBase64) {
        content += `\n\n[Imagem de referência anexada]`;
      }
    }

    const userMsg: ChatMessageState = {
      id: Date.now().toString(),
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };

    setChatMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    const geminiMessages = chatMessages.concat(userMsg)
      .filter(m => !m.plan && !m.jobId) 
      .map(m => ({
        role: m.role === 'user' ? 'user' : 'model',
        parts: [{ text: m.content }]
      }));

    try {
      const res = await fetch("/api/flow/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: geminiMessages,
          avatarId: selectedAvatarId,
          useAvatarPersonality,
          useCortexMemory,
          model: agentModel
        })
      });
      const data = await res.json();
      
      const agentMsg: ChatMessageState = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.message || "Aqui está o que preparei.",
        timestamp: new Date().toISOString()
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
          prompt: data.action.optimizedPrompt,
          explanation: data.action.explanation,
          model: agentModel,
          aspectRatio: (plannedKind === 'image' || isAdCreative) ? imageRatio : videoRatio,
          mediaModel: (plannedKind === 'image' || isAdCreative) ? imageModel : videoModel,
          avatarId: selectedAvatarId,
          referenceImage: referenceImageBase64,
          targetJobId: data.action.targetJobId,
          strategy: data.action.strategy,
          scriptOutline: data.action.scriptOutline,
          creativeSteps: data.action.creativeSteps,
          requestedImageCount,
          imagePackageMode: plannedKind === 'image' && image3dMode ? 'turnaround3d' : undefined,
          quantity: (plannedKind === 'image' || isAdCreative) ? imageQty : videoQty,
          useAvatarPersonality,
          useCortexMemory,
          adCreativePlan: data.action.adCreativePlan
        };

        if (plannedKind === 'image' && image3dMode && referenceImageBase64) {
          const baseImageData = await generate3dBaseImage({
            prompt: build3dBasePrompt(data.action.optimizedPrompt || message),
            aspectRatio: imageRatio,
            model: imageModel,
            referenceImage: referenceImageBase64,
            forceReferenceUpload: true
          });

          const baseImagePath = baseImageData.path || baseImageData.paths?.[0] || null;
          agentMsg.imageResult = baseImageData;
          agentMsg.plan.referenceImage = null;
          agentMsg.plan.referenceImagePath = baseImagePath;
          agentMsg.plan.explanation = "Imagem base 3D gerada com o estilo solicitado. Aprove para gerar as variações de ângulo usando esta imagem como referência.";
          agentMsg.content = "Gerei a primeira imagem no estilo pedido. Se aprovar, continuo o pacote 3D usando esta imagem como base para os ângulos.";
        }
      }

      setChatMessages(prev => [...prev, agentMsg]);
    } catch (err) {
       console.error(err);
    } finally {
       setIsLoading(false);
    }
  };

  const handleApplyPlan = async (msgId: string) => {
    const msgIndex = chatMessages.findIndex(m => m.id === msgId);
    if (msgIndex < 0) return;
    const msg = chatMessages[msgIndex];
    if (!msg.plan) return;

    const nextMessages = [...chatMessages];
    nextMessages[msgIndex].jobStatus = 'running';
    nextMessages[msgIndex].jobLogs = [`[${new Date().toLocaleTimeString()}] Iniciando a execução do plano...`];
    nextMessages[msgIndex].jobType = msg.plan.kind;
    setChatMessages(nextMessages);

    try {
      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          prompt: msg.plan.originalPrompt,
          avatarId: msg.plan.avatarId || selectedAvatarId,
          useAvatarPersonality: msg.plan.useAvatarPersonality ?? useAvatarPersonality,
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
      
      const newMessages = [...chatMessages];
      const mIdx = newMessages.findIndex(m => m.id === msgId);
      if (data.success && data.jobId) {
        newMessages[mIdx].jobId = data.jobId;
        newMessages[mIdx].jobLogs?.push(`[${new Date().toLocaleTimeString()}] Job criado: ${data.jobId}`);
      } else {
        newMessages[mIdx].jobStatus = 'failed';
        newMessages[mIdx].jobLogs?.push(`[${new Date().toLocaleTimeString()}] Falha: ${data.error}`);
      }
      setChatMessages(newMessages);
    } catch (err) {
      console.error(err);
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
    setEditing3dImageMessageId(messageId);
    setDraftMessage("");
  };

  const handleEdit3dBaseImage = async (messageId: string, correctionPrompt: string) => {
    const cleanPrompt = correctionPrompt.trim();
    if (!cleanPrompt) return;

    const targetMessage = chatMessages.find((msg) => msg.id === messageId);
    const referenceImagePath = targetMessage?.plan?.referenceImagePath || targetMessage?.imageResult?.path || targetMessage?.imageResult?.paths?.[0];
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
        useExistingFlowReference: true
      });
      const editedImagePath = editedImage.path || editedImage.paths?.[0] || null;
      if (!editedImagePath) {
        throw new Error("A imagem editada foi gerada, mas nenhum caminho foi retornado.");
      }
      const updatedPlan: PendingPlan = {
        ...targetMessage.plan,
        referenceImage: null,
        referenceImagePath: editedImagePath
      };

      setChatMessages((previous) =>
        previous.map((msg) =>
          msg.id === messageId
            ? {
                ...msg,
                content: "Atualizei a imagem base com as correções e vou continuar o pacote 3D usando esta versão.",
                imageResult: editedImage,
                plan: updatedPlan,
                jobStatus: "running",
                jobType: updatedPlan.kind,
                jobLogs: [`[${new Date().toLocaleTimeString()}] Imagem base editada. Iniciando geração dos ângulos 3D...`]
              }
            : msg
        )
      );
      setEditing3dImageMessageId(null);
      setDraftMessage("");

      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          prompt: updatedPlan.originalPrompt,
          avatarId: updatedPlan.avatarId || selectedAvatarId,
          useAvatarPersonality: updatedPlan.useAvatarPersonality ?? useAvatarPersonality,
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
    const branchTitle = `${BRANCH_TITLE_PREFIX}${getConversationTitle(sanitizedBranchMessages)}`;
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
    setDraftMessage("");
    setChatMessages(chatMessages.slice(0, messageIndex + 1));
  };

  const handleEditMessage = (messageId: string) => {
    if (!canEditConversation) return;

    const messageIndex = chatMessages.findIndex((msg) => msg.id === messageId);
    const message = chatMessages[messageIndex];
    if (!message || message.role !== "user") return;

    setDraftMessage(getEditableMessageContent(message.content));
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
      localStorage.setItem(CHAT_CONVERSATIONS_KEY, JSON.stringify(updated));
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
  };

  const handleCreateConversation = () => {
    const conversation = createChatConversation();
    setChatConversations((previous) => [conversation, ...previous]);
    setActiveConversationId(conversation.id);
    setChatMessages([]);
  };

  const handleExportConversation = () => {
    if (!activeConversation) return;
    const messages = sanitizeChatMessages(chatMessages);
    const exportConversation = {
      ...activeConversation,
      title: getConversationTitle(messages)
    };
    const slug = exportConversation.title
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 48) || "chat";
    downloadTextFile(formatChatExport(exportConversation, messages), `mrchicken-${slug}.md`);
  };

  const clearChat = () => {
    setChatMessages([]);
  };

  return (
    <div className="relative isolate flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden bg-[#080808] text-white select-none md:h-screen" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* ── Backgrounds ── */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: "65%", zIndex: 1,
          backgroundImage: "url('/mrchicken-anime-bg.jpeg')", backgroundSize: "cover",
          backgroundPosition: "right 15% top", backgroundAttachment: "local",
          opacity: 0.15, mixBlendMode: "luminosity",
          maskImage: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.1) 10%, black 32%, black 78%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.1) 10%, black 32%, black 78%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0, zIndex: 0,
          background: "radial-gradient(ellipse 55% 50% at 82% 10%, rgba(157,124,255,0.065) 0%, transparent 100%), linear-gradient(180deg, rgba(8,8,8,0.30) 0%, rgba(8,8,8,0.72) 52%, #080808 100%)",
          pointerEvents: "none",
        }}
      />

      {/* ── Header ── */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-4 px-6 py-3 border-b border-white/5 backdrop-blur-md bg-black/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#9D7CFF]/20 flex items-center justify-center border border-[#9D7CFF]/30">
            <Bot size={18} className="text-[#9D7CFF]" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide">MrChicken Chatbot</h1>
            <p className="text-[10px] text-white/50">Assistente Autônomo AI UGC</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {chatConversations.length > 0 && (
            <div className="relative flex items-center bg-white/5 border border-white/10 rounded-full pl-3 pr-8 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group w-[160px] xs:w-[200px] sm:w-[240px] md:w-[280px]">
              <select
                className="appearance-none bg-transparent text-xs text-white/80 outline-none cursor-pointer w-full truncate py-1.5"
                value={activeConversationId}
                onChange={(e) => handleSelectConversation(e.target.value)}
                title="Selecionar conversa"
              >
                {chatConversations.map((conversation) => (
                  <option key={conversation.id} value={conversation.id} className="bg-[#080808] text-white">
                    {conversation.title}
                  </option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-3 text-white/40 group-hover:text-white/80 pointer-events-none transition-colors" />
            </div>
          )}
          {avatars.length > 0 && (
             <div className="relative flex items-center bg-white/5 border border-white/10 rounded-full pl-3 pr-8 hover:bg-white/10 hover:border-white/20 transition-all duration-200 group w-[120px] sm:w-[150px]">
               <User size={12} className="text-white/50 shrink-0"/>
               <select 
                 className="appearance-none bg-transparent text-xs text-white/80 outline-none cursor-pointer w-full truncate py-1.5 pl-1.5"
                 value={selectedAvatarId}
                 onChange={(e) => setSelectedAvatarId(e.target.value)}
               >
                 {avatars.map(a => (
                   <option key={a.id} value={a.id} className="bg-[#080808] text-white">{a.name}</option>
                 ))}
               </select>
               <ChevronDown size={12} className="absolute right-3 text-white/40 group-hover:text-white/80 pointer-events-none transition-colors" />
             </div>
          )}
          <div className="flex items-center gap-1.5">
            <button onClick={handleCreateConversation} className="p-2 hover:bg-white/10 hover:text-white rounded-full transition-all duration-200 text-white/60 cursor-pointer" title="Nova conversa">
              <MessageSquarePlus size={16} />
            </button>
            <button
              onClick={handleExportConversation}
              disabled={chatMessages.length === 0}
              className="p-2 hover:bg-white/10 hover:text-white rounded-full transition-all duration-200 text-white/60 disabled:text-white/20 disabled:cursor-not-allowed cursor-pointer"
              title="Exportar conversa"
            >
              <Download size={16} />
            </button>
            <button onClick={clearChat} className="p-2 hover:bg-white/10 hover:text-white rounded-full transition-all duration-200 text-white/60 cursor-pointer" title="Limpar conversa">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </header>

      {/* ── Chat Area ── */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-8 pb-48 md:px-10 lg:px-32">
        {agentType === "ad-creative" && flyModeActive ? (
          <FlyModeWizard
            avatars={avatars}
            selectedAvatarId={selectedAvatarId}
            setSelectedAvatarId={setSelectedAvatarId}
            agentModel={agentModel}
            setAgentModel={setAgentModel}
            useCortexMemory={useCortexMemory}
          />
        ) : (
          <>
            {chatMessages.length === 0 && (
              <div className="flex-1 flex flex-col items-center justify-center text-center opacity-70 mt-10">
                <Bot size={48} className="text-[#9D7CFF] mb-4 opacity-80" />
                <h2 className="text-xl font-light tracking-tight mb-2">Olá! Eu sou o Agente MrChicken.</h2>
                <p className="text-sm text-white/60 max-w-sm leading-relaxed">
                  Posso te ajudar a criar imagens, vídeos de react ou planejar projetos completos. O que vamos criar hoje?
                </p>
              </div>
            )}

            {chatMessages.map(msg => (
              <div key={msg.id} className={`flex flex-col ${msg.plan && !msg.jobId ? 'w-full max-w-[760px]' : 'max-w-[85%]'} ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
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
                  <div className={`flex flex-col gap-2 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    <div className={`px-4 py-3 text-[13px] leading-relaxed rounded-2xl ${msg.role === 'user' ? 'bg-[#9D7CFF]/20 border border-[#9D7CFF]/30 rounded-tr-sm text-white/90' : 'bg-white/5 border border-white/10 rounded-tl-sm text-white/80'} prose prose-invert max-w-none prose-sm prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10`}>
                      <ReactMarkdown>
                        {msg.content}
                      </ReactMarkdown>
                    </div>

                    {canEditConversation && (
                      <div className={`flex items-center gap-2 px-1 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <button
                          type="button"
                          onClick={() => handleReturnToMessage(msg.id)}
                          className="flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 text-[10px] text-white/45 transition-colors hover:border-white/20 hover:text-white/75"
                          title="Criar ramificação até esta mensagem"
                        >
                          <Undo2 size={11} />
                          Voltar
                        </button>
                        {msg.role === "user" && (
                          <button
                            type="button"
                            onClick={() => handleEditMessage(msg.id)}
                            className="flex h-6 items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 text-[10px] text-white/45 transition-colors hover:border-white/20 hover:text-white/75"
                            title="Criar ramificação editando esta mensagem"
                          >
                            <Pencil size={11} />
                            Editar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleBranchFromMessage(msg.id)}
                          className="flex h-6 items-center gap-1 rounded-full border border-[#9D7CFF]/20 bg-[#9D7CFF]/10 px-2 text-[10px] text-[#c7b7ff] transition-colors hover:border-[#9D7CFF]/35 hover:bg-[#9D7CFF]/15 hover:text-white"
                          title="Criar uma ramificacao ate esta mensagem"
                        >
                          <MessageSquarePlus size={11} />
                          Ramificar
                        </button>
                      </div>
                    )}

                    {/* Plan Card */}
                    {msg.plan && !msg.jobId && (
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

                          {msg.plan.imagePackageMode === 'turnaround3d' && msg.imageResult?.success && (msg.imageResult.path || msg.imageResult.paths?.[0]) && (
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
                            <button onClick={() => handleApplyPlan(msg.id)} className="flex-1 py-1.5 text-center text-[11px] font-semibold text-black bg-[#9D7CFF] hover:bg-[#b096ff] rounded-xl transition-all cursor-pointer">
                              Aplicar
                            </button>
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
                          <button onClick={() => handleStopJob(msg.id, msg.jobId!)} className="text-[10px] text-white/40 hover:text-red-400 flex items-center gap-1 cursor-pointer">
                            <Square size={8} fill="currentColor" /> Cancelar
                          </button>
                        </div>
                        {msg.plan?.imagePackageMode === 'turnaround3d' && msg.imageResult?.success && (msg.imageResult.path || msg.imageResult.paths?.[0]) && (
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
                    {msg.jobId && msg.jobStatus === 'completed' && msg.imageResult && (
                       <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-[#0a0a0e]/90 border border-green-500/20 flex flex-col gap-3">
                         <div className="flex items-center gap-1.5 text-[11px] text-green-400 font-semibold">
                           <CheckCircle size={13} /> Geração de mídia concluída!
                         </div>
                         {msg.imageResult.paths && msg.imageResult.paths.length > 0 ? (
                           <div className="grid grid-cols-2 gap-2">
                             {msg.imageResult.paths.slice(0, 4).map((p, idx) => (
                               <div key={idx} className="relative group rounded-xl overflow-hidden border border-white/10 bg-black aspect-square cursor-pointer" onClick={() => setExpandedResultImage({ src: getFlowMediaUrl(p), alt: `Midia gerada ${idx + 1}`, downloadUrl: getFlowMediaUrl(p) })}>
                                 <img src={getFlowMediaUrl(p)} alt={`Midia gerada ${idx + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                                 <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                   <span className="text-[10px] text-white font-medium bg-black/60 px-2 py-1 rounded-md">Expandir</span>
                                 </div>
                               </div>
                             ))}
                           </div>
                         ) : (
                           msg.imageResult.path && (
                             <div className="relative group rounded-xl overflow-hidden border border-white/10 bg-black aspect-video cursor-pointer" onClick={() => setExpandedResultImage({ src: getFlowMediaUrl(msg.imageResult!.path), alt: "Midia gerada", downloadUrl: getFlowMediaUrl(msg.imageResult!.path) })}>
                               <img src={getFlowMediaUrl(msg.imageResult.path)} alt="Midia gerada" className="w-full h-full object-cover" />
                             </div>
                           )
                         )}
                         {msg.imageResult.path && (
                            <a href={getFlowMediaUrl(msg.imageResult.path)} download className="flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2 text-[11px] font-semibold text-green-400 hover:bg-green-500/20 transition-all cursor-pointer">
                              <Download size={12} /> Baixar Pacote Completo
                            </a>
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
                    {msg.jobId && (msg.jobStatus === 'failed' || (msg.projectResult && !msg.projectResult.success)) && (
                       <div className="mt-2 w-full max-w-sm rounded-[20px] p-4 bg-red-500/5 border border-red-500/20 flex flex-col gap-2">
                         <div className="flex items-center gap-1.5 text-[11px] text-red-400 font-semibold">
                           <AlertCircle size={13} /> Falha no processamento.
                         </div>
                         <p className="text-[11px] text-white/50 leading-relaxed select-text">
                           {msg.projectResult?.error || "Ocorreu um erro no pipeline do MrChicken. Verifique os logs detalhados para entender a causa."}
                         </p>
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

            {isLoading && (
              <div className="flex gap-3 self-start">
                <div className="w-7 h-7 rounded-full bg-[#9D7CFF]/20 border border-[#9D7CFF]/30 flex items-center justify-center shrink-0">
                   <Bot size={12} className="text-[#9D7CFF]" />
                </div>
                <div className="px-4 py-3 text-[13px] rounded-2xl bg-white/5 border border-white/10 rounded-tl-sm text-white/60 flex items-center gap-2">
                   <Loader2 size={14} className="animate-spin text-[#9D7CFF]/70" />
                   MrChicken está pensando...
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
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

      {/* ── Input Bar or Floating Settings Gear ── */}
      {!(agentType === "ad-creative" && flyModeActive) ? (
        <div className="absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-[#080808] via-[#080808]/90 to-transparent pt-10 pb-6 px-4 md:px-10 lg:px-32 flex justify-center">
          <div className="w-full max-w-[900px] relative" ref={popoverRef}>
            <PromptInputBox
              isLoading={isLoading}
              value={draftMessage}
              onValueChange={setDraftMessage}
              placeholder={editing3dImageMessageId ? "Descreva as correções para editar a imagem base..." : agentType === "image" && image3dMode ? "Anexe uma imagem e envie para gerar o 3D..." : "Mande uma mensagem ou descreva o que quer criar..."}
              onSend={(message, files) => handleSendMessage(message, (files ?? []).map(f => ({ file: f })), [])}
              onOptionsClick={() => setShowSettings(!showSettings)}
              showOptions={showSettings}
              useCortexMemory={useCortexMemory}
              onCortexMemoryChange={setUseCortexMemory}
            />
            <AnimatePresence>
              {showSettings && renderSettingsMenu(false)}
            </AnimatePresence>
          </div>
        </div>
      ) : (
        <div className="absolute bottom-6 right-6 z-40">
          <div className="relative" ref={popoverRef}>
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-white/80 hover:bg-white/10 transition-colors shadow-lg shadow-black/40 backdrop-blur-md cursor-pointer"
              title="Configurações do Piloto"
            >
              <Settings size={18} />
            </button>
            <AnimatePresence>
              {showSettings && renderSettingsMenu(true)}
            </AnimatePresence>
          </div>
        </div>
      )}
    </div>
  );
}
