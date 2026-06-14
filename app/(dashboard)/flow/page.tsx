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
  const [agentType, setAgentType] = useState<'image' | 'video' | 'project'>('image');
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
      mainEl.style.backgroundColor = '#0a0a0a';
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

  // Trigger avatar checks on load (using setTimeout to prevent cascading render error)
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

        // Check if the agent has finished (e.g. status completed or failed)
        const hasFinished = events.some((e: { event_type: string }) => e.event_type === "completed" || e.event_type === "failed");
        if (hasFinished) {
          // Fetch the final job details
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

    // Run immediately
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

  // Main Autopilot Execution: Optimize and Generate
  const handleExecuteAutopilot = async () => {
    if (!agentPrompt.trim()) {
      appendLog("Aviso: Digite uma ideia para começar.");
      return;
    }

    // Agent mode: Create Complete Video Project (autonomous loop)
    if (agentType === "project") {
      setProjectLoading(true);
      setProjectResult(null);
      setActiveJobId(null);
      setShowLogs(true);
      setLogs([]); // Clear logs for new run
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
          type: agentType,
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

    // Trigger specific generation type
    if (agentType === "image") {
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

  const renderSettingsSummary = () => {
    if (agentType === 'image') {
      return (
        <span className="flex items-center gap-1.5 font-semibold text-[11px] text-zinc-300">
          <ImageIcon size={12} className="text-zinc-400" />
          <span>Imagem</span>
          <span className="text-zinc-650">•</span>
          <span>{imageRatio}</span>
        </span>
      );
    } else if (agentType === 'video') {
      return (
        <span className="flex items-center gap-1.5 font-semibold text-[11px] text-zinc-300">
          <Film size={12} className="text-zinc-400" />
          <span>Vídeo</span>
          <span className="text-zinc-650">•</span>
          <span>{videoRatio}</span>
        </span>
      );
    } else {
      return (
        <span className="flex items-center gap-1.5 font-semibold text-[11px] text-zinc-300">
          <Cpu size={12} className="text-zinc-400" />
          <span>Autopilot</span>
        </span>
      );
    }
  };

  return (
    <div className="flex-1 w-full min-h-full flex flex-col justify-start px-8 py-10 pb-36 select-none overflow-y-auto" style={{ backgroundColor: '#0a0a0a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      


      {/* Estado Vazio Central */}
      {!hasResult && !isLoading && (
        <div className="flex-1 flex flex-col items-center justify-center py-20 select-none">
          {/* Pintinho Pixel Art em SVG */}
          <div className="w-16 h-16 mb-4 flex items-center justify-center animate-bounce">
            <svg
              width="64"
              height="64"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ imageRendering: "pixelated", shapeRendering: "crispEdges" }}
            >
              {/* Comb (Red) */}
              <rect x="7" y="1" width="2" height="2" fill="#EF4444" />
              <rect x="6" y="2" width="1" height="1" fill="#EF4444" />
              
              {/* Head & Body (Yellow) */}
              <rect x="5" y="4" width="6" height="8" fill="#FCD34D" />
              <rect x="4" y="5" width="8" height="6" fill="#FCD34D" />
              
              {/* Wings (Dark yellow / orange-yellow) */}
              <rect x="3" y="7" width="1" height="3" fill="#F59E0B" />
              <rect x="12" y="7" width="1" height="3" fill="#F59E0B" />
              <rect x="4" y="8" width="1" height="1" fill="#F59E0B" />
              <rect x="11" y="8" width="1" height="1" fill="#F59E0B" />

              {/* Eyes */}
              <rect x="8" y="5" width="1" height="2" fill="#000000" />
              <rect x="9" y="5" width="1" height="2" fill="#FFFFFF" />
              <rect x="8" y="5" width="1" height="1" fill="#FFFFFF" />

              {/* Beak (Orange) */}
              <rect x="9" y="7" width="3" height="2" fill="#F97316" />

              {/* Cheeks (Pink) */}
              <rect x="7" y="8" width="1" height="1" fill="#F472B6" />

              {/* Legs (Orange) */}
              <rect x="6" y="12" width="1" height="2" fill="#F97316" />
              <rect x="9" y="12" width="1" height="2" fill="#F97316" />
              <rect x="5" y="13" width="2" height="1" fill="#F97316" />
              <rect x="8" y="13" width="2" height="1" fill="#F97316" />
            </svg>
          </div>
          <p className="text-zinc-500 text-sm font-medium tracking-wide">
            Comece a criar ou adicione arquivos
          </p>
        </div>
      )}

      {/* Estado de Processamento Minimalista */}
      {(agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId) && (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 w-full max-w-md mx-auto mt-6">
          <Loader2 className="animate-spin text-white opacity-45" size={24} />
          <div className="text-xs font-semibold text-white/95 animate-pulse">
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
            <div className="text-[10px] text-zinc-500 font-mono text-center max-w-xs truncate">
              {logs[logs.length - 1].replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '')}
            </div>
          )}
        </div>
      )}

      {/* Resultados Inline: Projeto Autônomo */}
      {agentType === 'project' && projectResult && (
        <div className="w-full max-w-3xl mx-auto">
          <div className="flex items-center gap-4 w-full text-xs text-[#5A5A6A] mt-10 mb-6">
            <span className="shrink-0 font-medium">Execução do Agente Autônomo</span>
            <div className="h-[1px] bg-[rgba(255,255,255,0.07)] flex-1"></div>
          </div>
          {projectResult.success ? (
            <div className="bg-[#111114] border border-[rgba(255,255,255,0.07)] rounded-[10px] p-6 space-y-4 text-sm">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle size={16} />
                <span>Agente Autônomo Iniciado</span>
              </div>
              <div className="text-xs space-y-2 text-[#5A5A6A]">
                <div><strong className="text-[#F2F2F2]">Job ID:</strong> <span className="font-mono">{projectResult.jobId}</span></div>
                <div><strong className="text-[#F2F2F2]">Status:</strong> {projectResult.videoPath ? "Concluído" : "Processando em segundo plano..."}</div>
              </div>
              {projectResult.videoPath && (
                <div className="space-y-2">
                  <strong className="text-xs text-[#5A5A6A] block">Resultado Gerado:</strong>
                  <div className="aspect-video w-full rounded-[10px] overflow-hidden bg-black border border-[rgba(255,255,255,0.07)] flex items-center justify-center">
                    {/\.(png|jpe?g|webp)$/i.test(projectResult.videoPath) || projectResult.videoPath.includes("image") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={projectResult.videoPath.startsWith("http") ? projectResult.videoPath : `/api/flow/media?path=${encodeURIComponent(projectResult.videoPath)}`}
                        alt="Resultado do Agente"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <video
                        src={projectResult.videoPath.startsWith("http") ? projectResult.videoPath : `/api/flow/media?path=${encodeURIComponent(projectResult.videoPath)}`}
                        controls
                        className="w-full h-full object-contain"
                      />
                    )}
                  </div>
                </div>
              )}
              <div className="pt-2">
                <a
                  href="/jobs"
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-black bg-white px-4 py-2 rounded-full hover:opacity-90 transition-opacity"
                >
                  <span>Ir para a Lista de Projetos</span>
                  <ArrowRight size={12} />
                </a>
              </div>
            </div>
          ) : (
            <div className="text-rose-500 text-xs py-4 flex items-center gap-1.5 justify-center">
              <AlertCircle size={14} />
              <span>Erro no projeto do agente: {projectResult.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Resultados Inline: Imagens/Vídeos */}
      {agentType !== 'project' && ((agentType === 'image' && imageResult) || (agentType === 'video' && videoResult)) && (
        <div className="w-full max-w-3xl mx-auto">
          <div className="flex items-center gap-4 w-full text-xs text-[#5A5A6A] mt-10 mb-6">
            <span className="shrink-0 font-medium">Gerado agora</span>
            <div className="h-[1px] bg-[rgba(255,255,255,0.07)] flex-1"></div>
          </div>

          {/* Galeria Imagem */}
          {agentType === 'image' && imageResult && (
            <div>
              {imageResult.success ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {imageResult.paths && imageResult.paths.length > 0 ? (
                    imageResult.paths.map((p, idx) => (
                      <div key={idx} className="relative group aspect-square rounded-[10px] overflow-hidden bg-[#111114]">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/api/flow/media?path=${encodeURIComponent(p)}`}
                          alt={`Gerada ${idx + 1}`}
                          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                        />
                        {/* Ações secundárias em ícones pequenos */}
                        <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2">
                          <a
                            href={`/api/flow/media?path=${encodeURIComponent(p)}`}
                            download
                            className="p-1.5 bg-[#16161A] border border-[rgba(255,255,255,0.07)] rounded-full hover:bg-zinc-800 text-[#F2F2F2] transition-colors"
                            title="Download"
                          >
                            <ArrowRight className="rotate-90" size={13} />
                          </a>
                          <button
                            onClick={() => {
                              if (copyToClipboard(p)) {
                                appendLog("Caminho da imagem copiado.");
                              }
                            }}
                            className="p-1.5 bg-[#16161A] border border-[rgba(255,255,255,0.07)] rounded-full hover:bg-zinc-800 text-[#F2F2F2] transition-colors cursor-pointer"
                            title="Copiar caminho"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="relative group aspect-square rounded-[10px] overflow-hidden bg-[#111114]">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/flow/media?path=${encodeURIComponent(imageResult.path)}`}
                        alt="Gerada"
                        className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center justify-center gap-2">
                        <a
                          href={`/api/flow/media?path=${encodeURIComponent(imageResult.path)}`}
                          download
                          className="p-1.5 bg-[#16161A] border border-[rgba(255,255,255,0.07)] rounded-full hover:bg-zinc-800 text-[#F2F2F2] transition-colors"
                          title="Download"
                        >
                          <ArrowRight className="rotate-90" size={13} />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-rose-500 text-xs py-4 flex items-center gap-1.5 justify-center">
                  <AlertCircle size={14} />
                  <span>Erro na geração: {imageResult.error}</span>
                </div>
              )}
            </div>
          )}

          {/* Galeria Vídeo */}
          {agentType === 'video' && videoResult && (
            <div>
              {videoResult.success ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {videoResult.paths && videoResult.paths.length > 0 ? (
                    videoResult.paths.map((p, idx) => (
                      <div key={idx} className="relative group aspect-video rounded-[10px] overflow-hidden bg-[#111114] flex flex-col justify-between">
                        <video
                          src={`/api/flow/media?path=${encodeURIComponent(p)}`}
                          controls
                          className="w-full h-full object-contain"
                        />
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                          <button
                            onClick={() => {
                              if (copyToClipboard(p)) {
                                appendLog("Caminho do vídeo copiado.");
                              }
                            }}
                            className="p-1.5 bg-[#16161A] border border-[rgba(255,255,255,0.07)] rounded-full hover:bg-zinc-800 text-[#F2F2F2] cursor-pointer"
                            title="Copiar caminho"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="relative group aspect-video rounded-[10px] overflow-hidden bg-[#111114]">
                      <video
                        src={`/api/flow/media?path=${encodeURIComponent(videoResult.path)}`}
                        controls
                        className="w-full h-full object-contain"
                      />
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-rose-500 text-xs py-4 flex items-center gap-1.5 justify-center">
                  <AlertCircle size={14} />
                  <span>Erro na geração: {videoResult.error}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Rodapé Fixo com Input Bar e Controles flutuantes */}
      <div className="fixed bottom-6 left-0 right-0 md:left-[184px] flex flex-col items-center gap-3 px-6 z-45 pointer-events-none">
        
        {/* Reference Image preview floating above the input pill */}
        {currentReference && (
          <div className="w-full max-w-3xl flex justify-start pointer-events-auto">
            <div className="flex items-center gap-2 bg-[#141416]/95 border border-white/10 rounded-xl p-1.5 pr-3 shadow-lg backdrop-blur-md">
              <div className="w-8 h-8 rounded-lg overflow-hidden border border-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={currentReference} alt="Referência" className="w-full h-full object-cover" />
              </div>
              <span className="text-[10px] text-zinc-400 font-mono">Imagem de ref.</span>
              <button
                type="button"
                onClick={handleRemoveReference}
                className="text-zinc-500 hover:text-rose-500 transition-colors p-1"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Optimized prompt suggestion floating above input bar */}
        {agentResult && (
          <div className="w-full max-w-3xl flex justify-start pointer-events-auto">
            <div className="bg-[#141416]/95 border border-white/10 rounded-xl p-2 px-3 shadow-lg backdrop-blur-md text-[11px] text-zinc-400 max-w-xl flex items-center gap-2">
              <span className="italic truncate flex-1">
                *Otimizado:* &quot;{agentResult}&quot;
              </span>
              <button
                type="button"
                onClick={() => {
                  if (copyToClipboard(agentResult)) {
                    appendLog("Prompt otimizado copiado.");
                  }
                }}
                className="text-zinc-500 hover:text-white p-0.5 transition-colors shrink-0"
                title="Copiar prompt"
              >
                <Copy size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Logs container floating above the input pill */}
        {showLogs && (
          <div className="w-full max-w-2xl bg-[#111114]/90 border border-white/5 rounded-[12px] p-4 h-48 overflow-y-auto font-mono text-[11px] text-zinc-500 space-y-1.5 text-left scrollbar-thin scrollbar-thumb-zinc-800 backdrop-blur-md pointer-events-auto shadow-2xl">
            {logs.length === 0 ? (
              <span className="italic">Nenhum evento registrado.</span>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="leading-relaxed break-all">
                  {log}
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        )}

        {/* "VER LOGS" button */}
        <div className="pointer-events-auto">
          <button
            type="button"
            onClick={() => setShowLogs(!showLogs)}
            className="text-[9px] text-zinc-500 hover:text-zinc-300 transition-colors duration-150 flex items-center gap-1 cursor-pointer font-mono uppercase tracking-wider bg-[#0a0a0a]/80 px-2 py-1 rounded border border-white/5"
          >
            <Terminal size={10} />
            <span>{showLogs ? "Esconder logs" : "Ver logs"}</span>
          </button>
        </div>

        {/* Main Input Pill Bar */}
        <div className="w-full max-w-3xl bg-white/[0.06] border-[0.5px] border-white/10 rounded-[28px] p-2 pr-3 pl-4 flex items-center justify-between gap-3 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-md overflow-visible relative pointer-events-auto">
          {/* Campo de texto à esquerda */}
          <input
            type="text"
            value={agentPrompt}
            onChange={(e) => setAgentPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !agentLoading && !imageLoading && !videoLoading && !projectLoading && !activeJobId && agentPrompt.trim()) {
                handleExecuteAutopilot();
              }
            }}
            placeholder="O que você quer criar?"
            className="flex-1 bg-transparent border-none outline-none text-white placeholder-zinc-500 text-sm py-2 px-2 min-w-0"
            disabled={agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId}
          />

          {/* Attachment button next to input */}
          {agentType !== "project" && (
            <label className="text-zinc-500 hover:text-zinc-300 p-2 cursor-pointer transition-colors flex items-center justify-center shrink-0">
              <ImageIcon size={16} />
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (agentType === 'image') {
                    handleFileChange(e, setImageReference);
                  } else {
                    handleFileChange(e, setVideoReference);
                  }
                }}
              />
            </label>
          )}
          <div className="flex items-center gap-2 shrink-0 overflow-visible" ref={popoverRef}>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowSettings(!showSettings)}
                className={`px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all border flex items-center gap-1.5 cursor-pointer max-w-[190px] sm:max-w-[280px] md:max-w-none truncate ${showSettings ? 'bg-white text-black border-white shadow-md' : 'bg-white/[0.04] text-zinc-300 hover:text-white border-white/5 hover:bg-white/[0.08]'}`}
              >
                <Sliders size={12} className={showSettings ? 'text-black' : 'text-zinc-450'} />
                {renderSettingsSummary()}
              </button>

              {/* Painel Unificado de Configurações */}
              {showSettings && (
                <div className="absolute bottom-full mb-3 right-0 z-50 bg-[#121214]/98 border border-white/10 rounded-[20px] p-5 shadow-2xl backdrop-blur-md flex flex-col gap-5 w-[340px] pointer-events-auto">
                  {/* Tipo de Geração */}
                  <div className="flex flex-col gap-2">
                    <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest px-1">Tipo de Geração</div>
                    <div className="grid grid-cols-3 bg-zinc-950/80 p-0.5 rounded-xl border border-white/5">
                      <button
                        type="button"
                        onClick={() => { setAgentType('image'); }}
                        className={`py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${agentType === 'image' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white'}`}
                      >
                        <ImageIcon size={12} />
                        <span>Imagem</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAgentType('video'); }}
                        className={`py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${agentType === 'video' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white'}`}
                      >
                        <Film size={12} />
                        <span>Vídeo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAgentType('project'); }}
                        className={`py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${agentType === 'project' ? 'bg-white/10 text-white shadow-sm' : 'text-zinc-400 hover:text-white'}`}
                      >
                        <Cpu size={12} />
                        <span>Autopilot</span>
                      </button>
                    </div>
                  </div>

                  {/* Modelo & Estilo */}
                  <div className="flex flex-col gap-2">
                    <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest px-1">
                      {agentType === 'project' ? 'Avatar do Agente' : 'Modelo'}
                    </div>
                    <div className="grid grid-cols-1 gap-1 max-h-[120px] overflow-y-auto bg-zinc-950/80 p-1.5 rounded-xl border border-white/5 scrollbar-thin scrollbar-thumb-zinc-800">
                      {agentType === 'image' && (
                        <>
                          {[
                            { id: "Nano Banana 2", name: "Nano Banana 2", icon: <Sparkles size={12} /> },
                            { id: "Nano Banana Pro", name: "Nano Banana Pro", icon: <Sparkles size={12} /> },
                            { id: "Imagen 4 (Leaving 6/16)", name: "Imagen 4", icon: <ImageIcon size={12} /> }
                          ].map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => { setImageModel(m.id); }}
                              className={`text-left text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${imageModel === m.id ? 'bg-white/10 text-white font-semibold' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                            >
                              <span className="text-zinc-500">{m.icon}</span>
                              <span>{m.name}</span>
                              {imageModel === m.id && <Check size={12} className="ml-auto text-white" />}
                            </button>
                          ))}
                        </>
                      )}
                      {agentType === 'video' && (
                        <>
                          {[
                            { id: "Veo 3.1", name: "Veo 3.1", icon: <Film size={12} /> },
                            { id: "Veo", name: "Veo Legacy", icon: <Film size={12} /> }
                          ].map((m) => (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => { setVideoModel(m.id); }}
                              className={`text-left text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${videoModel === m.id ? 'bg-white/10 text-white font-semibold' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                            >
                              <span className="text-zinc-500">{m.icon}</span>
                              <span>{m.name}</span>
                              {videoModel === m.id && <Check size={12} className="ml-auto text-white" />}
                            </button>
                          ))}
                        </>
                      )}
                      {agentType === 'project' && (
                        <>
                          {avatars.length > 0 ? (
                            avatars.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => { setSelectedAvatarId(a.id); }}
                                className={`text-left text-xs px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${selectedAvatarId === a.id ? 'bg-white/10 text-white font-semibold' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}
                              >
                                <User size={12} className="text-zinc-500" />
                                <span>{a.name}</span>
                                {selectedAvatarId === a.id && <Check size={12} className="ml-auto text-white" />}
                              </button>
                            ))
                          ) : (
                            <span className="text-zinc-650 text-xs px-3 py-1.5 italic">Nenhum avatar</span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Proporção e Quantidade lado a lado */}
                  {agentType !== 'project' && (
                    <div className="grid grid-cols-2 gap-4">
                      {/* Proporção */}
                      <div className="flex flex-col gap-2">
                        <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest px-1">Proporção</div>
                        <div className="grid grid-cols-2 gap-1.5 bg-zinc-950/80 p-1.5 rounded-xl border border-white/5 text-center">
                          {['16:9', '4:3', '1:1', '3:4', '9:16'].map((r) => {
                            const currentRatio = agentType === 'image' ? imageRatio : videoRatio;
                            const handleRatioChange = (val: string) => {
                              if (agentType === 'image') {
                                setImageRatio(val);
                              } else {
                                setVideoRatio(val);
                              }
                            };
                            const isActive = currentRatio === r;
                            return (
                              <button
                                key={r}
                                type="button"
                                onClick={() => handleRatioChange(r)}
                                className={`py-1 rounded-lg text-[10px] font-mono transition-all border ${isActive ? 'bg-white text-black font-bold border-white shadow-sm' : 'bg-transparent border-transparent text-zinc-400 hover:text-white hover:bg-white/5'}`}
                              >
                                {r}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Quantidade */}
                      <div className="flex flex-col gap-2">
                        <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest px-1">Quantidade</div>
                        <div className="grid grid-cols-2 gap-1.5 bg-zinc-955/80 p-1.5 rounded-xl border border-white/5 text-center">
                          {['1x', 'x2', 'x3', 'x4'].map((q) => {
                            const currentQty = agentType === 'image' ? imageQty : videoQty;
                            const handleQtyChange = (val: string) => {
                              if (agentType === 'image') {
                                setImageQty(val);
                              } else {
                                if (val === 'x3' || val === 'x4') {
                                  setVideoQty('x2');
                                } else {
                                  setVideoQty(val);
                                }
                              }
                            };
                            const isDisabled = agentType === 'video' && (q === 'x3' || q === 'x4');
                            const isActive = currentQty === q && !isDisabled;
                            return (
                              <button
                                key={q}
                                type="button"
                                disabled={isDisabled}
                                onClick={() => handleQtyChange(q)}
                                className={`py-1 rounded-lg text-[10px] font-mono transition-all border ${isActive ? 'bg-white text-black font-bold border-white shadow-sm' : isDisabled ? 'opacity-20 cursor-not-allowed text-zinc-650 border-transparent' : 'bg-transparent border-transparent text-zinc-400 hover:text-white hover:bg-white/5'}`}
                              >
                                {q}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Otimizador LLM */}
                  <div className="flex flex-col gap-2 border-t border-white/5 pt-3">
                    <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest px-1">Otimizador (LLM)</div>
                    <div className="grid grid-cols-4 gap-1 bg-zinc-950/80 p-0.5 rounded-xl border border-white/5 text-center">
                      {(['gemini', 'chatgpt', 'deepseek', 'claude'] as const).map((m) => {
                        const isActive = agentModel === m;
                        const displayName = m === 'chatgpt' ? 'ChatGPT' : m === 'deepseek' ? 'DeepSeek' : m === 'gemini' ? 'Gemini' : 'Claude';
                        return (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setAgentModel(m)}
                            className={`py-1.5 rounded-lg text-[9px] font-bold tracking-wide transition-all ${isActive ? 'bg-white/10 text-white font-bold' : 'text-zinc-550 hover:text-white'}`}
                          >
                            {displayName}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Botão enviar: círculo branco com ícone de seta → */}
          <button
            type="button"
            onClick={handleExecuteAutopilot}
            disabled={agentLoading || imageLoading || videoLoading || projectLoading || !!activeJobId || !agentPrompt.trim()}
            className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center hover:bg-zinc-200 disabled:opacity-40 disabled:hover:bg-white transition-all shrink-0 shadow-md cursor-pointer"
          >
            <ArrowRight size={16} />
          </button>

        </div>

      </div>

    </div>
  );
}
