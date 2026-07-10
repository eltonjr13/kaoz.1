"use client";

import { useEffect, useState, useRef } from "react";
import {
  Image as ImageIcon,
  Loader2,
  AlertCircle,
  CheckCircle,
  Trash2,
  Terminal,
  Copy,
  ArrowRight,
  Sliders,
  Film,
  Cpu,
  Sparkles,
  User,
  Check
} from "lucide-react";
import { ClaudeChatInput } from "@/components/ui/claude-style-ai-input";


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

type AgentType = 'image' | 'video' | 'project';
type DirectGenerationType = 'image' | 'video';
type PlannedFlow = AgentType | 'refine';
type ImagePackageMode = 'turnaround3d';
type TurnaroundView = 'front' | 'left' | 'right' | 'back' | 'top' | 'bottom';

const BASE_TURNAROUND_VIEWS: TurnaroundView[] = ['front', 'left', 'right', 'back'];
const TOP_BOTTOM_VIEWS: TurnaroundView[] = ['top', 'bottom'];
const DEFAULT_3D_REFERENCE_PROMPT = "Generate a multi-image 3D character reference package from the attached image.";

interface PendingPlan {
  kind: AgentType;
  flow: PlannedFlow;
  originalPrompt: string;
  prompt: string;
  explanation: string;
  model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini' | 'cerebras' | 'zenmux';
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
  imagePackageMode?: ImagePackageMode;
  turnaroundViews?: TurnaroundView[];
}

const normalizePromptForIntent = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const inferExplicitMediaType = (prompt: string): DirectGenerationType | null => {
  const normalized = normalizePromptForIntent(prompt);
  const asksForImage = /\b(imagem|img|foto|fotografia|ilustracao|arte|poster|banner|thumbnail|capa)\b/.test(normalized);
  const asksForVideo = /\b(video|vid|clipe|filme|animacao|reel|short|shorts|storyboard)\b/.test(normalized);

  if (asksForImage && !asksForVideo) return "image";
  if (asksForVideo && !asksForImage) return "video";
  return null;
};

const inferTurnaround3dPackage = (prompt: string): { imagePackageMode: ImagePackageMode; turnaroundViews: TurnaroundView[] } | null => {
  const normalized = normalizePromptForIntent(prompt);
  const asksForTurnaround = /\b(3d|modelagem|angulos?|vistas?|turnaround|frente|traseira|lateral|produto final|peca 3d|objeto 3d)\b/.test(normalized);

  if (!asksForTurnaround) return null;

  const asksForTopBottom = /\b(topo|cima|baixo|base|embaixo|superior|inferior)\b/.test(normalized);
  return {
    imagePackageMode: 'turnaround3d',
    turnaroundViews: asksForTopBottom ? [...BASE_TURNAROUND_VIEWS, ...TOP_BOTTOM_VIEWS] : BASE_TURNAROUND_VIEWS
  };
};

const copyToClipboard = (text: string): boolean => {
  if (typeof window === "undefined") return false;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text);
    return true;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand("copy");
    document.body.removeChild(textarea);
    return true;
  } catch {
    document.body.removeChild(textarea);
    return false;
  }
};

const getResultFilename = (filePath: string) => {
  if (!filePath) return "";
  const cleanPath = filePath.split("?")[0];
  return cleanPath.split(/[\\/]/).pop() || cleanPath;
};

const extractImagePathsFromJob = (value?: string | null) => {
  if (!value) return [];

  const marker = "Imagens salvas em:";
  const markerIndex = value.indexOf(marker);
  if (markerIndex >= 0) {
    const jsonText = value.slice(markerIndex + marker.length).trim();
    try {
      const parsed = JSON.parse(jsonText);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.images)) {
        return parsed.images
          .map((item: unknown) => {
            if (typeof item === "string") return item;
            if (item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string") {
              return (item as { path: string }).path;
            }
            return null;
          })
          .filter((item: string | null): item is string => Boolean(item));
      }
    } catch {
      // Fall through to the legacy array extraction below.
    }
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

export default function FlowDashboardPage() {

  // 2. Control States
  const [agentModel, setAgentModel] = useState<'deepseek' | 'claude' | 'chatgpt' | 'gemini' | 'cerebras' | 'zenmux'>('gemini');
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentType, setAgentType] = useState<AgentType>('image');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResult, setAgentResult] = useState<string | null>(null);
  const [pendingPlan, setPendingPlan] = useState<PendingPlan | null>(null);

  // Avatar and Agent Project States
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectResult, setProjectResult] = useState<{ success: boolean; jobId?: string; videoPath?: string; error?: string } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeJobType, setActiveJobType] = useState<AgentType | null>(null);

  // 3. ImageFX States
  const [imageRatio, setImageRatio] = useState("16:9");
  const [imageQty, setImageQty] = useState("x2");
  const [imageModel, setImageModel] = useState("Nano Banana 2");
  const [image3dMode, setImage3dMode] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageResult, setImageResult] = useState<GenerationResult | null>(null);
  const [imageReference, setImageReference] = useState<string | null>(null);

  // 4. VideoFX States
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [videoQty, setVideoQty] = useState("1x");
  const [videoModel, setVideoModel] = useState("Veo 3.1");
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoResult, setVideoResult] = useState<GenerationResult | null>(null);
  const [videoReference, setVideoReference] = useState<string | null>(null);

  // 5. Logs State
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const consoleEndRef = useRef<HTMLDivElement>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null);

  // 6. Popover States
  const [showSettings, setShowSettings] = useState(false);

  // Popover container ref for click-outside detection
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setShowSettings(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  // Auto-scroll background page element to deep dark
  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const originalBg = mainEl.style.backgroundColor;
      mainEl.style.backgroundColor = '#080808';
      return () => {
        mainEl.style.backgroundColor = originalBg;
      };
    }
  }, []);

  // Helper to append logs
  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  const clearPendingPlan = () => {
    setPendingPlan(null);
  };

  // Fetch avatars list
  const fetchAvatars = async () => {
    try {
      const res = await fetch("/api/avatars");
      if (res.ok) {
        const data = await res.json();
        const list = data.avatars || data;
        setAvatars(list);
        if (list.length > 0) {
          setSelectedAvatarId(list[0].id);
        }
      }
    } catch (err) {
      console.error("Falha ao buscar avatars:", err);
    }
  };

  // Trigger avatar checks on load
  useEffect(() => {
    setTimeout(() => {
      fetchAvatars();
      appendLog("Painel do Agente MrChicken inicializado.");
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, 220);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 220 ? "auto" : "hidden";
  }, [agentPrompt]);

  // Poll agent events in real-time
  useEffect(() => {
    if (!activeJobId) return;

    let isMounted = true;
    const seenEventIds = new Set<string>();

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/events?jobId=${activeJobId}`);
        if (!res.ok) return;
        const data = await res.json();
        const events = data.events || [];

        if (!isMounted) return;

        const newEvents = events.filter((e: { id: string }) => !seenEventIds.has(e.id));
        if (newEvents.length > 0) {
          newEvents.forEach((e: { id: string }) => seenEventIds.add(e.id));
          setLogs((prev) => {
            const added = newEvents.map((e: { created_at: string; message: string }) => {
              const dateStr = new Date(e.created_at).toLocaleTimeString();
              return `[${dateStr}] [Agente] ${e.message}`;
            });
            return [...prev, ...added];
          });
        }

        const hasFinished = events.some((e: { event_type: string }) => e.event_type === "completed" || e.event_type === "failed");
        if (hasFinished) {
          try {
            const jobRes = await fetch(`/api/jobs?jobId=${activeJobId}`);
            if (jobRes.ok) {
              const jobData = await jobRes.json();
              const job = jobData.jobs?.[0];
              if (job) {
                if (job.status === "completed") {
                  const finalPath = job.final_video_path || "";
                  if (activeJobType === "image") {
                    const imagePaths = extractImagePathsFromJob(job.source_video_transcription);
                    setImageResult({
                      success: true,
                      path: finalPath,
                      filename: getResultFilename(finalPath),
                      paths: imagePaths.length > 0 ? imagePaths : (finalPath ? [finalPath] : []),
                      createdAt: job.updated_at || new Date().toISOString()
                    });
                  } else if (activeJobType === "video") {
                    setVideoResult({
                      success: true,
                      path: finalPath,
                      filename: getResultFilename(finalPath),
                      createdAt: job.updated_at || new Date().toISOString()
                    });
                  } else {
                    setProjectResult({
                      success: true,
                      jobId: activeJobId,
                      videoPath: finalPath || undefined
                    });
                  }
                } else {
                  const error = job.error_message || "O agente falhou na execucao.";
                  if (activeJobType === "image") {
                    setImageResult({
                      success: false,
                      path: "",
                      filename: "",
                      createdAt: new Date().toISOString(),
                      error
                    });
                  } else if (activeJobType === "video") {
                    setVideoResult({
                      success: false,
                      path: "",
                      filename: "",
                      createdAt: new Date().toISOString(),
                      error
                    });
                  } else {
                    setProjectResult({
                      success: false,
                      error
                    });
                  }
                }
              }
            }
          } catch (jobErr) {
            console.error("Erro ao buscar detalhes do job finalizado:", jobErr);
          }
          setActiveJobId(null);
          setActiveJobType(null);
        }
      } catch (err) {
        console.error("Erro no polling de eventos:", err);
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJobId, activeJobType]);

  // Upload Reference Image Handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setRef: (val: string | null) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
    clearPendingPlan();
    const reader = new FileReader();
    reader.onload = (event) => {
      if (typeof event.target?.result === "string") {
        setRef(event.target.result);
        appendLog(`Imagem de referência selecionada (${(file.size / 1024).toFixed(1)} KB).`);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveReference = () => {
    clearPendingPlan();
    if (agentType === 'image') {
      setImageReference(null);
    } else {
      setVideoReference(null);
    }
    appendLog("Imagem de referência removida.");
  };

  const executeProjectPlan = async (plan: PendingPlan) => {
    if (!plan.avatarId) {
      appendLog("[Agente Autonomo] Selecione um avatar antes de aplicar o plano.");
      return;
    }

    setProjectLoading(true);
    setProjectResult(null);
    setActiveJobId(null);
    setShowLogs(true);
    setLogs([]);
    appendLog(`[Agente Autonomo] Aplicando plano aprovado para: "${plan.originalPrompt}"...`);

    try {
      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          prompt: plan.originalPrompt,
          avatarId: plan.avatarId,
          model: plan.model,
          aspectRatio: plan.aspectRatio,
          videoModel: plan.mediaModel,
          approvedPlan: {
            flow: plan.flow,
            optimizedPrompt: plan.prompt,
            explanation: plan.explanation,
            targetJobId: plan.targetJobId ?? null,
            strategy: plan.strategy,
            scriptOutline: plan.scriptOutline ?? null,
            creativeSteps: plan.creativeSteps,
            visualReferenceInstructions: plan.visualReferenceInstructions
          }
        })
      });
      const data = await res.json();
      if (data.success && data.jobId) {
        setProjectResult(data);
        setActiveJobId(data.jobId);
        setActiveJobType("project");
        setPendingPlan(null);
        appendLog(`[Agente Autonomo] Projeto inicializado com sucesso! Job ID: ${data.jobId}`);
      } else {
        setProjectResult({ success: false, error: data.error || "Erro desconhecido" });
        appendLog(`[Agente Autonomo] Erro ao inicializar: ${data.error}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`[Agente Autonomo] Erro na requisicao: ${errMsg}`);
    } finally {
      setProjectLoading(false);
    }
  };

  const executeDirectGenerationPlan = async (plan: PendingPlan) => {
    if (plan.imagePackageMode === "turnaround3d" && !plan.avatarId) {
      setImageResult({
        success: false,
        path: "",
        filename: "",
        createdAt: new Date().toISOString(),
        error: "Selecione um avatar para executar o pacote 3D pelo agente."
      });
      appendLog("[Agente Autonomo] Pacote 3D precisa executar pelo agente com avatar selecionado.");
      return;
    }

    if (plan.avatarId) {
      const isImage = plan.kind === "image";
      const setLoading = isImage ? setImageLoading : setVideoLoading;
      const setResult = isImage ? setImageResult : setVideoResult;
      setLoading(true);
      setResult(null);
      setProjectResult(null);
      setActiveJobId(null);
      setActiveJobType(null);
      setShowLogs(true);
      appendLog(`[Agente Autonomo] Aplicando plano de ${isImage ? "imagem" : "video"} com avatar de referencia...`);

      try {
        const res = await fetch("/api/flow/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create-project",
            prompt: plan.originalPrompt,
            avatarId: plan.avatarId,
            model: plan.model,
            aspectRatio: plan.aspectRatio,
            imageModel: isImage ? plan.mediaModel : undefined,
            imageQuantity: isImage ? plan.quantity : undefined,
            imagePackageMode: isImage ? plan.imagePackageMode : undefined,
            turnaroundViews: isImage ? plan.turnaroundViews : undefined,
            referenceImage: plan.referenceImage || undefined,
            videoModel: isImage ? undefined : plan.mediaModel,
            videoQuantity: isImage ? undefined : plan.quantity,
            approvedPlan: {
              flow: plan.kind,
              optimizedPrompt: plan.prompt,
              explanation: plan.explanation,
              targetJobId: null,
              strategy: plan.strategy,
              scriptOutline: plan.scriptOutline ?? null,
              creativeSteps: plan.creativeSteps,
              visualReferenceInstructions: plan.visualReferenceInstructions,
              imagePackageMode: plan.imagePackageMode,
              turnaroundViews: plan.turnaroundViews
            }
          }),
        });
        const data = await res.json();
        if (data.success && data.jobId) {
          setPendingPlan(null);
          setActiveJobId(data.jobId);
          setActiveJobType(plan.kind);
          appendLog(`[Agente Autonomo] Execucao ${isImage ? "de imagem" : "de video"} iniciada. Job ID: ${data.jobId}`);
        } else {
          setResult({
            success: false,
            path: "",
            filename: "",
            createdAt: new Date().toISOString(),
            error: data.error || "Erro desconhecido",
          });
          appendLog(`[Agente Autonomo] Falha: ${data.error}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        setResult({
          success: false,
          path: "",
          filename: "",
          createdAt: new Date().toISOString(),
          error: errMsg,
        });
        appendLog(`[Agente Autonomo] Erro: ${errMsg}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (plan.kind === "image") {
      setImageLoading(true);
      setImageResult(null);
      appendLog("[ImageFX] Aplicando plano aprovado e gerando imagens...");
      try {
        const res = await fetch("/api/flow/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "image",
            prompt: plan.prompt,
            aspectRatio: plan.aspectRatio,
            quantity: plan.quantity,
            model: plan.mediaModel,
            referenceImage: plan.referenceImage || undefined,
          }),
        });
        const data: GenerationResult = await res.json();
        if (data.success) {
          setImageResult(data);
          setPendingPlan(null);
          const generatedCount = data.paths?.length || (data.path ? 1 : 0);
          appendLog(`[ImageFX] ${generatedCount} imagem(ns) baixada(s) com sucesso.`);
        } else {
          setImageResult({
            success: false,
            path: "",
            filename: "",
            createdAt: new Date().toISOString(),
            error: data.error || "Erro na geracao",
          });
          appendLog(`[ImageFX] Falha: ${data.error}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        appendLog(`[ImageFX] Erro: ${errMsg}`);
      } finally {
        setImageLoading(false);
      }
      return;
    }

    setVideoLoading(true);
    setVideoResult(null);
    appendLog("[VideoFX] Aplicando plano aprovado e gerando video...");
    try {
      const res = await fetch("/api/flow/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "video",
          prompt: plan.prompt,
          aspectRatio: plan.aspectRatio,
          quantity: plan.quantity,
          model: plan.mediaModel,
          referenceImage: plan.referenceImage || undefined,
        }),
      });
      const data: GenerationResult = await res.json();
      if (data.success) {
        setVideoResult(data);
        setPendingPlan(null);
        appendLog("[VideoFX] Video gerado com sucesso.");
      } else {
        setVideoResult({
          success: false,
          path: "",
          filename: "",
          createdAt: new Date().toISOString(),
          error: data.error || "Erro na geracao",
        });
        appendLog(`[VideoFX] Falha: ${data.error}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`[VideoFX] Erro: ${errMsg}`);
    } finally {
      setVideoLoading(false);
    }
  };

  const handleApplyPlan = async () => {
    if (!pendingPlan) return;
    if (pendingPlan.kind === "project") {
      await executeProjectPlan(pendingPlan);
      return;
    }
    await executeDirectGenerationPlan(pendingPlan);
  };

  // Main Autopilot Execution
  const handleExecuteAutopilot = async (overridePrompt?: string, overrideReferenceImage?: string | null) => {
    const rawPrompt = overridePrompt !== undefined ? overridePrompt : agentPrompt;
    const referenceImageToUse = overrideReferenceImage !== undefined
      ? overrideReferenceImage
      : (agentType === "image" ? imageReference : videoReference);
    const canUseReferenceOnly3d = agentType === "image" && image3dMode && Boolean(referenceImageToUse);
    const promptToUse = rawPrompt.trim() || (canUseReferenceOnly3d ? DEFAULT_3D_REFERENCE_PROMPT : rawPrompt);
    if (pendingPlan) {
      appendLog("Existe um plano pendente. Aplique ou cancele antes de planejar novamente.");
      return;
    }

    if (!promptToUse.trim()) {
      appendLog(image3dMode ? "Aviso: Anexe uma imagem para gerar o pacote 3D." : "Aviso: Digite uma ideia para começar.");
      return;
    }

    const explicitMediaType = inferExplicitMediaType(promptToUse);
    const detectedTurnaroundPackage = explicitMediaType !== "video" ? inferTurnaround3dPackage(promptToUse) : null;
    const manualTurnaroundPackage = explicitMediaType !== "video" && agentType === "image" && image3dMode
      ? {
          imagePackageMode: 'turnaround3d' as const,
          turnaroundViews: detectedTurnaroundPackage?.turnaroundViews || BASE_TURNAROUND_VIEWS
        }
      : null;
    const turnaroundPackage = manualTurnaroundPackage || detectedTurnaroundPackage;
    let executionType: AgentType = explicitMediaType ?? agentType;
    if (explicitMediaType && explicitMediaType !== agentType) {
      setAgentType(explicitMediaType);
      appendLog(`[Flow] Tipo ajustado pelo pedido: ${explicitMediaType === "image" ? "Imagem" : "Vídeo"}.`);
    }
    if (turnaroundPackage) {
      executionType = "image";
      if (agentType !== "image") {
        setAgentType("image");
      }
      appendLog("[Flow] Pacote 3D detectado: imagem principal + vistas do produto.");
    }

    if (executionType === "project") {
      setProjectLoading(true);
      setProjectResult(null);
      setActiveJobId(null);
      setShowLogs(true);
      setLogs([]);
      appendLog(`[Agente Autonomo] Pensando antes de aplicar: "${promptToUse}"...`);
      try {
        const res = await fetch("/api/flow/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "plan-project",
            prompt: promptToUse,
            avatarId: selectedAvatarId,
            model: agentModel,
            aspectRatio: videoRatio,
            videoModel: videoModel
          })
        });
        const data = await res.json();
        if (data.success && data.plan) {
          const selectedAvatar = avatars.find((avatar) => avatar.id === selectedAvatarId);
          setPendingPlan({
            kind: "project",
            flow: data.plan.flow || "project",
            originalPrompt: promptToUse,
            prompt: data.plan.optimizedPrompt || promptToUse,
            explanation: data.plan.explanation || "Plano criado pelo agente.",
            model: agentModel,
            aspectRatio: videoRatio,
            mediaModel: videoModel,
            avatarId: selectedAvatarId,
            avatarName: selectedAvatar?.name,
            targetJobId: data.plan.targetJobId ?? null,
            strategy: data.plan.strategy,
            scriptOutline: data.plan.scriptOutline ?? null,
            creativeSteps: data.plan.creativeSteps,
            visualReferenceInstructions: data.plan.visualReferenceInstructions
          });
          setAgentResult(data.plan.optimizedPrompt || promptToUse);
          appendLog("[Agente Autonomo] Plano pronto. Aguardando aprovacao para executar.");
        } else {
          setProjectResult({ success: false, error: data.error || "Erro desconhecido" });
          appendLog(`[Agente Autônomo] Erro ao inicializar: ${data.error}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        appendLog(`[Agente Autônomo] Erro na requisição: ${errMsg}`);
      } finally {
        setProjectLoading(false);
      }
      return;
    }

    setAgentLoading(true);
    setAgentResult(null);
    appendLog(`[Agente MrChicken] Conectando ao ${agentModel.toUpperCase()} para otimização...`);

    let finalPrompt = promptToUse;
    let plannedFlow: PlannedFlow = executionType;
    let planExplanation = "O agente montou o plano. A geracao so comeca apos aprovacao.";
    let planStrategy: string | undefined;
    let planScriptOutline: string | null | undefined;
    let planCreativeSteps: string[] | undefined;
    let planVisualReferenceInstructions: string | undefined;

    try {
      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "plan-agent",
          model: agentModel,
          prompt: promptToUse,
        }),
      });
      const data = await res.json();
      const plan = data.plan || null;
      if (data.success && plan) {
        const agentFlow = plan.flow === "image" || plan.flow === "video" ? plan.flow : executionType;
        plannedFlow = agentFlow;
        finalPrompt = plan.optimizedPrompt || promptToUse;
        planExplanation = plan.strategy || plan.explanation || planExplanation;
        planStrategy = plan.strategy;
        planScriptOutline = plan.scriptOutline ?? null;
        planCreativeSteps = plan.creativeSteps;
        planVisualReferenceInstructions = plan.visualReferenceInstructions;
        setAgentResult(finalPrompt);
        appendLog(`[Agente MrChicken] Plano: ${planExplanation}`);
      } else {
        appendLog(`[Agente MrChicken] Usando prompt original (${data.error || "Otimização ignorada"}).`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`[Agente MrChicken] Erro na otimização: ${errMsg}. Usando original.`);
    } finally {
      setAgentLoading(false);
    }

    if (turnaroundPackage) {
      plannedFlow = "image";
      finalPrompt = [
        finalPrompt,
        "Create angle versions from the attached image for 3D character generation: each generated image must preserve the same character, camera distance, crop, clothes, face, style, lighting, and background, changing only the viewing angle."
      ].join(" ");
      planExplanation = "Pacote 3D: o agente vai pegar a imagem anexada e gerar a mesma imagem em outros angulos, sem recriar o personagem.";
      planStrategy = "Usar a imagem anexada como fonte exata e gerar uma chamada separada por angulo, mantendo distancia da camera, enquadramento, roupa, rosto, estilo e fundo.";
      planCreativeSteps = [
        "Usar a imagem anexada como fonte exata",
        "Gerar a mesma imagem em angulo frontal",
        "Gerar a mesma imagem em lateral esquerda",
        "Gerar a mesma imagem em lateral direita",
        "Gerar a mesma imagem de costas",
        ...(turnaroundPackage.turnaroundViews.includes("top") ? ["Gerar uma imagem de topo e uma imagem de base"] : [])
      ];
      planVisualReferenceInstructions = "Nao alterar caracteristicas: manter personagem, rosto, roupa, proporcoes, distancia da camera, crop, luz e fundo; mudar apenas o angulo.";
      setAgentResult(finalPrompt);
    }

    const selectedAvatar = avatars.find((avatar) => avatar.id === selectedAvatarId);
    const directFlow = plannedFlow === "image" || plannedFlow === "video" ? plannedFlow : executionType;
    setPendingPlan({
      kind: directFlow,
      flow: directFlow,
      originalPrompt: promptToUse,
      prompt: finalPrompt,
      explanation: planExplanation,
      model: agentModel,
      aspectRatio: directFlow === "image" ? imageRatio : videoRatio,
      quantity: turnaroundPackage ? "x4" : (directFlow === "image" ? imageQty : videoQty),
      mediaModel: directFlow === "image" ? imageModel : videoModel,
      avatarId: selectedAvatarId || undefined,
      avatarName: selectedAvatar?.name,
      referenceImage: directFlow === "image" || directFlow === "video" ? referenceImageToUse : null,
      strategy: planStrategy,
      scriptOutline: planScriptOutline ?? null,
      creativeSteps: planCreativeSteps,
      visualReferenceInstructions: planVisualReferenceInstructions,
      imagePackageMode: directFlow === "image" ? turnaroundPackage?.imagePackageMode : undefined,
      turnaroundViews: directFlow === "image" ? turnaroundPackage?.turnaroundViews : undefined
    });
    appendLog("[Agente MrChicken] Plano pronto. Aguardando aprovacao para gerar.");
  };

  const currentReference = agentType === 'project' ? null : (agentType === 'image' ? imageReference : videoReference);
  const hasResult = (agentType === 'project' && projectResult) ||
                    (agentType === 'image' && imageResult) ||
                    (agentType === 'video' && videoResult);
  const isLoading = agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId;



  const renderSettingsSummary = () => {
    if (agentType === 'image') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#B8B8C0" }}>
          <span>Imagem</span>
          <span style={{ color: "#4A4A54" }}>·</span>
          {image3dMode && (
            <>
              <span>3D</span>
              <span style={{ color: "#4A4A54" }}>·</span>
            </>
          )}
          <span>{imageRatio}</span>
        </span>
      );
    } else if (agentType === 'video') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#B8B8C0" }}>
          <span>Vídeo</span>
          <span style={{ color: "#4A4A54" }}>·</span>
          <span>{videoRatio}</span>
        </span>
      );
    } else {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#B8B8C0" }}>
          <span>Autopilot</span>
        </span>
      );
    }
  };

  return (
    <div
      className="relative isolate min-h-screen overflow-y-auto bg-[#080808] pb-48 pt-10 text-white select-none"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      {/* ── Background: Anime watermark ── */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          bottom: 0,
          width: "65%",
          minHeight: "100vh",
          zIndex: 1,
          backgroundImage: "url('/mrchicken-anime-bg.jpeg')",
          backgroundSize: "cover",
          backgroundPosition: "right 15% top",
          backgroundAttachment: "local",
          opacity: 0.25,
          mixBlendMode: "luminosity",
          maskImage: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.1) 10%, black 32%, black 78%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(90deg, transparent 0%, rgba(0,0,0,0.1) 10%, black 32%, black 78%, transparent 100%)",
          pointerEvents: "none",
        }}
      />
      {/* ── Background: Dark gradient overlay ── */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          minHeight: "100vh",
          zIndex: 0,
          background: "radial-gradient(ellipse 55% 50% at 82% 10%, rgba(157,124,255,0.065) 0%, transparent 100%), linear-gradient(180deg, rgba(8,8,8,0.30) 0%, rgba(8,8,8,0.72) 52%, #080808 100%)",
          pointerEvents: "none",
        }}
      />

      {/* ── Main Content ── */}
      <div className="relative mx-auto w-full max-w-[1200px] px-6 sm:px-8 lg:px-10" style={{ zIndex: 1 }}>

        {/* ── Hero Section ── */}
        <section
          className="animate-fade-in-up rounded-[32px] p-8 sm:p-10 lg:p-12"
          style={{
            background: "rgba(255,255,255,0.022)",
            border: "1px solid rgba(255,255,255,0.07)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <div className="flex flex-col gap-5">
            {/* Status badge */}
            <div
              className="inline-flex items-center gap-2 self-start rounded-full px-3 py-1.5 text-[11px] font-medium tracking-[0.03em]"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#B8B8C0",
              }}
            >
              <span
                className="animate-pulse-dot rounded-full"
                style={{ width: 6, height: 6, background: "#4ade80", flexShrink: 0, display: "inline-block" }}
              />
              AI workspace online
            </div>

            {/* Title + subtitle */}
            <div>
              <h1
                className="text-[38px] font-light leading-none text-white sm:text-[50px]"
                style={{ letterSpacing: "-0.02em", fontWeight: 300 }}
              >
                AgenteMrChicken
              </h1>
              <p
                className="mt-4 max-w-[460px] text-[15px] leading-relaxed"
                style={{ color: "#B8B8C0" }}
              >
                Seu ambiente de criação e automação inteligente.
              </p>
            </div>
          </div>
        </section>

        {/* ── Secondary Content: Recent Activity ── */}
        {!hasResult && !isLoading && (
          <div className="mt-5">

            {/* Recent Activity */}
            <div
              className="rounded-[32px] p-6"
              style={{
                background: "rgba(255,255,255,0.018)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(16px)",
              }}
            >
              <div className="mb-5 flex items-center justify-between">
                <span
                  className="text-[11px] font-semibold uppercase tracking-[0.12em]"
                  style={{ color: "#7B7B86" }}
                >
                  Atividade Recente
                </span>
                <a
                  href="/jobs"
                  className="text-[11px] font-medium transition-colors"
                  style={{ color: "#4A4A54" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "#B8B8C0"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = "#4A4A54"; }}
                >
                  Ver todos →
                </a>
              </div>
              <div className="space-y-3">
                {[
                  { label: "Nenhum projeto recente", sub: "Use a barra de comando abaixo para iniciar", icon: "◦" },
                  { label: "Pronto para gerar", sub: "Aguardando seu comando", icon: "◦" },
                ].map((row, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 rounded-[20px] px-3 py-3"
                    style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}
                  >
                    <span className="mt-0.5 text-[16px] leading-none" style={{ color: "#4A4A54" }}>
                      {row.icon}
                    </span>
                    <div>
                      <div className="text-[13px] font-medium text-white">{row.label}</div>
                      <div className="mt-0.5 text-[11px]" style={{ color: "#7B7B86" }}>{row.sub}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Loading State ── */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center gap-3 py-16">
            <Loader2
              className="animate-spin"
              size={22}
              style={{ color: "#9D7CFF", opacity: 0.65 }}
            />
            <div
              className="text-[12px] font-medium animate-pulse"
              style={{ color: "#B8B8C0" }}
            >
              {activeJobId
                ? "Agente processando em background..."
                : projectLoading
                ? "Inicializando agente..."
                : agentLoading
                ? "Otimizando ideia..."
                : imageLoading
                ? "Gerando imagem..."
                : "Gerando vídeo..."}
            </div>
            {logs.length > 0 && (
              <div
                className="max-w-xs truncate text-center text-[10px] font-mono"
                style={{ color: "#4A4A54" }}
              >
                {logs[logs.length - 1].replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "")}
              </div>
            )}
          </div>
        )}

        {/* ── Result: Autonomous Project ── */}
        {agentType === "project" && projectResult && (
          <div className="mx-auto mt-8 w-full max-w-3xl">
            <div
              className="mb-6 flex items-center gap-4 text-[11px]"
              style={{ color: "#4A4A54" }}
            >
              <span className="shrink-0 font-medium">Execução do Agente Autônomo</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>
            {projectResult.success ? (
              <div
                className="rounded-[28px] p-6 space-y-4 text-sm"
                style={{
                  background: "rgba(255,255,255,0.028)",
                  border: "1px solid rgba(255,255,255,0.07)",
                }}
              >
                <div className="flex items-center gap-2 font-semibold text-emerald-400 text-[13px]">
                  <CheckCircle size={15} />
                  <span>Agente Autônomo Iniciado</span>
                </div>
                <div className="space-y-2 text-[12px]" style={{ color: "#7B7B86" }}>
                  <div>
                    <strong className="text-white/80">Job ID:</strong>{" "}
                    <span className="font-mono">{projectResult.jobId}</span>
                  </div>
                  <div>
                    <strong className="text-white/80">Status:</strong>{" "}
                    {projectResult.videoPath ? "Concluído" : "Processando em segundo plano..."}
                  </div>
                </div>
                {projectResult.videoPath && (
                  <div className="space-y-2">
                    <strong
                      className="block text-[11px] uppercase tracking-[0.1em]"
                      style={{ color: "#7B7B86" }}
                    >
                      Resultado Gerado
                    </strong>
                    <div
                      className="aspect-video w-full overflow-hidden rounded-[20px]"
                      style={{ background: "#0a0a0a", border: "1px solid rgba(255,255,255,0.07)" }}
                    >
                      {/\.(png|jpe?g|webp)$/i.test(projectResult.videoPath) || projectResult.videoPath.includes("image") ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={projectResult.videoPath.startsWith("http") ? projectResult.videoPath : `/api/flow/media?path=${encodeURIComponent(projectResult.videoPath)}`}
                          alt="Resultado do Agente"
                          className="h-full w-full object-contain"
                        />
                      ) : (
                        <video
                          src={projectResult.videoPath.startsWith("http") ? projectResult.videoPath : `/api/flow/media?path=${encodeURIComponent(projectResult.videoPath)}`}
                          controls
                          className="h-full w-full object-contain"
                        />
                      )}
                    </div>
                  </div>
                )}
                <div className="pt-2">
                  <a
                    href="/jobs"
                    className="inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold text-black transition-opacity hover:opacity-85"
                    style={{ background: "#ffffff" }}
                  >
                    <span>Ir para a Lista de Projetos</span>
                    <ArrowRight size={12} />
                  </a>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-rose-500">
                <AlertCircle size={14} />
                <span>Erro no projeto: {projectResult.error}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Result: Images / Videos ── */}
        {agentType !== "project" && ((agentType === "image" && imageResult) || (agentType === "video" && videoResult)) && (
          <div className="mx-auto mt-8 w-full max-w-3xl">
            <div
              className="mb-6 flex items-center gap-4 text-[11px]"
              style={{ color: "#4A4A54" }}
            >
              <span className="shrink-0 font-medium">Gerado agora</span>
              <div className="h-px flex-1" style={{ background: "rgba(255,255,255,0.06)" }} />
            </div>

            {agentType === "image" && imageResult && (
              <div>
                {imageResult.success ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {(imageResult.paths && imageResult.paths.length > 0 ? imageResult.paths : [imageResult.path]).map((p, idx) => (
                      <div
                        key={idx}
                        className="group relative aspect-square overflow-hidden rounded-[20px]"
                        style={{ background: "#111114" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/flow/media?path=${encodeURIComponent(p)}`}
                          alt={`Gerada ${idx + 1}`}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          <a
                            href={`/api/flow/media?path=${encodeURIComponent(p)}`}
                            download
                            className="flex items-center justify-center rounded-full p-2 text-white"
                            style={{ background: "rgba(16,16,20,0.85)", border: "1px solid rgba(255,255,255,0.08)" }}
                            title="Download"
                          >
                            <ArrowRight className="rotate-90" size={13} />
                          </a>
                          <button
                            onClick={() => { if (copyToClipboard(p)) appendLog("Caminho copiado."); }}
                            className="flex items-center justify-center rounded-full p-2 text-white cursor-pointer"
                            style={{ background: "rgba(16,16,20,0.85)", border: "1px solid rgba(255,255,255,0.08)" }}
                            title="Copiar caminho"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-rose-500">
                    <AlertCircle size={14} />
                    <span>Erro: {imageResult.error}</span>
                  </div>
                )}
              </div>
            )}

            {agentType === "video" && videoResult && (
              <div>
                {videoResult.success ? (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {(videoResult.paths && videoResult.paths.length > 0 ? videoResult.paths : [videoResult.path]).map((p, idx) => (
                      <div
                        key={idx}
                        className="group relative aspect-video overflow-hidden rounded-[20px]"
                        style={{ background: "#111114" }}
                      >
                        <video
                          src={`/api/flow/media?path=${encodeURIComponent(p)}`}
                          controls
                          className="h-full w-full object-contain"
                        />
                        <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                          <button
                            onClick={() => { if (copyToClipboard(p)) appendLog("Caminho do vídeo copiado."); }}
                            className="flex items-center justify-center rounded-full p-1.5 text-white cursor-pointer"
                            style={{ background: "rgba(16,16,20,0.88)", border: "1px solid rgba(255,255,255,0.08)" }}
                            title="Copiar caminho"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2 py-4 text-[12px] text-rose-500">
                    <AlertCircle size={14} />
                    <span>Erro: {videoResult.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════
          FLOATING INPUT BAR — Fixed bottom
          ═══════════════════════════════════════ */}
      <div
        className="pointer-events-none fixed bottom-5 left-0 right-0 z-40 flex flex-col items-center gap-3 px-4 md:left-[248px]"
        style={{ zIndex: 40 }}
      >
        {/* Reference image preview */}
        {currentReference && (
          <div className="pointer-events-auto w-full max-w-[900px]">
            <div
              className="inline-flex items-center gap-2 rounded-[24px] p-1.5 pr-3"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(16px)",
              }}
            >
              <div className="h-8 w-8 overflow-hidden rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={currentReference} alt="Referência" className="h-full w-full object-cover" />
              </div>
              <span className="font-mono text-[10px]" style={{ color: "#7B7B86" }}>Imagem de ref.</span>
              <button
                type="button"
                onClick={handleRemoveReference}
                className="p-1 cursor-pointer transition-colors"
                style={{ color: "#7B7B86" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#ef4444"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#7B7B86"; }}
              >
                <Trash2 size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Pending approval plan */}
        {pendingPlan && (
          <div className="pointer-events-auto w-full max-w-[900px]">
            <div
              className="rounded-[24px] p-4 text-left"
              style={{
                background: "rgba(12,12,16,0.96)",
                border: "1px solid rgba(157,124,255,0.28)",
                backdropFilter: "blur(20px)",
              }}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#9D7CFF" }}>
                    Plano aguardando aprovacao
                  </div>
                  <div className="mt-1 text-[12px]" style={{ color: "#B8B8C0" }}>
                    O agente ainda nao executou nada.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPendingPlan(null);
                      appendLog("Plano cancelado.");
                    }}
                    className="rounded-full px-3 py-2 text-[11px] font-semibold"
                    style={{
                      background: "rgba(255,255,255,0.04)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      color: "#B8B8C0",
                    }}
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleApplyPlan}
                    disabled={agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId}
                    className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[11px] font-semibold disabled:opacity-40"
                    style={{
                      background: "#ffffff",
                      color: "#080808",
                    }}
                  >
                    <Check size={12} />
                    Aplicar
                  </button>
                </div>
              </div>

              <div className="grid gap-2 text-[11px] sm:grid-cols-2" style={{ color: "#7B7B86" }}>
                <div>Tipo: <span style={{ color: "#E8E8EF" }}>{pendingPlan.flow}</span></div>
                <div>Modelo: <span style={{ color: "#E8E8EF" }}>{pendingPlan.mediaModel || pendingPlan.model}</span></div>
                <div>Proporcao: <span style={{ color: "#E8E8EF" }}>{pendingPlan.aspectRatio}</span></div>
                {pendingPlan.quantity && (
                  <div>Quantidade: <span style={{ color: "#E8E8EF" }}>{pendingPlan.quantity}</span></div>
                )}
                {pendingPlan.imagePackageMode === "turnaround3d" && (
                  <div>Pacote: <span style={{ color: "#E8E8EF" }}>Turnaround 3D, 1 imagem por angulo</span></div>
                )}
                {pendingPlan.turnaroundViews && pendingPlan.turnaroundViews.length > 0 && (
                  <div>Vistas: <span style={{ color: "#E8E8EF" }}>{pendingPlan.turnaroundViews.join(", ")}</span></div>
                )}
                {pendingPlan.avatarName && (
                  <div>Avatar: <span style={{ color: "#E8E8EF" }}>{pendingPlan.avatarName}</span></div>
                )}
              </div>

              <div
                className="mt-3 rounded-[16px] p-3 text-[11px] leading-relaxed"
                style={{
                  background: "rgba(255,255,255,0.035)",
                  color: "#B8B8C0",
                }}
              >
                <div className="mb-1 font-semibold" style={{ color: "#E8E8EF" }}>Prompt final</div>
                {pendingPlan.prompt}
              </div>

              <div className="mt-2 text-[11px]" style={{ color: "#7B7B86" }}>
                {pendingPlan.explanation}
              </div>
            </div>
          </div>
        )}

        {/* Optimized prompt suggestion */}
        {agentResult && !pendingPlan && (
          <div className="pointer-events-auto w-full max-w-[900px]">
            <div
              className="inline-flex max-w-xl items-center gap-2 rounded-[24px] px-3 py-2 text-[11px]"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(16px)",
                color: "#7B7B86",
              }}
            >
              <span className="flex-1 truncate italic">*Otimizado:* &quot;{agentResult}&quot;</span>
              <button
                type="button"
                onClick={() => { if (copyToClipboard(agentResult)) appendLog("Prompt copiado."); }}
                className="shrink-0 p-0.5 cursor-pointer transition-colors"
                style={{ color: "#7B7B86" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#ffffff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "#7B7B86"; }}
                title="Copiar prompt"
              >
                <Copy size={11} />
              </button>
            </div>
          </div>
        )}

        {/* Logs panel */}
        {showLogs && (
          <div
            className="pointer-events-auto w-full max-w-[900px] overflow-y-auto rounded-[24px] p-4 font-mono text-[11px] space-y-1.5 text-left"
            style={{
              height: 176,
              background: "rgba(10,10,14,0.94)",
              border: "1px solid rgba(255,255,255,0.07)",
              backdropFilter: "blur(20px)",
              color: "#4A4A54",
            }}
          >
            {logs.length === 0 ? (
              <span className="italic">Nenhum evento registrado.</span>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="leading-relaxed break-all">{log}</div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        )}

        {/* Logs toggle */}
        <div className="pointer-events-auto">
          <button
            type="button"
            onClick={() => setShowLogs(!showLogs)}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5 font-mono text-[9px] uppercase tracking-wider cursor-pointer"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.07)",
              color: "#4A4A54",
              backdropFilter: "blur(12px)",
              transition: "color 150ms ease-out",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "#B8B8C0"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "#4A4A54"; }}
          >
            <Terminal size={10} />
            <span>{showLogs ? "Esconder logs" : "Ver logs"}</span>
          </button>
        </div>

        {/* ── Claude Chat Input ── */}
        <div className="relative w-full max-w-[900px] pointer-events-auto overflow-visible" ref={popoverRef}>
          <ClaudeChatInput
            disabled={isLoading}
            placeholder={agentType === "image" && image3dMode ? "Anexe uma imagem e envie para gerar o 3D" : "O que você quer criar hoje?"}
            models={[
              { id: "gemini", name: "Gemini", description: "Google Gemini Model" },
              { id: "chatgpt", name: "ChatGPT", description: "OpenAI ChatGPT Model" },
              { id: "deepseek", name: "DeepSeek", description: "DeepSeek Model" },
              { id: "claude", name: "Claude", description: "Anthropic Claude Model" },
              { id: "cerebras", name: "Cerebras", description: "Cerebras Fast Inference Model" },
              { id: "zenmux", name: "ZenMux", description: "ZenMux Grok API" }
            ]}
            defaultModel={agentModel}
            onModelChange={(modelId) => {
              clearPendingPlan();
              if (modelId === "gemini" || modelId === "chatgpt" || modelId === "deepseek" || modelId === "claude" || modelId === "cerebras" || modelId === "zenmux") {
                setAgentModel(modelId);
              }
            }}
            onSendMessage={async (message, files, pastedContent) => {
              setAgentPrompt(message);
              clearPendingPlan();
              let uploadedReference: string | null = null;

              // If there are files, convert to data url and set as reference
              if (files.length > 0) {
                const file = files[0].file;
                uploadedReference = await new Promise<string | null>((resolve) => {
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    resolve(typeof event.target?.result === "string" ? event.target.result : null);
                  };
                  reader.onerror = () => resolve(null);
                  reader.readAsDataURL(file);
                });

                if (uploadedReference) {
                  if (agentType === "image") {
                    setImageReference(uploadedReference);
                  } else {
                    setVideoReference(uploadedReference);
                  }
                  appendLog(`Imagem de referÃªncia selecionada (${(file.size / 1024).toFixed(1)} KB).`);
                }
                if (!uploadedReference) {
                const reader = new FileReader();
                reader.onload = (event) => {
                  if (typeof event.target?.result === "string") {
                    if (agentType === "image") {
                      setImageReference(event.target.result);
                      appendLog(`Imagem de referência selecionada (${(file.size / 1024).toFixed(1)} KB).`);
                    } else {
                      setVideoReference(event.target.result);
                      appendLog(`Imagem de referência selecionada (${(file.size / 1024).toFixed(1)} KB).`);
                    }
                  }
                };
                reader.readAsDataURL(file);
                }
              }

              // Also if there is pasted content, append it to the message
              if (pastedContent.length > 0) {
                let fullMessage = message;
                pastedContent.forEach((p) => {
                  fullMessage += "\n\n[Pasted Content]:\n" + p.content;
                });
                setAgentPrompt(fullMessage);
                handleExecuteAutopilot(fullMessage, uploadedReference);
              } else {
                handleExecuteAutopilot(message, uploadedReference);
              }
            }}
            onOptionsClick={() => {
              setShowSettings(!showSettings);
            }}
            showOptions={showSettings}
            optionsContent={
              <div
                className="absolute bottom-full left-0 z-50 mb-3 flex w-[332px] max-w-[calc(100vw-32px)] flex-col gap-5 rounded-[28px] p-5 pointer-events-auto"
                style={{
                  background: "rgba(12,12,16,0.97)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(24px)",
                  WebkitBackdropFilter: "blur(24px)",
                }}
              >
                {/* Generation type */}
                <div className="flex flex-col gap-2">
                  <div className="px-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4A4A54" }}>
                    Tipo de Geração
                  </div>
                  <div
                    className="grid grid-cols-3 rounded-[14px] p-0.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {[
                      { id: "image", label: "Imagem", icon: <ImageIcon size={10} /> },
                      { id: "video", label: "Vídeo", icon: <Film size={10} /> },
                      { id: "project", label: "Autopilot", icon: <Cpu size={10} /> },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          clearPendingPlan();
                          setAgentType(t.id as AgentType);
                        }}
                        className="flex items-center justify-center gap-1.5 rounded-xl py-1.5 text-[10px] font-semibold transition-all"
                        style={{
                          background: agentType === t.id ? "rgba(255,255,255,0.1)" : "transparent",
                          color: agentType === t.id ? "#ffffff" : "#4A4A54",
                        }}
                      >
                        {t.icon}
                        <span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Model / Avatar */}
                <div className="flex flex-col gap-2">
                  <div className="px-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4A4A54" }}>
                    {agentType === "project" ? "Avatar do Agente" : "Modelo"}
                  </div>
                  <div
                    className="flex max-h-[112px] flex-col gap-0.5 overflow-y-auto rounded-[14px] p-1.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {agentType === "image" && [
                      { id: "Nano Banana 2", name: "Nano Banana 2" },
                      { id: "Nano Banana Pro", name: "Nano Banana Pro" },
                      { id: "Imagen 4 (Leaving 6/16)", name: "Imagen 4" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          clearPendingPlan();
                          setImageModel(m.id);
                        }}
                        className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[11px] transition-colors"
                        style={{
                          background: imageModel === m.id ? "rgba(255,255,255,0.08)" : "transparent",
                          color: imageModel === m.id ? "#ffffff" : "#7B7B86",
                          fontWeight: imageModel === m.id ? 600 : 400,
                        }}
                      >
                        <Sparkles size={10} style={{ color: "#4A4A54", flexShrink: 0 }} />
                        <span>{m.name}</span>
                        {imageModel === m.id && <Check size={10} className="ml-auto" style={{ color: "#9D7CFF" }} />}
                      </button>
                    ))}
                    {agentType === "video" && [
                      { id: "Veo 3.1", name: "Veo 3.1" },
                      { id: "Veo", name: "Veo Legacy" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          clearPendingPlan();
                          setVideoModel(m.id);
                        }}
                        className="flex items-center gap-2 rounded-xl px-3 py-1.5 text-left text-[11px] transition-colors"
                        style={{
                          background: videoModel === m.id ? "rgba(255,255,255,0.08)" : "transparent",
                          color: videoModel === m.id ? "#ffffff" : "#7B7B86",
                          fontWeight: videoModel === m.id ? 600 : 400,
                        }}
                      >
                        <Film size={10} style={{ color: "#4A4A54", flexShrink: 0 }} />
                        <span>{m.name}</span>
                        {videoModel === m.id && <Check size={10} className="ml-auto" style={{ color: "#9D7CFF" }} />}
                      </button>
                    ))}
                    {agentType === "project" && (
                      avatars.length > 0 ? avatars.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            clearPendingPlan();
                            setSelectedAvatarId(a.id);
                          }}
                          className="flex items-center gap-2 rounded-[16px] px-3 py-1.5 text-left text-[11px] transition-colors"
                          style={{
                            background: selectedAvatarId === a.id ? "rgba(255,255,255,0.08)" : "transparent",
                            color: selectedAvatarId === a.id ? "#ffffff" : "#7B7B86",
                          }}
                        >
                          <User size={10} style={{ color: "#4A4A54", flexShrink: 0 }} />
                          <span>{a.name}</span>
                          {selectedAvatarId === a.id && <Check size={10} className="ml-auto" style={{ color: "#9D7CFF" }} />}
                        </button>
                      )) : (
                        <span className="px-3 py-1.5 text-[11px] italic" style={{ color: "#4A4A54" }}>Nenhum avatar</span>
                      )
                    )}
                  </div>
                </div>

                {/* Image mode */}
                {agentType === "image" && (
                  <div className="flex flex-col gap-2">
                    <div className="px-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4A4A54" }}>
                      Modo da Imagem
                    </div>
                    <div
                      className="grid grid-cols-2 rounded-[14px] p-0.5"
                      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                    >
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
                              clearPendingPlan();
                              const nextIs3d = mode.id === "turnaround3d";
                              setImage3dMode(nextIs3d);
                              if (nextIs3d) setImageQty("x4");
                            }}
                            className="rounded-xl py-1.5 text-[10px] font-semibold transition-all"
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

                {/* Ratio + Quantity */}
                {agentType !== "project" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="px-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4A4A54" }}>Proporção</div>
                      <div
                        className="grid grid-cols-2 gap-1 rounded-[14px] p-1.5"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        {["16:9", "4:3", "1:1", "3:4", "9:16"].map((r) => {
                          const currentRatio = agentType === "image" ? imageRatio : videoRatio;
                          const isActive = currentRatio === r;
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => {
                                clearPendingPlan();
                                if (agentType === "image") setImageRatio(r);
                                else setVideoRatio(r);
                              }}
                              className="rounded-xl py-1 font-mono text-[10px] transition-all"
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
                      <div className="px-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4A4A54" }}>Quantidade</div>
                      <div
                        className="grid grid-cols-2 gap-1 rounded-[14px] p-1.5"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
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
                                clearPendingPlan();
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
                    </div>
                  </div>
                )}

                {/* LLM Optimizer */}
                <div
                  className="flex flex-col gap-2 pt-3"
                  style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <div className="px-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4A4A54" }}>
                    Otimizador (LLM)
                  </div>
                  <div
                    className="grid grid-cols-5 gap-0.5 rounded-[14px] p-0.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {(["gemini", "chatgpt", "deepseek", "claude", "cerebras", "zenmux"] as const).map((m) => {
                      const isActive = agentModel === m;
                      const label = m === "chatgpt" ? "GPT" : m === "deepseek" ? "Deep" : m === "gemini" ? "Gemini" : m === "claude" ? "Claude" : "Cere";
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            clearPendingPlan();
                            setAgentModel(m);
                          }}
                          className="rounded-xl py-1.5 text-[9px] font-bold tracking-wide transition-all"
                          style={{
                            background: isActive ? "rgba(255,255,255,0.1)" : "transparent",
                            color: isActive ? "#ffffff" : "#4A4A54",
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
