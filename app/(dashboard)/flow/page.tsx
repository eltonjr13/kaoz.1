"use client";

import { useEffect, useState, useRef } from "react";
import {
  Globe,
  Sparkles,
  Cpu,
  Image as ImageIcon,
  Video as VideoIcon,
  Loader2,
  CheckCircle,
  AlertCircle,
  Trash2,
  Terminal,
  RefreshCw,
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

// eslint-disable-next-line complexity
export default function FlowDashboardPage() {
  // 1. Status States
  const [status, setStatus] = useState<FlowStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [closeLoading, setCloseLoading] = useState(false);

  // 2. Generation States
  const [imagePrompt, setImagePrompt] = useState("");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageResult, setImageResult] = useState<GenerationResult | null>(null);
  const [imageRatio, setImageRatio] = useState("16:9");
  const [imageQty, setImageQty] = useState("x2");
  const [imageModel, setImageModel] = useState("Nano Banana 2");
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [imageReference, setImageReference] = useState<string | null>(null);

  const [videoPrompt, setVideoPrompt] = useState("");
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoResult, setVideoResult] = useState<GenerationResult | null>(null);
  const [videoRatio, setVideoRatio] = useState("16:9");
  const [videoQty, setVideoQty] = useState("1x");
  const [videoModel, setVideoModel] = useState("Veo 3.1");
  const [activeVideoIndex, setActiveVideoIndex] = useState(0);
  const [videoReference, setVideoReference] = useState<string | null>(null);

  // Convert selected reference image to base64
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

  // 3. Logger Console State
  const [logs, setLogs] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  // Helper to append console logs
  const appendLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs((prev) => [...prev, `[${timestamp}] ${message}`]);
  };

  // Fetch current session status
  const fetchStatus = async (silent = false) => {
    if (!silent) setLoadingStatus(true);
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
    } finally {
      if (!silent) setLoadingStatus(false);
    }
  };

  // Trigger status check on load
  useEffect(() => {
    setTimeout(() => {
      fetchStatus();
      appendLog("Painel de Controle Google Flow inicializado.");
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
    appendLog("Inicializando sessão. Se necessário, um navegador headful será aberto para login.");
    
    // Start status polling
    const pollInterval = setInterval(() => {
      fetchStatus(true);
    }, 3000);

    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "initialize" }),
      });
      const data = await res.json();
      
      if (data.success) {
        appendLog(`Sessão processada: ${data.message}`);
        if (data.status?.authenticated) {
          appendLog("Sessão autenticada e pronta para uso.");
        } else {
          appendLog("Sessão inicializada, mas requer login manual.");
        }
      } else {
        appendLog(`Falha na autenticação: ${data.error || "Erro desconhecido"}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`Erro na autenticação: ${errMsg}`);
    } finally {
      clearInterval(pollInterval);
      setAuthLoading(false);
      fetchStatus();
    }
  };

  // Handle Browser Session Shutdown
  const handleCloseSession = async () => {
    setCloseLoading(true);
    appendLog("Encerrando qualquer processo do navegador ativo...");
    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" }),
      });
      const data = await res.json();
      if (data.success) {
        appendLog("Sessão do browser finalizada.");
      } else {
        appendLog(`Falha ao encerrar browser: ${data.error}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`Erro ao fechar navegador: ${errMsg}`);
    } finally {
      setCloseLoading(false);
      fetchStatus();
    }
  };

  // Generate Image Action
  const handleGenerateImage = async () => {
    if (!imagePrompt.trim()) {
      appendLog("Aviso: Digite um prompt para gerar imagem.");
      return;
    }
    setImageLoading(true);
    setImageResult(null);
    setActiveImageIndex(0);
    appendLog(`Gerando imagem para: "${imagePrompt}"...`);
    
    try {
      const res = await fetch("/api/flow/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image",
          prompt: imagePrompt,
          aspectRatio: imageRatio,
          quantity: imageQty,
          model: imageModel,
          referenceImage: imageReference || undefined,
        }),
      });
      const data: GenerationResult = await res.json();
      
      if (data.success) {
        setImageResult(data);
        appendLog(`Imagem gerada com sucesso! Arquivo: ${data.filename}`);
      } else {
        setImageResult({
          success: false,
          path: "",
          filename: "",
          createdAt: new Date().toISOString(),
          error: data.error || "Falha na geração",
        });
        appendLog(`Erro na geração de imagem: ${data.error}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`Erro ao gerar imagem: ${errMsg}`);
    } finally {
      setImageLoading(false);
      fetchStatus();
    }
  };

  // Generate Video Action
  const handleGenerateVideo = async () => {
    if (!videoPrompt.trim()) {
      appendLog("Aviso: Digite um prompt para gerar vídeo.");
      return;
    }
    setVideoLoading(true);
    setVideoResult(null);
    setActiveVideoIndex(0);
    appendLog(`Gerando vídeo para: "${videoPrompt}"...`);

    try {
      const res = await fetch("/api/flow/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "video",
          prompt: videoPrompt,
          aspectRatio: videoRatio,
          quantity: videoQty,
          model: videoModel,
          referenceImage: videoReference || undefined,
        }),
      });
      const data: GenerationResult = await res.json();
      
      if (data.success) {
        setVideoResult(data);
        appendLog(`Vídeo gerado com sucesso! Arquivo: ${data.filename} (Duração: ${data.duration}s)`);
      } else {
        setVideoResult({
          success: false,
          path: "",
          filename: "",
          createdAt: new Date().toISOString(),
          error: data.error || "Falha na geração",
        });
        appendLog(`Erro na geração de vídeo: ${data.error}`);
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      appendLog(`Erro ao gerar vídeo: ${errMsg}`);
    } finally {
      setVideoLoading(false);
      fetchStatus();
    }
  };

  // Clean Console Logs
  const clearConsole = () => {
    setLogs([]);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b border-zinc-200 dark:border-zinc-800 pb-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-violet-600 to-indigo-600 dark:from-violet-400 dark:to-indigo-400 bg-clip-text text-transparent">
            Google Flow Creative Studio
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 text-sm mt-1">
            Painel de automação para geração de imagens (ImageFX) e vídeos (VideoFX) via navegador integrado.
          </p>
        </div>
        <button
          onClick={() => fetchStatus()}
          disabled={loadingStatus}
          className="mt-4 md:mt-0 flex items-center gap-2 px-3 py-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-xs font-semibold cursor-pointer transition-colors duration-150"
        >
          {loadingStatus ? (
            <Loader2 className="animate-spin" size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          <span>Atualizar Status</span>
        </button>
      </div>

      {/* Grid: Row 1 - Session Status and Live Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Status Card (Col-5) */}
        <div className="lg:col-span-5 bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2">
              <Globe size={18} className="text-indigo-500" />
              <span>Status da Sessão</span>
            </h2>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
                <span className="text-zinc-400 dark:text-zinc-500 block mb-1">Navegador</span>
                {status?.initialized ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle size={12} /> Ativo
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-bold text-zinc-500">
                    <AlertCircle size={12} /> Inativo
                  </span>
                )}
              </div>

              <div className="p-3 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-100 dark:border-zinc-800">
                <span className="text-zinc-400 dark:text-zinc-500 block mb-1">Google Auth</span>
                {status?.authenticated ? (
                  <span className="inline-flex items-center gap-1.5 font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle size={12} /> Conectado
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 font-bold text-amber-600 dark:text-amber-400">
                    <AlertCircle size={12} /> Requer Login
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 text-xs border-t border-zinc-100 dark:border-zinc-900 pt-3">
              <div className="flex justify-between">
                <span className="text-zinc-400 dark:text-zinc-500">Tarefas Ativas:</span>
                <span className="font-mono font-bold">{status?.activeTasks ?? 0}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-zinc-400 dark:text-zinc-500">Perfil de Armazenamento:</span>
                <span className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-900 px-2 py-1 rounded select-all break-all text-zinc-600 dark:text-zinc-300">
                  {status?.profilePath ?? "Carregando..."}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 pt-3 border-t border-zinc-100 dark:border-zinc-900">
            <button
              onClick={handleAuthenticate}
              disabled={authLoading}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
            >
              {authLoading ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <Sparkles size={14} />
              )}
              <span>Inicializar & Conectar</span>
            </button>

            <button
              onClick={handleCloseSession}
              disabled={closeLoading || !status?.initialized}
              className="flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
            >
              {closeLoading ? (
                <Loader2 className="animate-spin" size={14} />
              ) : (
                <Trash2 size={14} />
              )}
              <span>Fechar</span>
            </button>
          </div>
        </div>

        {/* Live Logs Card (Col-7) */}
        <div className="lg:col-span-7 bg-zinc-950 border border-zinc-850 rounded-xl p-5 shadow-sm flex flex-col h-[280px]">
          <div className="flex items-center justify-between border-b border-zinc-850 pb-2 mb-3">
            <h2 className="text-xs font-bold text-zinc-450 uppercase tracking-widest flex items-center gap-2">
              <Terminal size={14} className="text-indigo-400" />
              <span>Console Logs de Automação</span>
            </h2>
            <button
              onClick={clearConsole}
              className="text-[10px] text-zinc-500 hover:text-zinc-300 font-bold transition-colors cursor-pointer"
            >
              Limpar
            </button>
          </div>

          <div className="flex-1 overflow-y-auto font-mono text-[11px] text-zinc-300 space-y-1.5 scrollbar-thin scrollbar-thumb-zinc-800">
            {logs.length === 0 ? (
              <span className="text-zinc-655 italic">Nenhum evento registrado.</span>
            ) : (
              logs.map((log, idx) => (
                <div key={idx} className="leading-normal break-all">
                  {log.includes("[ERROR]") ? (
                    <span className="text-rose-500">{log}</span>
                  ) : log.includes("[WARN]") ? (
                    <span className="text-amber-500">{log}</span>
                  ) : log.includes("[INFO]") ? (
                    <span className="text-cyan-400">{log}</span>
                  ) : (
                    <span>{log}</span>
                  )}
                </div>
              ))
            )}
            <div ref={consoleEndRef} />
          </div>
        </div>
      </div>

      {/* Grid: Row 2 - Generation Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ImageFX Generation Panel */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-900 pb-2">
              <ImageIcon size={18} className="text-violet-500" />
              <span>Geração de Imagens (ImageFX)</span>
            </h2>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Descreva o Prompt:</label>
              <textarea
                value={imagePrompt}
                onChange={(e) => setImagePrompt(e.target.value)}
                placeholder="Ex: A futuristic city in cyberpunk aesthetic, hyperdetailed, vibrant neon colors..."
                className="w-full h-24 p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors duration-150 resize-none font-sans"
              />
            </div>

            {/* Upload Imagem de Referência */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <ImageIcon size={14} className="text-zinc-400" />
                <span>Imagem de Referência (Opcional):</span>
              </label>
              
              {!imageReference ? (
                <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-center hover:border-violet-500 dark:hover:border-violet-500 transition-colors duration-150 relative bg-zinc-50 dark:bg-zinc-900/30">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, setImageReference)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <Sparkles className="text-zinc-400 dark:text-zinc-500 animate-pulse" size={20} />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">
                      Arraste ou clique para selecionar imagem
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      Formatos aceitos: PNG, JPG, WebP
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative border border-zinc-200 dark:border-zinc-850 rounded-lg p-2 bg-zinc-50 dark:bg-zinc-900/50 flex items-center gap-3">
                  <div className="w-14 h-14 rounded overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageReference}
                      alt="Referência"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block truncate">
                      Imagem de referência anexada
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      Será usada como base para a geração
                    </span>
                  </div>
                  <button
                    onClick={() => setImageReference(null)}
                    className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Configs Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-b border-zinc-100 dark:border-zinc-900 py-3 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">Modelo</label>
                <select
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value)}
                  className="w-full p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer"
                >
                  <option value="Nano Banana 2">🍌 Nano Banana 2</option>
                  <option value="Nano Banana Pro">🍌 Nano Banana Pro</option>
                  <option value="Imagen 4 (Leaving 6/16)">Imagen 4</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">Formato</label>
                <select
                  value={imageRatio}
                  onChange={(e) => setImageRatio(e.target.value)}
                  className="w-full p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer"
                >
                  <option value="16:9">16:9 (Horizontal)</option>
                  <option value="4:3">4:3 (Clássico)</option>
                  <option value="1:1">1:1 (Quadrado)</option>
                  <option value="3:4">3:4 (Retrato)</option>
                  <option value="9:16">9:16 (Vertical)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">Quantidade</label>
                <select
                  value={imageQty}
                  onChange={(e) => setImageQty(e.target.value)}
                  className="w-full p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer"
                >
                  <option value="1x">1 Imagem</option>
                  <option value="x2">2 Imagens (Padrão)</option>
                  <option value="x3">3 Imagens</option>
                  <option value="x4">4 Imagens</option>
                </select>
              </div>
            </div>

            {/* Image Result Display Area */}
            {imageResult && (
              <div className="border border-zinc-200 dark:border-zinc-850 rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900/50 space-y-3">
                {imageResult.success ? (
                  <>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle size={12} /> Imagens geradas com sucesso!
                    </span>
                    {(() => {
                      const activePath = imageResult.paths && imageResult.paths[activeImageIndex] 
                        ? imageResult.paths[activeImageIndex] 
                        : imageResult.path;
                      const activeFilename = imageResult.filenames && imageResult.filenames[activeImageIndex] 
                        ? imageResult.filenames[activeImageIndex] 
                        : imageResult.filename;

                      return (
                        <>
                          <div className="aspect-video w-full rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 relative bg-zinc-200 dark:bg-zinc-950">
                            {/* Using secure server-side file streaming route to preview */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`/api/flow/media?path=${encodeURIComponent(activePath)}`}
                              alt="Resultado ImageFX"
                              className="w-full h-full object-contain"
                            />
                          </div>

                          {/* Thumbnails Row */}
                          {imageResult.paths && imageResult.paths.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto pb-1 pt-1 scrollbar-thin scrollbar-thumb-zinc-800">
                              {imageResult.paths.map((p, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => setActiveImageIndex(idx)}
                                  className={`relative w-16 h-12 rounded overflow-hidden border-2 flex-shrink-0 cursor-pointer transition-all ${
                                    idx === activeImageIndex 
                                      ? "border-indigo-600 scale-95" 
                                      : "border-zinc-350 dark:border-zinc-800 hover:border-zinc-400"
                                  }`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={`/api/flow/media?path=${encodeURIComponent(p)}`}
                                    alt={`Miniatura ${idx + 1}`}
                                    className="w-full h-full object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="text-[10px] space-y-1 font-mono text-zinc-500 dark:text-zinc-400">
                            <div><strong className="text-zinc-700 dark:text-zinc-300">Caminho:</strong> {activePath}</div>
                            <div><strong className="text-zinc-700 dark:text-zinc-300">Arquivo:</strong> {activeFilename}</div>
                          </div>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <span className="text-xs font-bold text-rose-600 dark:text-rose-455 flex items-start gap-1.5">
                    <AlertCircle className="shrink-0 mt-0.5" size={14} />
                    <span>Erro na geração: {imageResult.error}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleGenerateImage}
            disabled={imageLoading || !imagePrompt.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-zinc-950 hover:bg-zinc-900 dark:bg-white dark:hover:bg-zinc-100 dark:text-zinc-950 text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer mt-4"
          >
            {imageLoading ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                <span>Gerando no ImageFX... (Aguarde)</span>
              </>
            ) : (
              <>
                <Cpu size={14} />
                <span>Gerar Imagem</span>
              </>
            )}
          </button>
        </div>

        {/* VideoFX Generation Panel */}
        <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-lg font-bold flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-900 pb-2">
              <VideoIcon size={18} className="text-blue-500" />
              <span>Geração de Vídeos (VideoFX)</span>
            </h2>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400">Descreva o Prompt:</label>
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                placeholder="Ex: A golden retriever playing in a park on a sunny afternoon, cinematic panning shot..."
                className="w-full h-24 p-3 bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-lg text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500 transition-colors duration-150 resize-none font-sans"
              />
            </div>

            {/* Upload Imagem de Referência para Vídeo */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-500 dark:text-zinc-400 flex items-center gap-1.5">
                <ImageIcon size={14} className="text-zinc-400" />
                <span>Imagem de Referência (Opcional):</span>
              </label>
              
              {!videoReference ? (
                <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-lg p-4 text-center hover:border-blue-500 dark:hover:border-blue-500 transition-colors duration-150 relative bg-zinc-50 dark:bg-zinc-900/30">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileChange(e, setVideoReference)}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  />
                  <div className="flex flex-col items-center justify-center space-y-1">
                    <Sparkles className="text-zinc-400 dark:text-zinc-500 animate-pulse" size={20} />
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 font-semibold">
                      Arraste ou clique para selecionar imagem
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      Formatos aceitos: PNG, JPG, WebP
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative border border-zinc-200 dark:border-zinc-850 rounded-lg p-2 bg-zinc-50 dark:bg-zinc-900/50 flex items-center gap-3">
                  <div className="w-14 h-14 rounded overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={videoReference}
                      alt="Referência"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-zinc-700 dark:text-zinc-300 block truncate">
                      Imagem de referência anexada
                    </span>
                    <span className="text-[10px] text-zinc-400 dark:text-zinc-500">
                      Será usada como base para a geração
                    </span>
                  </div>
                  <button
                    onClick={() => setVideoReference(null)}
                    className="p-1.5 rounded-md border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-rose-500 hover:text-rose-600 transition-colors cursor-pointer"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </div>

            {/* Configs Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-b border-zinc-100 dark:border-zinc-900 py-3 text-xs">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">Modelo</label>
                <select
                  value={videoModel}
                  onChange={(e) => setVideoModel(e.target.value)}
                  className="w-full p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer"
                >
                  <option value="Veo 3.1">🎬 Veo 3.1</option>
                  <option value="Veo">🎬 Veo</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">Formato</label>
                <select
                  value={videoRatio}
                  onChange={(e) => setVideoRatio(e.target.value)}
                  className="w-full p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer"
                >
                  <option value="16:9">16:9 (Horizontal)</option>
                  <option value="4:3">4:3 (Clássico)</option>
                  <option value="1:1">1:1 (Quadrado)</option>
                  <option value="3:4">3:4 (Retrato)</option>
                  <option value="9:16">9:16 (Vertical)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider block">Quantidade</label>
                <select
                  value={videoQty}
                  onChange={(e) => setVideoQty(e.target.value)}
                  className="w-full p-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 outline-none focus:border-indigo-500 text-zinc-700 dark:text-zinc-300 font-semibold cursor-pointer"
                >
                  <option value="1x">1 Vídeo (Padrão)</option>
                  <option value="x2">2 Vídeos</option>
                </select>
              </div>
            </div>

            {/* Video Result Display Area */}
            {videoResult && (
              <div className="border border-zinc-200 dark:border-zinc-850 rounded-lg p-3 bg-zinc-50 dark:bg-zinc-900/50 space-y-3">
                {videoResult.success ? (
                  <>
                    <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle size={12} /> Vídeos gerados com sucesso!
                    </span>
                    {(() => {
                      const activePath = videoResult.paths && videoResult.paths[activeVideoIndex] 
                        ? videoResult.paths[activeVideoIndex] 
                        : videoResult.path;
                      const activeFilename = videoResult.filenames && videoResult.filenames[activeVideoIndex] 
                        ? videoResult.filenames[activeVideoIndex] 
                        : videoResult.filename;

                      return (
                        <>
                          <div className="aspect-video w-full rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 relative bg-zinc-200 dark:bg-zinc-950">
                            {/* Using secure server-side file streaming route to play video */}
                            <video
                              key={activePath}
                              src={`/api/flow/media?path=${encodeURIComponent(activePath)}`}
                              controls
                              className="w-full h-full object-contain"
                            />
                          </div>

                          {/* Thumbnails Row */}
                          {videoResult.paths && videoResult.paths.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto pb-1 pt-1 scrollbar-thin scrollbar-thumb-zinc-800">
                              {videoResult.paths.map((p, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => setActiveVideoIndex(idx)}
                                  className={`relative w-16 h-12 rounded overflow-hidden border-2 flex-shrink-0 cursor-pointer transition-all ${
                                    idx === activeVideoIndex 
                                      ? "border-indigo-600 scale-95" 
                                      : "border-zinc-350 dark:border-zinc-800 hover:border-zinc-400"
                                  }`}
                                >
                                  <video
                                    src={`/api/flow/media?path=${encodeURIComponent(p)}`}
                                    className="w-full h-full object-cover pointer-events-none"
                                    muted
                                  />
                                </button>
                              ))}
                            </div>
                          )}

                          <div className="text-[10px] space-y-1 font-mono text-zinc-500 dark:text-zinc-400">
                            <div><strong className="text-zinc-700 dark:text-zinc-300">Caminho:</strong> {activePath}</div>
                            <div><strong className="text-zinc-700 dark:text-zinc-300">Arquivo:</strong> {activeFilename}</div>
                            <div><strong className="text-zinc-700 dark:text-zinc-300">Duração:</strong> {videoResult.duration}s</div>
                          </div>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <span className="text-xs font-bold text-rose-600 dark:text-rose-455 flex items-start gap-1.5">
                    <AlertCircle className="shrink-0 mt-0.5" size={14} />
                    <span>Erro na geração: {videoResult.error}</span>
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={handleGenerateVideo}
            disabled={videoLoading || !videoPrompt.trim()}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-zinc-950 hover:bg-zinc-900 dark:bg-white dark:hover:bg-zinc-100 dark:text-zinc-950 text-white text-xs font-bold transition-all disabled:opacity-50 cursor-pointer mt-4"
          >
            {videoLoading ? (
              <>
                <Loader2 className="animate-spin" size={14} />
                <span>Gerando no VideoFX... (Aguarde)</span>
              </>
            ) : (
              <>
                <Cpu size={14} />
                <span>Gerar Vídeo</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
