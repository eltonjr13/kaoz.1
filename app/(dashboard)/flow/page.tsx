"use client";

import { useEffect, useState, useRef } from "react";
import {
  Image as ImageIcon,
  Loader2,
  AlertCircle,
  Trash2,
  Terminal,
  Copy,
  ArrowRight
} from "lucide-react";

interface FlowStatus {
  initialized: boolean;
  authenticated: boolean;
  activeTasks: number;
  profilePath: string;
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
  // 1. Status States
  const [status, setStatus] = useState<FlowStatus | null>(null);
  const [authLoading, setAuthLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);

  // 2. Control States
  const [agentModel, setAgentModel] = useState<'deepseek' | 'claude' | 'chatgpt' | 'gemini'>('gemini');
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentType, setAgentType] = useState<'image' | 'video'>('image');
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentResult, setAgentResult] = useState<string | null>(null);

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

  // Auto-scroll background page element to deep dark
  useEffect(() => {
    const mainEl = document.querySelector('main');
    if (mainEl) {
      const originalBg = mainEl.style.backgroundColor;
      mainEl.style.backgroundColor = '#0A0A0B';
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

  // Fetch session status
  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/flow/generate");
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status);
      } else {
        appendLog("Falha ao obter status do provider.");
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`Erro ao consultar status: ${errMsg}`);
    }
  };

  // Trigger status check on load (using setTimeout to prevent cascading render error)
  useEffect(() => {
    setTimeout(() => {
      fetchStatus();
      appendLog("Painel do Agente MrChicken inicializado.");
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll logs
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // Handle Session Initialization / Auth Fallback
  const handleAuthenticate = async () => {
    setAuthLoading(true);
    appendLog("Inicializando sessão do navegador. Faça login se a janela abrir.");
    
    const pollInterval = setInterval(() => {
      fetchStatus();
    }, 3000);

    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initialize" }),
      });
      const data = await res.json();
      
      if (data.success) {
        appendLog(`Sessão: ${data.message}`);
      } else {
        appendLog(`Falha na inicialização: ${data.error || "Erro desconhecido"}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`Erro ao autenticar: ${errMsg}`);
    } finally {
      clearInterval(pollInterval);
      setAuthLoading(false);
      fetchStatus();
    }
  };

  // Handle Browser Session Shutdown
  const handleCloseSession = async () => {
    setCloseLoading(true);
    appendLog("Encerrando navegador...");
    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json();
      if (data.success) {
        appendLog("Navegador encerrado.");
      } else {
        appendLog(`Falha ao encerrar: ${data.error}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`Erro ao encerrar navegador: ${errMsg}`);
    } finally {
      setCloseLoading(false);
      fetchStatus();
    }
  };

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
        fetchStatus();
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
        fetchStatus();
      }
    }
  };

  const currentReference = agentType === 'image' ? imageReference : videoReference;

  return (
    <div className="flex-1 w-full min-h-full flex flex-col justify-start px-8 py-10 select-none overflow-y-auto" style={{ backgroundColor: '#0A0A0B', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Topbar fina, minimalista dentro da página */}
      <div className="flex items-center justify-between w-full border-b border-[rgba(255,255,255,0.07)] pb-4 mb-12">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-[#F2F2F2]">MRCHICKEN</span>
        </div>
        <div className="flex items-center gap-4">
          {/* Status do Navegador / Tooltip */}
          <div className="relative group flex items-center gap-2 cursor-pointer py-1">
            <span className={`w-2 h-2 rounded-full ${status?.authenticated ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`}></span>
            <span className="text-[10px] text-[#5A5A6A] font-mono tracking-wide uppercase select-none">
              {status?.authenticated ? 'AI Active' : 'Login Required'}
            </span>
            
            {/* Tooltip Card */}
            <div className="absolute right-0 top-7 scale-0 group-hover:scale-100 transition-all duration-150 origin-top-right bg-[#111114] border border-[rgba(255,255,255,0.07)] rounded-[10px] p-3 text-xs w-64 shadow-xl z-50 pointer-events-none">
              <p className="font-bold text-[#F2F2F2] mb-1">Status do Navegador</p>
              <p className="text-[#5A5A6A] text-[10px] mb-1">
                Sessão Playwright: <span className={status?.initialized ? 'text-emerald-400' : 'text-zinc-500'}>{status?.initialized ? 'Ativa' : 'Inativa'}</span>
              </p>
              <p className="text-[#5A5A6A] text-[10px] mb-3">
                Google Auth: <span className={status?.authenticated ? 'text-emerald-400' : 'text-amber-400'}>{status?.authenticated ? 'Conectado' : 'Requer Login'}</span>
              </p>
              <div className="flex gap-2 pt-2 border-t border-[rgba(255,255,255,0.07)]">
                <button
                  onClick={(e) => { e.stopPropagation(); handleAuthenticate(); }}
                  disabled={authLoading}
                  className="flex-1 py-1 bg-[#F2F2F2] text-[#0A0A0B] rounded-[6px] text-[10px] font-bold pointer-events-auto hover:bg-white transition-colors cursor-pointer"
                >
                  {authLoading ? 'Conectando...' : 'Conectar'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleCloseSession(); }}
                  disabled={closeLoading || !status?.initialized}
                  className="flex-1 py-1 border border-[rgba(255,255,255,0.07)] text-[#F2F2F2] rounded-[6px] text-[10px] font-bold pointer-events-auto hover:bg-[#16161A] transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Headline principal centralizado-esquerda */}
      <div className="w-full max-w-3xl mx-auto flex flex-col items-start mb-8">
        <h1 className="text-2xl font-light text-[#F2F2F2] tracking-tight">Agente MrChicken</h1>
        <p className="text-xs text-[#5A5A6A] mt-1 font-light">O que você quer criar hoje?</p>
      </div>

      {/* Caixa de Entrada principal (Hero Input Card) */}
      <div className="w-full max-w-3xl mx-auto bg-[#16161A] border border-[rgba(255,255,255,0.07)] rounded-[14px] p-4 flex flex-col shadow-2xl transition-all duration-200 focus-within:border-zinc-700">
        <textarea
          value={agentPrompt}
          onChange={(e) => setAgentPrompt(e.target.value)}
          placeholder="Descreva uma cena, produto, personagem ou ideia..."
          className="w-full bg-transparent border-none text-[#F2F2F2] placeholder-[#5A5A6A] text-sm font-sans resize-none outline-none min-h-[100px] leading-relaxed"
          disabled={agentLoading || imageLoading || videoLoading}
        />
        
        {/* Imagem de Referência anexada inline */}
        {currentReference && (
          <div className="relative w-12 h-12 rounded-[10px] overflow-hidden border border-[rgba(255,255,255,0.07)] mb-4 group shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={currentReference} alt="Referência" className="w-full h-full object-cover" />
            <button
              onClick={handleRemoveReference}
              className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-rose-500 cursor-pointer"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[rgba(255,255,255,0.07)] mt-2">
          {/* Controles inline na base do input */}
          <div className="flex flex-wrap items-center gap-2">
            
            {/* Modelo IA */}
            <select
              value={agentModel}
              onChange={(e) => setAgentModel(e.target.value as 'deepseek' | 'claude' | 'chatgpt' | 'gemini')}
              className="bg-[#111114] border border-[rgba(255,255,255,0.07)] text-[11px] text-[#F2F2F2] px-3 py-1.5 rounded-full cursor-pointer hover:border-zinc-700 outline-none transition-colors"
            >
              <option value="gemini">Gemini</option>
              <option value="chatgpt">ChatGPT</option>
              <option value="deepseek">DeepSeek</option>
              <option value="claude">Claude</option>
            </select>

            {/* Objetivo */}
            <select
              value={agentType}
              onChange={(e) => setAgentType(e.target.value as 'image' | 'video')}
              className="bg-[#111114] border border-[rgba(255,255,255,0.07)] text-[11px] text-[#F2F2F2] px-3 py-1.5 rounded-full cursor-pointer hover:border-zinc-700 outline-none transition-colors"
            >
              <option value="image">Imagem</option>
              <option value="video">Vídeo</option>
            </select>

            {/* Aspect Ratio */}
            <select
              value={agentType === 'image' ? imageRatio : videoRatio}
              onChange={(e) => {
                if (agentType === 'image') {
                  setImageRatio(e.target.value);
                } else {
                  setVideoRatio(e.target.value);
                }
              }}
              className="bg-[#111114] border border-[rgba(255,255,255,0.07)] text-[11px] text-[#F2F2F2] px-3 py-1.5 rounded-full cursor-pointer hover:border-zinc-700 outline-none transition-colors"
            >
              <option value="16:9">16:9</option>
              <option value="4:3">4:3</option>
              <option value="1:1">1:1</option>
              <option value="3:4">3:4</option>
              <option value="9:16">9:16</option>
            </select>

            {/* Versão do Modelo */}
            <select
              value={agentType === 'image' ? imageModel : videoModel}
              onChange={(e) => {
                if (agentType === 'image') {
                  setImageModel(e.target.value);
                } else {
                  setVideoModel(e.target.value);
                }
              }}
              className="bg-[#111114] border border-[rgba(255,255,255,0.07)] text-[11px] text-[#F2F2F2] px-3 py-1.5 rounded-full cursor-pointer hover:border-zinc-700 outline-none transition-colors"
            >
              {agentType === 'image' ? (
                <>
                  <option value="Nano Banana 2">Banana 2</option>
                  <option value="Nano Banana Pro">Banana Pro</option>
                  <option value="Imagen 4 (Leaving 6/16)">Imagen 4</option>
                </>
              ) : (
                <>
                  <option value="Veo 3.1">Veo 3.1</option>
                  <option value="Veo">Veo</option>
                </>
              )}
            </select>

            {/* Quantidade */}
            <select
              value={agentType === 'image' ? imageQty : videoQty}
              onChange={(e) => {
                if (agentType === 'image') {
                  setImageQty(e.target.value);
                } else {
                  setVideoQty(e.target.value);
                }
              }}
              className="bg-[#111114] border border-[rgba(255,255,255,0.07)] text-[11px] text-[#F2F2F2] px-3 py-1.5 rounded-full cursor-pointer hover:border-zinc-700 outline-none transition-colors"
            >
              {agentType === 'image' ? (
                <>
                  <option value="1x">1 Img</option>
                  <option value="x2">2 Imgs</option>
                  <option value="x3">3 Imgs</option>
                  <option value="x4">4 Imgs</option>
                </>
              ) : (
                <>
                  <option value="1x">1 Vídeo</option>
                  <option value="x2">2 Vídeos</option>
                </>
              )}
            </select>

            {/* Botão de Anexo */}
            <label className="bg-[#111114] border border-[rgba(255,255,255,0.07)] hover:border-zinc-700 text-[#F2F2F2] p-1.5 rounded-full cursor-pointer transition-colors flex items-center justify-center">
              <ImageIcon size={14} />
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

          </div>

          {/* Botão Criar */}
          <button
            onClick={handleExecuteAutopilot}
            disabled={agentLoading || imageLoading || videoLoading || !agentPrompt.trim()}
            className="bg-[#FFFFFF] hover:bg-[#E4E4E7] text-[#0A0A0B] disabled:opacity-50 text-xs font-bold px-4 py-2 rounded-full cursor-pointer transition-all flex items-center gap-1"
          >
            <span>Criar</span>
            <ArrowRight size={12} />
          </button>
        </div>
      </div>

      {/* Prompt Otimizado abaixo do input */}
      {agentResult && (
        <div className="w-full max-w-3xl mx-auto text-xs text-[#5A5A6A] italic mt-3 flex items-start gap-2">
          <span className="flex-1 leading-relaxed">
            *Prompt otimizado pelo Agente:* &quot;{agentResult}&quot;
          </span>
          <button
            onClick={() => {
              if (copyToClipboard(agentResult)) {
                appendLog("Prompt otimizado copiado.");
              }
            }}
            className="text-[#5A5A6A] hover:text-[#F2F2F2] p-1 transition-colors shrink-0 cursor-pointer"
            title="Copiar prompt"
          >
            <Copy size={12} />
          </button>
        </div>
      )}

      {/* Estado de Processamento Minimalista */}
      {(agentLoading || imageLoading || videoLoading) && (
        <div className="flex flex-col items-center justify-center p-12 space-y-3 w-full max-w-md mx-auto mt-6">
          <Loader2 className="animate-spin text-white opacity-40" size={24} />
          <div className="text-xs font-semibold text-[#F2F2F2] animate-pulse">
            {agentLoading ? "Otimizando ideia..." : imageLoading ? "Gerando imagem..." : "Gerando vídeo..."}
          </div>
          {logs.length > 0 && (
            <div className="text-[10px] text-[#5A5A6A] font-mono text-center max-w-xs truncate">
              {logs[logs.length - 1].replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, '')}
            </div>
          )}
        </div>
      )}

      {/* Resultados Inline */}
      {((agentType === 'image' && imageResult) || (agentType === 'video' && videoResult)) && (
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

      {/* Rodapé discreto com Logs colapsados */}
      <div className="mt-auto pt-16 flex flex-col items-center justify-center gap-4">
        <button
          onClick={() => setShowLogs(!showLogs)}
          className="text-[10px] text-[#5A5A6A] hover:text-[#F2F2F2] transition-colors duration-150 flex items-center gap-1 cursor-pointer font-mono uppercase tracking-wider"
        >
          <Terminal size={12} />
          <span>{showLogs ? "Esconder logs" : "Ver logs"}</span>
        </button>
        
        {showLogs && (
          <div className="w-full max-w-2xl bg-[#111114] border border-[rgba(255,255,255,0.07)] rounded-[10px] p-4 h-48 overflow-y-auto font-mono text-[11px] text-[#5A5A6A] space-y-1.5 text-left scrollbar-thin scrollbar-thumb-zinc-800">
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
      </div>

    </div>
  );
}
