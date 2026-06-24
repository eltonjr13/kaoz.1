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
  ThumbsDown
} from "lucide-react";
import { ClaudeChatInput } from "@/components/ui/claude-style-ai-input";
import ReactMarkdown from "react-markdown";

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
  targetJobId?: string | null;
  strategy?: string;
  scriptOutline?: string | null;
  creativeSteps?: string[];
  visualReferenceInstructions?: string;
  requestedImageCount?: number;
  imagePackageMode?: ImagePackageMode;
  turnaroundViews?: TurnaroundView[];
  useAvatarPersonality?: boolean;
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

const getConversationTitle = (messages: ChatMessageState[]) => {
  const firstUserMessage = messages.find((msg) => msg.role === "user")?.content.trim();
  if (!firstUserMessage) return "Nova conversa";
  const firstLine = firstUserMessage.split(/\r?\n/)[0].trim();
  return firstLine.length > 48 ? `${firstLine.slice(0, 48)}...` : firstLine;
};

const getConversationTitleWithBranch = (messages: ChatMessageState[], currentTitle: string) => {
  const title = getConversationTitle(messages);
  return currentTitle.startsWith(BRANCH_TITLE_PREFIX) ? `${BRANCH_TITLE_PREFIX}${title}` : title;
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
  
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [useAvatarPersonality, setUseAvatarPersonality] = useState(() =>
    typeof window === "undefined" ? true : localStorage.getItem(USE_AVATAR_PERSONALITY_KEY) !== "false"
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
  const [draftMessage, setDraftMessage] = useState("");
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
          adCreativePlan: data.action.adCreativePlan
        };
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
          model: msg.plan.model,
          aspectRatio: msg.plan.aspectRatio,
          imageModel: (msg.plan.kind === 'image' || msg.plan.kind === 'ad-creative') ? msg.plan.mediaModel : undefined,
          imageQuantity: (msg.plan.kind === 'image' || msg.plan.kind === 'ad-creative') ? msg.plan.quantity : undefined,
          requestedImageCount: (msg.plan.kind === 'image' || msg.plan.kind === 'ad-creative') ? msg.plan.requestedImageCount : undefined,
          imagePackageMode: msg.plan.imagePackageMode,
          turnaroundViews: msg.plan.turnaroundViews,
          referenceImage: msg.plan.referenceImage || undefined,
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

  const canBranchConversation = !isLoading && !chatMessages.some((msg) => msg.jobStatus === "running");

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
    if (!canBranchConversation) return;

    const messageIndex = chatMessages.findIndex((msg) => msg.id === messageId);
    if (messageIndex < 0) return;

    createConversationBranch(chatMessages.slice(0, messageIndex + 1));
  };

  const handleEditMessage = (messageId: string) => {
    if (!canBranchConversation) return;

    const messageIndex = chatMessages.findIndex((msg) => msg.id === messageId);
    const message = chatMessages[messageIndex];
    if (!message || message.role !== "user") return;

    setDraftMessage(getEditableMessageContent(message.content));
    createConversationBranch(chatMessages.slice(0, messageIndex));
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
    <div className="relative isolate min-h-screen flex flex-col bg-[#080808] text-white select-none overflow-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
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
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-b border-white/5 backdrop-blur-md bg-black/20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-[#9D7CFF]/20 flex items-center justify-center border border-[#9D7CFF]/30">
            <Bot size={18} className="text-[#9D7CFF]" />
          </div>
          <div>
            <h1 className="text-sm font-semibold tracking-wide">MrChicken Chatbot</h1>
            <p className="text-[10px] text-white/50">Assistente Autônomo AI UGC</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {chatConversations.length > 0 && (
            <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1">
              <select
                className="w-[170px] max-w-[42vw] bg-transparent text-xs text-white/80 outline-none cursor-pointer"
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
            </div>
          )}
          {avatars.length > 0 && (
             <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-3 py-1">
               <User size={12} className="text-white/60"/>
               <select 
                 className="bg-transparent text-xs text-white/80 outline-none cursor-pointer"
                 value={selectedAvatarId}
                 onChange={(e) => setSelectedAvatarId(e.target.value)}
               >
                 {avatars.map(a => (
                   <option key={a.id} value={a.id} className="bg-[#080808] text-white">{a.name}</option>
                 ))}
               </select>
             </div>
          )}
          <button onClick={handleCreateConversation} className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/60 cursor-pointer" title="Nova conversa">
            <MessageSquarePlus size={14} />
          </button>
          <button
            onClick={handleExportConversation}
            disabled={chatMessages.length === 0}
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/60 disabled:text-white/20 disabled:cursor-not-allowed cursor-pointer"
            title="Exportar conversa"
          >
            <Download size={14} />
          </button>
          <button onClick={clearChat} className="p-1.5 hover:bg-white/10 rounded-full transition-colors text-white/60 cursor-pointer" title="Limpar conversa">
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      {/* ── Chat Area ── */}
      <div className="relative z-10 flex-1 overflow-y-auto px-4 md:px-10 lg:px-32 py-8 flex flex-col gap-6 pb-48">
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
          <div key={msg.id} className={`flex flex-col max-w-[85%] ${msg.role === 'user' ? 'self-end' : 'self-start'}`}>
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

                {canBranchConversation && (
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
                      
                      {msg.plan.kind === 'ad-creative' && msg.plan.adCreativePlan?.concepts && (
                        <div className="flex flex-col gap-2 mb-3 max-h-48 overflow-y-auto pr-1">
                          {msg.plan.adCreativePlan.concepts.map((concept, idx) => (
                            <div key={idx} className="bg-white/5 rounded-xl p-3 border border-white/5 text-[11px]">
                              <div className="font-semibold text-[#9D7CFF] mb-1">{concept.conceptName}</div>
                              <div className="text-white/80 mb-1.5"><strong className="text-white/60">Copy:</strong> "{concept.copyText}"</div>
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

                      <div className="flex items-center gap-2">
                        <button onClick={() => handleApplyPlan(msg.id)} className="flex-1 bg-white text-black py-2 rounded-full text-xs font-semibold hover:opacity-90 flex items-center justify-center gap-1.5 cursor-pointer">
                          <Check size={14}/> Aprovar
                        </button>
                        <button onClick={() => handleCancelPlan(msg.id)} className="flex-1 bg-white/10 border border-white/10 py-2 rounded-full text-xs font-medium hover:bg-white/20 cursor-pointer">
                          Cancelar
                        </button>
                      </div>
                  </div>
                )}

                {/* Running Status & Logs */}
                {msg.jobId && (
                  <div className="mt-2 w-full min-w-[280px] max-w-md rounded-[20px] p-4 bg-white/5 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2 text-xs font-medium text-white/80">
                        {msg.jobStatus === 'running' && <Loader2 size={14} className="animate-spin text-[#9D7CFF]" />}
                        {msg.jobStatus === 'completed' && <CheckCircle size={14} className="text-emerald-400" />}
                        {msg.jobStatus === 'failed' && <AlertCircle size={14} className="text-rose-500" />}
                        <span>
                          {msg.jobStatus === 'running' ? 'Processando...' : 
                           msg.jobStatus === 'completed' ? 'Finalizado' : 'Falhou'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {msg.jobStatus === "running" && msg.jobId && (
                          <button
                            onClick={() => handleStopJob(msg.id, msg.jobId!)}
                            className="text-[10px] uppercase tracking-wider text-rose-300 hover:text-rose-200 flex items-center gap-1 cursor-pointer"
                          >
                            <Square size={10} /> Parar
                          </button>
                        )}
                        <button
                          onClick={() => {
                            const next = [...chatMessages];
                            const idx = next.findIndex(m => m.id === msg.id);
                            next[idx].showLogs = !next[idx].showLogs;
                            setChatMessages(next);
                          }}
                          className="text-[10px] uppercase tracking-wider text-white/50 hover:text-white/80 flex items-center gap-1 cursor-pointer"
                        >
                          <Terminal size={10} /> Logs
                        </button>
                      </div>
                    </div>

                    {msg.showLogs && msg.jobLogs && (
                      <div className="bg-black/60 border border-white/5 rounded-xl p-3 text-[10px] font-mono text-white/50 h-32 overflow-y-auto mb-3">
                        {msg.jobLogs.map((log, i) => (
                          <div key={i} className="mb-1 leading-relaxed break-all">{log}</div>
                        ))}
                      </div>
                    )}

                    {/* Media Output - Image */}
                    {msg.imageResult?.success && (
                      <div className="grid grid-cols-2 gap-2 mt-3">
                        {(msg.imageResult.paths || [msg.imageResult.path]).map((p, idx) => (
                          <div key={idx} className="relative aspect-square rounded-xl overflow-hidden bg-black/50 border border-white/10 group">
                            <img src={`/api/flow/media?path=${encodeURIComponent(p)}`} alt="Result" className="w-full h-full object-cover" />
                            <a href={`/api/flow/media?path=${encodeURIComponent(p)}`} download className="absolute bottom-2 right-2 p-1.5 bg-black/60 rounded-full text-white/80 hover:text-white border border-white/20 opacity-0 group-hover:opacity-100 transition-opacity">
                              <ArrowRight size={12} className="rotate-90"/>
                            </a>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Media Output - Video or Project */}
                    {(msg.videoResult?.success || msg.projectResult?.success) && (
                      <div className="grid grid-cols-1 gap-2 mt-3">
                         {((msg.videoResult?.paths || (msg.projectResult?.videoPath ? [msg.projectResult.videoPath] : []))).map((p, idx) => (
                           <div key={idx} className="relative aspect-video rounded-xl overflow-hidden bg-black/50 border border-white/10">
                             {/\.(png|jpe?g|webp)$/i.test(p) ? (
                               <img src={p.startsWith("http") ? p : `/api/flow/media?path=${encodeURIComponent(p)}`} alt="Result" className="w-full h-full object-contain" />
                             ) : (
                               <video src={p.startsWith("http") ? p : `/api/flow/media?path=${encodeURIComponent(p)}`} controls className="w-full h-full object-contain" />
                             )}
                           </div>
                         ))}
                      </div>
                    )}
                    
                    {msg.projectResult && msg.projectResult.error && (
                      <div className="text-xs text-rose-400 mt-2 p-2 bg-rose-500/10 rounded-lg border border-rose-500/20">
                        {msg.projectResult.error}
                      </div>
                    )}

                    {msg.jobStatus === 'completed' && (
                      <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/10">
                        <span className="text-[11px] text-white/40">Avalie o resultado:</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            title="Gostei 👍"
                            className={`p-1.5 rounded-lg transition-all cursor-pointer ${
                              msg.feedback === 'good' 
                                ? 'bg-emerald-500/20 text-emerald-400 scale-110' 
                                : 'text-white/40 hover:text-white/80 hover:bg-white/5'
                            }`}
                            onClick={() => handleEvaluateJob(msg.id, msg.jobId!, 'good')}
                          >
                            <ThumbsUp size={13} fill={msg.feedback === 'good' ? 'currentColor' : 'none'} />
                          </button>
                          <button
                            type="button"
                            title="Não gostei 👎"
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
      </div>

      {/* ── Input Bar ── */}
      <div className="absolute bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-[#080808] via-[#080808]/90 to-transparent pt-10 pb-6 px-4 md:px-10 lg:px-32 flex justify-center">
        <div className="w-full max-w-[900px] relative" ref={popoverRef}>
          <ClaudeChatInput
            disabled={isLoading}
            acceptedFileTypes={["image/*"]}
            placeholder={agentType === "image" && image3dMode ? "Anexe uma imagem e envie para gerar o 3D..." : "Mande uma mensagem ou descreva o que quer criar..."}
            models={[
              { id: "gemini", name: "Gemini", description: "Google Gemini Model" },
              { id: "chatgpt", name: "ChatGPT", description: "OpenAI ChatGPT Model" },
              { id: "deepseek", name: "DeepSeek", description: "DeepSeek Model" },
              { id: "claude", name: "Claude", description: "Anthropic Claude Model" }
            ]}
            defaultModel={agentModel}
            onModelChange={(modelId) => setAgentModel(modelId as any)}
            onSendMessage={handleSendMessage}
            messageValue={draftMessage}
            onMessageChange={setDraftMessage}
            onOptionsClick={() => setShowSettings(!showSettings)}
            showOptions={showSettings}
            optionsContent={
              <div className="absolute bottom-full left-0 z-50 mb-3 flex w-[332px] max-w-[calc(100vw-32px)] flex-col gap-5 rounded-[28px] p-5 pointer-events-auto bg-[#0c0c10] border border-white/10 backdrop-blur-xl">
                  <div className="flex flex-col gap-2">
                    <div className="px-1 text-[9px] font-bold uppercase tracking-widest text-[#4A4A54]">Tipo Preferido</div>
                    <div className="grid grid-cols-4 rounded-[14px] p-0.5 bg-white/5 border border-white/10">
                      {[
                        { id: "image", label: "Imagem", icon: <ImageIcon size={10} /> },
                        { id: "video", label: "Vídeo", icon: <Film size={10} /> },
                        { id: "project", label: "React", icon: <Cpu size={10} /> },
                        { id: "ad-creative", label: "Anúncio", icon: <Bot size={10} /> },
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
                          className="flex items-center justify-center gap-1 rounded-xl py-1.5 text-[9px] font-semibold transition-all cursor-pointer text-center"
                          style={{ background: agentType === t.id ? "rgba(255,255,255,0.1)" : "transparent", color: agentType === t.id ? "#ffffff" : "#4A4A54" }}
                        >
                          {t.icon} <span>{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                 {/* Image mode (3D turnaround toggle) */}
                 {agentType === "image" && (
                   <div className="flex flex-col gap-2">
                     <div className="px-1 text-[9px] font-bold uppercase tracking-widest text-[#4A4A54]">
                       Modo da Imagem
                     </div>
                     <div className="grid grid-cols-2 rounded-[14px] p-0.5 bg-white/5 border border-white/10">
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
                             className="rounded-xl py-1.5 text-[10px] font-semibold transition-all cursor-pointer"
                             style={{
                               background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                               color: isActive ? "#ffffff" : "#4A4A54",
                             }}
                           >
                             {mode.label}
                           </button>
                         );
                       })}
                     </div>
                   </div>
                 )}

                 <label className="flex items-center justify-between gap-3 rounded-[14px] border border-white/10 bg-white/5 px-3 py-2">
                   <span className="flex flex-col gap-0.5">
                     <span className="text-[10px] font-semibold text-white/80">Personalidade do avatar</span>
                     <span className="text-[9px] leading-snug text-white/40">Usar o tom do avatar nas respostas e roteiros</span>
                   </span>
                   <input
                     type="checkbox"
                     checked={useAvatarPersonality}
                     onChange={(e) => setUseAvatarPersonality(e.target.checked)}
                     className="h-4 w-4 accent-[#9D7CFF]"
                   />
                 </label>

                 {/* Ratio + Quantity */}
                 {agentType !== "project" && (
                   <div className="grid grid-cols-2 gap-4">
                     <div className="flex flex-col gap-2">
                       <div className="px-1 text-[9px] font-bold uppercase tracking-widest text-[#4A4A54]">Proporção</div>
                       <div className="grid grid-cols-2 gap-1 rounded-[14px] p-1.5 bg-white/5 border border-white/10">
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
                               className="rounded-xl py-1 font-mono text-[10px] transition-all cursor-pointer"
                               style={{
                                 background: isActive ? "#ffffff" : "transparent",
                                 color: isActive ? "#080808" : "#7B7B86",
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
                       <div className="px-1 text-[9px] font-bold uppercase tracking-widest text-[#4A4A54]">
                         {agentType === "ad-creative" ? "Imagens" : "Quantidade"}
                       </div>
                        {agentType === "ad-creative" ? (
                          <div className="flex flex-col gap-2 rounded-[14px] p-2.5 bg-white/5 border border-white/10">
                            <div className="flex items-center justify-between">
                              <span className="text-[12px] font-bold text-white font-mono">
                                {imageQty.startsWith("x") ? imageQty.slice(1) : "20"}
                              </span>
                              <span className="text-[9px] text-[#7B7B86] uppercase tracking-wider font-mono">Imagens</span>
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
                          <div className="grid grid-cols-2 gap-1 rounded-[14px] p-1.5 bg-white/5 border border-white/10">
                            {/* eslint-disable-next-line complexity */}
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
                                  className="rounded-xl py-1 font-mono text-[10px] transition-all"
                                  style={{
                                    background: isActive ? "#ffffff" : "transparent",
                                    color: isActive ? "#080808" : isDisabled ? "#2a2a2a" : "#7B7B86",
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
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
