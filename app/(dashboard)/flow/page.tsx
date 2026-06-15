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
  Check,
  Plus,
  BookOpen,
  BarChart3,
  ChevronRight
} from "lucide-react";



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

export default function FlowDashboardPage() {

  // 2. Control States
  const [agentModel, setAgentModel] = useState<'deepseek' | 'claude' | 'chatgpt' | 'gemini'>('gemini');
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentType, setAgentType] = useState<AgentType>('image');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResult, setAgentResult] = useState<string | null>(null);

  // Avatar and Agent Project States
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [selectedAvatarId, setSelectedAvatarId] = useState("");
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectResult, setProjectResult] = useState<{ success: boolean; jobId?: string; videoPath?: string; error?: string } | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  // 3. ImageFX States
  const [imageRatio, setImageRatio] = useState("16:9");
  const [imageQty, setImageQty] = useState("x2");
  const [imageModel, setImageModel] = useState("Nano Banana 2");
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
                  setProjectResult({
                    success: true,
                    jobId: activeJobId,
                    videoPath: job.final_video_path || undefined
                  });
                } else {
                  setProjectResult({
                    success: false,
                    error: job.error_message || "O agente falhou na execução."
                  });
                }
              }
            }
          } catch (jobErr) {
            console.error("Erro ao buscar detalhes do job finalizado:", jobErr);
          }
          setActiveJobId(null);
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
  }, [activeJobId]);

  // Upload Reference Image Handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, setRef: (val: string | null) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
    if (agentType === 'image') {
      setImageReference(null);
    } else {
      setVideoReference(null);
    }
    appendLog("Imagem de referência removida.");
  };

  // Main Autopilot Execution
  const handleExecuteAutopilot = async () => {
    if (!agentPrompt.trim()) {
      appendLog("Aviso: Digite uma ideia para começar.");
      return;
    }

    const explicitMediaType = inferExplicitMediaType(agentPrompt);
    const executionType: AgentType = explicitMediaType ?? agentType;
    if (explicitMediaType && explicitMediaType !== agentType) {
      setAgentType(explicitMediaType);
      appendLog(`[Flow] Tipo ajustado pelo pedido: ${explicitMediaType === "image" ? "Imagem" : "Vídeo"}.`);
    }

    if (executionType === "project") {
      setProjectLoading(true);
      setProjectResult(null);
      setActiveJobId(null);
      setShowLogs(true);
      setLogs([]);
      appendLog(`[Agente Autônomo] Solicitando criação do projeto para o tema: "${agentPrompt}"...`);
      try {
        const res = await fetch("/api/flow/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create-project",
            prompt: agentPrompt,
            avatarId: selectedAvatarId,
            model: agentModel,
            aspectRatio: videoRatio,
            videoModel: videoModel
          })
        });
        const data = await res.json();
        if (data.success && data.jobId) {
          setProjectResult(data);
          setActiveJobId(data.jobId);
          appendLog(`[Agente Autônomo] Projeto inicializado com sucesso! Job ID: ${data.jobId}`);
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

    let finalPrompt = agentPrompt;

    try {
      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: agentModel,
          prompt: agentPrompt,
          type: executionType,
        }),
      });
      const data = await res.json();
      if (data.success && data.prompt) {
        finalPrompt = data.prompt;
        setAgentResult(data.prompt);
        appendLog(`[Agente MrChicken] Ideia otimizada: "${finalPrompt}"`);
      } else {
        appendLog(`[Agente MrChicken] Usando prompt original (${data.error || "Otimização ignorada"}).`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`[Agente MrChicken] Erro na otimização: ${errMsg}. Usando original.`);
    } finally {
      setAgentLoading(false);
    }

    if (executionType === "image") {
      setImageLoading(true);
      setImageResult(null);
      appendLog(`[ImageFX] Gerando imagens...`);
      try {
        const res = await fetch("/api/flow/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "image",
            prompt: finalPrompt,
            aspectRatio: imageRatio,
            quantity: imageQty,
            model: imageModel,
            referenceImage: imageReference || undefined,
          }),
        });
        const data: GenerationResult = await res.json();
        if (data.success) {
          setImageResult(data);
          appendLog(`[ImageFX] Imagens geradas com sucesso.`);
        } else {
          setImageResult({
            success: false,
            path: "",
            filename: "",
            createdAt: new Date().toISOString(),
            error: data.error || "Erro na geração",
          });
          appendLog(`[ImageFX] Falha: ${data.error}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        appendLog(`[ImageFX] Erro: ${errMsg}`);
      } finally {
        setImageLoading(false);
      }
    } else {
      setVideoLoading(true);
      setVideoResult(null);
      appendLog(`[VideoFX] Gerando vídeo...`);
      try {
        const res = await fetch("/api/flow/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "video",
            prompt: finalPrompt,
            aspectRatio: videoRatio,
            quantity: videoQty,
            model: videoModel,
            referenceImage: videoReference || undefined,
          }),
        });
        const data: GenerationResult = await res.json();
        if (data.success) {
          setVideoResult(data);
          appendLog(`[VideoFX] Vídeo gerado com sucesso.`);
        } else {
          setVideoResult({
            success: false,
            path: "",
            filename: "",
            createdAt: new Date().toISOString(),
            error: data.error || "Erro na geração",
          });
          appendLog(`[VideoFX] Falha: ${data.error}`);
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        appendLog(`[VideoFX] Erro: ${errMsg}`);
      } finally {
        setVideoLoading(false);
      }
    }
  };

  const currentReference = agentType === 'project' ? null : (agentType === 'image' ? imageReference : videoReference);
  const hasResult = (agentType === 'project' && projectResult) ||
                    (agentType === 'image' && imageResult) ||
                    (agentType === 'video' && videoResult);
  const isLoading = agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId;

  const quickActions = [
    {
      title: "Novo Projeto",
      description: "Inicie um fluxo autônomo",
      icon: Plus,
      action: () => setAgentType("project")
    },
    {
      title: "Explorar Agentes",
      description: "Gere imagem ou vídeo",
      icon: Sparkles,
      action: () => setAgentType("image")
    },
    {
      title: "Minha Biblioteca",
      description: "Acesse seus recursos",
      icon: BookOpen,
      action: () => { window.location.href = "#library"; }
    },
    {
      title: "Ver Analytics",
      description: "Acompanhe o desempenho",
      icon: BarChart3,
      action: () => { window.location.href = "#analytics"; }
    }
  ];

  const renderSettingsSummary = () => {
    if (agentType === 'image') {
      return (
        <span className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: "#B8B8C0" }}>
          <span>Imagem</span>
          <span style={{ color: "#4A4A54" }}>·</span>
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
          zIndex: 0,
          backgroundImage: "url('/mrchicken-anime-bg.jpeg')",
          backgroundSize: "cover",
          backgroundPosition: "right 15% top",
          backgroundAttachment: "local",
          opacity: 0.11,
          mixBlendMode: "soft-light",
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
          className="animate-fade-in-up rounded-[20px] p-8 sm:p-10 lg:p-12"
          style={{
            background: "rgba(255,255,255,0.022)",
            border: "1px solid rgba(255,255,255,0.07)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
          }}
        >
          <header className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
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

            {/* Status indicator card */}
            <div
              className="shrink-0 self-start rounded-2xl px-4 py-3"
              style={{
                background: "rgba(255,255,255,0.022)",
                border: "1px solid rgba(255,255,255,0.07)",
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
                minWidth: 158,
              }}
            >
              <span
                className="block text-[10px] font-semibold uppercase tracking-[0.18em]"
                style={{ color: "#7B7B86" }}
              >
                Status
              </span>
              <span className="mt-2 flex items-center gap-2 text-[13px] font-medium text-white">
                <span
                  className="rounded-full"
                  style={{ width: 7, height: 7, background: "#4ade80", flexShrink: 0, display: "inline-block" }}
                />
                Pronto para gerar
              </span>
            </div>
          </header>

          {/* ── Quick Action Cards ── */}
          {!hasResult && !isLoading && (
            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {quickActions.map((item, idx) => {
                const Icon = item.icon;
                const staggerClass = `card-stagger-${idx + 1}`;
                return (
                  <button
                    key={item.title}
                    type="button"
                    onClick={item.action}
                    className={`group glass-card ${staggerClass} flex min-h-[132px] flex-col items-start p-5 text-left w-full`}
                  >
                    {/* Icon */}
                    <span
                      className="flex h-10 w-10 items-center justify-center rounded-[14px]"
                      style={{
                        background: "rgba(157,124,255,0.09)",
                        border: "1px solid rgba(157,124,255,0.18)",
                        color: "#9D7CFF",
                      }}
                    >
                      <Icon size={18} />
                    </span>

                    {/* Title + desc + arrow */}
                    <span className="mt-auto flex w-full items-end justify-between gap-2 pt-5">
                      <span>
                        <span className="block text-[14px] font-semibold leading-tight text-white">
                          {item.title}
                        </span>
                        <span
                          className="mt-1 block text-[12px] leading-snug"
                          style={{ color: "#7B7B86" }}
                        >
                          {item.description}
                        </span>
                      </span>
                      <ChevronRight
                        size={15}
                        style={{
                          color: "#4A4A54",
                          flexShrink: 0,
                          transition: "color 200ms ease-out, transform 200ms ease-out",
                        }}
                        className="group-hover:text-[#9D7CFF] group-hover:translate-x-0.5"
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Secondary Content: Recent Activity + Capabilities ── */}
        {!hasResult && !isLoading && (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_320px]">

            {/* Recent Activity */}
            <div
              className="rounded-[20px] p-6"
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
                  { label: "Nenhum projeto recente", sub: "Crie seu primeiro projeto acima", icon: "◦" },
                  { label: "Pronto para gerar", sub: "Aguardando seu comando", icon: "◦" },
                ].map((row, idx) => (
                  <div
                    key={idx}
                    className="flex items-start gap-3 rounded-xl px-3 py-3"
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

            {/* Capabilities */}
            <div
              className="rounded-[20px] p-6"
              style={{
                background: "rgba(255,255,255,0.018)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(16px)",
              }}
            >
              <span
                className="mb-5 block text-[11px] font-semibold uppercase tracking-[0.12em]"
                style={{ color: "#7B7B86" }}
              >
                Capacidades
              </span>
              <div className="flex flex-wrap gap-2">
                {[
                  "Geração de Imagens",
                  "Geração de Vídeos",
                  "Agente Autônomo",
                  "Otimização de Prompts",
                  "Multi-LLM",
                  "Veo 3.1",
                  "Imagen 4",
                  "Referência de Imagem",
                ].map((cap) => (
                  <span
                    key={cap}
                    className="rounded-full px-3 py-1.5 text-[11px] font-medium"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.07)",
                      color: "#B8B8C0",
                    }}
                  >
                    {cap}
                  </span>
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
                className="rounded-[16px] p-6 space-y-4 text-sm"
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
                      className="aspect-video w-full overflow-hidden rounded-[12px]"
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
                        className="group relative aspect-square overflow-hidden rounded-[14px]"
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
                        className="group relative aspect-video overflow-hidden rounded-[14px]"
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
              className="inline-flex items-center gap-2 rounded-2xl p-1.5 pr-3"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(16px)",
              }}
            >
              <div className="h-8 w-8 overflow-hidden rounded-lg" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
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

        {/* Optimized prompt suggestion */}
        {agentResult && (
          <div className="pointer-events-auto w-full max-w-[900px]">
            <div
              className="inline-flex max-w-xl items-center gap-2 rounded-2xl px-3 py-2 text-[11px]"
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
            className="pointer-events-auto w-full max-w-[900px] overflow-y-auto rounded-[16px] p-4 font-mono text-[11px] space-y-1.5 text-left"
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

        {/* ── Main Input Pill ── */}
        <div
          className="liquid-input pointer-events-auto relative flex w-full max-w-[900px] flex-wrap items-center gap-3 overflow-visible p-3 pl-5 sm:flex-nowrap"
          style={{ minHeight: 88 }}
          ref={popoverRef}
        >
          {/* Text input */}
          <input
            type="text"
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !agentLoading && !imageLoading && !videoLoading && !projectLoading && !activeJobId && agentPrompt.trim()) {
                handleExecuteAutopilot();
              }
            }}
            placeholder="O que você quer criar hoje?"
            className="min-w-0 flex-1 basis-full border-none bg-transparent px-2 py-4 text-[15px] text-white outline-none placeholder:text-[#7B7B86] sm:basis-auto"
            style={{ caretColor: "#9D7CFF" }}
            disabled={agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId}
          />

          {/* Attachment button */}
          {agentType !== "project" && (
            <label
              className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full"
              style={{ border: "1px solid rgba(255,255,255,0.08)", color: "#7B7B86", transition: "color 200ms, background 200ms" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#B8B8C0"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "#7B7B86"; }}
            >
              <ImageIcon size={15} />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (agentType === "image") {
                    handleFileChange(e, setImageReference);
                  } else {
                    handleFileChange(e, setVideoReference);
                  }
                }}
              />
            </label>
          )}

          {/* Settings button + popover */}
          <div className="relative shrink-0 overflow-visible">
            <button
              type="button"
              onClick={() => setShowSettings(!showSettings)}
              className="flex cursor-pointer items-center gap-2 rounded-full px-3 py-2 text-[11px] font-medium"
              style={{
                background: showSettings ? "#ffffff" : "rgba(255,255,255,0.035)",
                color: showSettings ? "#080808" : "#B8B8C0",
                border: showSettings ? "1px solid #ffffff" : "1px solid rgba(255,255,255,0.08)",
                transition: "all 200ms ease-out",
              }}
            >
              <Sliders size={11} style={{ color: showSettings ? "#080808" : "#7B7B86" }} />
              {renderSettingsSummary()}
            </button>

            {/* Settings Popover */}
            {showSettings && (
              <div
                className="absolute bottom-full right-0 z-50 mb-3 flex w-[332px] max-w-[calc(100vw-32px)] flex-col gap-5 rounded-[20px] p-5 pointer-events-auto"
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
                    className="grid grid-cols-3 rounded-xl p-0.5"
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
                        onClick={() => setAgentType(t.id as AgentType)}
                        className="flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-[10px] font-semibold transition-all"
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
                    className="flex max-h-[112px] flex-col gap-0.5 overflow-y-auto rounded-xl p-1.5"
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
                        onClick={() => setImageModel(m.id)}
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] transition-colors"
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
                        onClick={() => setVideoModel(m.id)}
                        className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] transition-colors"
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
                          onClick={() => setSelectedAvatarId(a.id)}
                          className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-left text-[11px] transition-colors"
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

                {/* Ratio + Quantity */}
                {agentType !== "project" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-2">
                      <div className="px-1 text-[9px] font-bold uppercase tracking-widest" style={{ color: "#4A4A54" }}>Proporção</div>
                      <div
                        className="grid grid-cols-2 gap-1 rounded-xl p-1.5"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        {["16:9", "4:3", "1:1", "3:4", "9:16"].map((r) => {
                          const currentRatio = agentType === "image" ? imageRatio : videoRatio;
                          const isActive = currentRatio === r;
                          return (
                            <button
                              key={r}
                              type="button"
                              onClick={() => { if (agentType === "image") setImageRatio(r); else setVideoRatio(r); }}
                              className="rounded-lg py-1 font-mono text-[10px] transition-all"
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
                        className="grid grid-cols-2 gap-1 rounded-xl p-1.5"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                      >
                        {["1x", "x2", "x3", "x4"].map((q) => {
                          const currentQty = agentType === "image" ? imageQty : videoQty;
                          const isDisabled = agentType === "video" && (q === "x3" || q === "x4");
                          const isActive = currentQty === q && !isDisabled;
                          return (
                            <button
                              key={q}
                              type="button"
                              disabled={isDisabled}
                              onClick={() => {
                                if (agentType === "image") setImageQty(q);
                                else setVideoQty(q === "x3" || q === "x4" ? "x2" : q);
                              }}
                              className="rounded-lg py-1 font-mono text-[10px] transition-all"
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
                    className="grid grid-cols-4 gap-0.5 rounded-xl p-0.5"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
                  >
                    {(["gemini", "chatgpt", "deepseek", "claude"] as const).map((m) => {
                      const isActive = agentModel === m;
                      const label = m === "chatgpt" ? "GPT" : m === "deepseek" ? "Deep" : m === "gemini" ? "Gemini" : "Claude";
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setAgentModel(m)}
                          className="rounded-lg py-1.5 text-[9px] font-bold tracking-wide transition-all"
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
            )}
          </div>

          {/* Send button */}
          <button
            type="button"
            onClick={handleExecuteAutopilot}
            disabled={agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId || !agentPrompt.trim()}
            className="flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-white disabled:opacity-40"
            style={{ background: "#9D7CFF", transition: "background 200ms ease-out" }}
            onMouseEnter={(e) => { if (!e.currentTarget.disabled) e.currentTarget.style.background = "#B195FF"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#9D7CFF"; }}
          >
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
