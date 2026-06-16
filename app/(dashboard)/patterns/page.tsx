"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Upload,
  Shirt,
  Download,
  RefreshCw,
  Trash2,
  Play,
  StopCircle,
  CheckCircle2,
  AlertCircle,
  Terminal as TerminalIcon,
  Sliders,
  Sparkles,
  X,
  Maximize2
} from "lucide-react";

interface QueueItem {
  id: string;
  filename: string;
  fileSize: string;
  previewUrl: string;
  base64: string;
  status: "pending" | "processing" | "success" | "failed";
  progress: number;
  resultUrl?: string;
  resultPaths?: string[];
  error?: string;
  logs: string[];
}

const DEFAULT_PROMPT = "Extract only the flat 2D pattern/print from the clothing in this reference image. Isolate the pattern completely on a solid, clean, pure white background. The output must be a seamless texture or flat design of the print alone, removing all shadows, folds, clothing outline, model body, skin, hair, and other backgrounds. Clean digital art format, highly detailed pattern.";

// Safe UUID Generator with Fallback for non-secure origins (HTTP/IP)
const generateUUID = () => {
  if (typeof window !== "undefined" && window.crypto && window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }
  // Fallback RFC4122 version 4 compliant random generator
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

export default function PatternsPage() {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [aspectRatio, setAspectRatio] = useState<"1:1" | "16:9" | "4:3" | "3:4" | "9:16">("1:1");
  const [quantity, setQuantity] = useState<number>(2);
  const [model, setModel] = useState<string>("Imagen 3");
  const [batchFolder, setBatchFolder] = useState("Lote_Estampas");
  const [isProcessing, setIsProcessing] = useState(false);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);
  const [globalLogs, setGlobalLogs] = useState<string[]>([]);
  const [selectedResult, setSelectedResult] = useState<{ original: string; result: string; name: string } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Auto-scroll global logs
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [globalLogs]);

  // Clean memory object URLs on unmount
  useEffect(() => {
    return () => {
      queue.forEach(item => {
        if (item.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, [queue]);

  const addLog = (message: string, itemId?: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const formattedMsg = `[${timestamp}] ${message}`;
    
    setGlobalLogs(prev => [...prev, formattedMsg]);

    if (itemId) {
      setQueue(prev =>
        prev.map(item =>
          item.id === itemId
            ? { ...item, logs: [...item.logs, formattedMsg] }
            : item
        )
      );
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    processFiles(Array.from(e.target.files));
  };

  const processFiles = (files: File[]) => {
    files.forEach(file => {
      // Basic image validation
      if (!file.type.startsWith("image/")) {
        addLog(`Ignorado arquivo inválido (não é imagem): ${file.name}`);
        return;
      }

      const previewUrl = URL.createObjectURL(file);
      const fileSizeStr = (file.size / (1024 * 1024)).toFixed(2) + " MB";
      const id = generateUUID();

      // Read file as base64
      const reader = new FileReader();
      reader.onload = (event) => {
        if (typeof event.target?.result === "string") {
          const base64Data = event.target.result;
          
          setQueue(prev => [
            ...prev,
            {
              id,
              filename: file.name,
              fileSize: fileSizeStr,
              previewUrl,
              base64: base64Data,
              status: "pending",
              progress: 0,
              logs: [`[${new Date().toLocaleTimeString()}] Adicionado à fila.`],
            }
          ]);
          addLog(`Imagem adicionada à fila: ${file.name} (${fileSizeStr})`);
        }
      };
      reader.readAsDataURL(file);
    });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      processFiles(Array.from(e.dataTransfer.files));
    }
  };

  const handleRemoveItem = (id: string) => {
    if (activeItemId === id) {
      addLog("Não é possível remover o item que está sendo processado ativamente.");
      return;
    }
    
    setQueue(prev => {
      const item = prev.find(i => i.id === id);
      if (item && item.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return prev.filter(i => i.id !== id);
    });
    addLog("Imagem removida da fila.");
  };

  const handleClearQueue = () => {
    if (isProcessing) {
      addLog("Aguarde o processamento concluir ou pare antes de limpar a fila.");
      return;
    }
    
    queue.forEach(item => {
      if (item.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(item.previewUrl);
      }
    });
    setQueue([]);
    setGlobalLogs([]);
    addLog("Fila limpa com sucesso.");
  };

  const stopProcessing = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsProcessing(false);
    setActiveItemId(null);
    setQueue(prev =>
      prev.map(item =>
        item.status === "processing"
          ? { ...item, status: "failed", error: "Cancelado pelo usuário", progress: 0 }
          : item
      )
    );
    addLog("Processamento interrompido pelo usuário.");
  };

  const startBatchProcessing = async () => {
    const pendingItems = queue.filter(item => item.status === "pending" || item.status === "failed");
    if (pendingItems.length === 0) {
      addLog("Nenhuma imagem pendente na fila para processar.");
      return;
    }

    setIsProcessing(true);
    addLog(`Iniciando processamento em lote de ${pendingItems.length} imagem(ns)...`);

    for (const item of pendingItems) {
      // Check if user clicked stop
      if (!isProcessing && abortControllerRef.current?.signal.aborted) {
        break;
      }

      await processItem(item);
    }

    setIsProcessing(false);
    setActiveItemId(null);
    addLog("Processamento em lote concluído!");
  };

  const processItem = async (item: QueueItem) => {
    setActiveItemId(item.id);
    setQueue(prev =>
      prev.map(i =>
        i.id === item.id ? { ...i, status: "processing", progress: 10 } : i
      )
    );

    item.logs = []; // clear item logs
    addLog(`Processando imagem: ${item.filename}`, item.id);
    addLog("Convertendo imagem e preparando opções da API...", item.id);

    abortControllerRef.current = new AbortController();

    try {
      // Simulate progress checkpoints for UX, since backend generation is synchronous
      const progressInterval = setInterval(() => {
        setQueue(prev =>
          prev.map(i => {
            if (i.id === item.id && i.status === "processing" && i.progress < 90) {
              const inc = Math.floor(Math.random() * 8) + 2;
              const nextProgress = Math.min(i.progress + inc, 90);
              
              // Add mock logs based on progression milestones
              if (nextProgress > 25 && i.progress <= 25) {
                addLog("Iniciando sessão com o navegador do Google Flow...", item.id);
              } else if (nextProgress > 45 && i.progress <= 45) {
                addLog("Fazendo upload da imagem de referência no lobby...", item.id);
              } else if (nextProgress > 65 && i.progress <= 65) {
                addLog("Anexando referência ao prompt e submetendo...", item.id);
              } else if (nextProgress > 80 && i.progress <= 80) {
                addLog("Aguardando conclusão da geração da IA (Imagen 3)...", item.id);
              }

              return { ...i, progress: nextProgress };
            }
            return i;
          })
        );
      }, 4000);

      // Call API
      const response = await fetch("/api/flow/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "image",
          prompt: prompt,
          aspectRatio: aspectRatio,
          quantity: quantity,
          model: model,
          referenceImage: item.base64,
          folderName: batchFolder,
          originalFilename: item.filename.replace(/\.[^/.]+$/, "")
        }),
        signal: abortControllerRef.current.signal
      });

      clearInterval(progressInterval);

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || `Erro HTTP ${response.status}`);
      }

      const data = await response.json();
      if (!data.success) {
        throw new Error(data.error || "Geração falhou");
      }

      // Successful extraction
      const resultPath = `/api/flow/media?path=${encodeURIComponent(data.path)}`;
      const resultPaths = data.paths 
        ? data.paths.map((p: string) => `/api/flow/media?path=${encodeURIComponent(p)}`) 
        : [resultPath];
      
      setQueue(prev =>
        prev.map(i =>
          i.id === item.id
            ? {
                ...i,
                status: "success",
                progress: 100,
                resultUrl: resultPath,
                resultPaths: resultPaths,
                logs: [...i.logs, `[${new Date().toLocaleTimeString()}] Download concluído com sucesso.`]
              }
            : i
        )
      );

      addLog(`Estampa extraída com sucesso para: ${item.filename}`, item.id);
      addLog(`Arquivo gerado: ${data.filename}`, item.id);

    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        addLog(`Cancelado processamento de: ${item.filename}`, item.id);
        return;
      }

      const errMsg = err instanceof Error ? err.message : String(err);
      addLog(`Erro ao processar ${item.filename}: ${errMsg}`, item.id);

      setQueue(prev =>
        prev.map(i =>
          i.id === item.id
            ? { ...i, status: "failed", progress: 0, error: errMsg }
            : i
        )
      );
    }
  };

  const handleDownload = async (url: string, filename: string) => {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `estampa_${filename.replace(/\.[^/.]+$/, "")}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      addLog(`Falha ao baixar estampa: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="relative isolate min-h-screen bg-[#080808] pb-32 pt-10 text-white select-none">
      {/* Background radial highlight */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: "radial-gradient(ellipse 50% 50% at 75% 15%, rgba(157,124,255,0.05) 0%, transparent 100%), linear-gradient(180deg, rgba(8,8,8,0.2) 0%, #080808 100%)",
        }}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Header Section */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between pb-8 border-b border-white/[0.06]">
          <div>
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl"
                style={{
                  background: "rgba(157,124,255,0.12)",
                  border: "1px solid rgba(157,124,255,0.2)",
                }}
              >
                <Shirt size={18} className="text-[#9D7CFF]" />
              </span>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white sm:text-2xl">
                  Extrator de Estampas
                </h1>
                <p className="text-xs text-[#7B7B86] mt-0.5">
                  Remova o modelo e isole a estampa da roupa com fundo branco usando Google Flow
                </p>
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-2">
            {isProcessing ? (
              <button
                onClick={stopProcessing}
                className="flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold text-red-400 border border-red-500/20 bg-red-950/25 hover:bg-red-900/30 transition-colors cursor-pointer"
              >
                <StopCircle size={14} className="animate-pulse" />
                Parar Processamento
              </button>
            ) : (
              <button
                onClick={startBatchProcessing}
                disabled={queue.length === 0}
                className="flex h-10 items-center gap-2 rounded-xl px-4 text-xs font-semibold text-black bg-[#9D7CFF] hover:bg-[#b094ff] disabled:bg-[#7b7b86]/30 disabled:text-[#4A4A54] transition-colors shadow-lg shadow-[#9D7CFF]/10 cursor-pointer"
              >
                <Play size={14} />
                Extrair Estampas ({queue.filter(i => i.status === "pending" || i.status === "failed").length})
              </button>
            )}
          </div>
        </div>

        {/* Core Layout Grid (2 Columns: Upload & Queue Left, Configurations & Logs Right) */}
        <div className="mt-8 grid gap-8 lg:grid-cols-3">
          
          {/* Left Area: Drag & Drop + Fila (ColSpan 2) */}
          <div className="lg:col-span-2 flex flex-col gap-6">
            
            {/* Drag and Drop Zone */}
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="group relative flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.12] bg-[#0c0c0e]/30 px-6 py-12 text-center cursor-pointer transition-all hover:border-[#9D7CFF]/50 hover:bg-[#0c0c0e]/50"
            >
              {/* input tag is now protected from bubbling */}
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                onClick={(e) => e.stopPropagation()}
                multiple
                accept="image/*"
                className="hidden"
              />
              <div
                className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl transition-transform group-hover:scale-105"
                style={{
                  background: "rgba(157,124,255,0.06)",
                  border: "1px solid rgba(157,124,255,0.12)",
                }}
              >
                <Upload size={18} className="text-[#9D7CFF]" />
              </div>
              <p className="text-xs font-semibold text-white">
                Arraste imagens de roupas aqui ou clique para buscar
              </p>
              <p className="text-[10px] text-[#7B7B86] mt-1.5">
                PNG, JPG ou WEBP de alta qualidade (selecione múltiplos se desejar)
              </p>
            </div>

            {/* Fila Grid */}
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#7B7B86] flex items-center gap-1.5">
                  <Shirt size={12} className="text-[#9D7CFF]" />
                  Fila de Imagens ({queue.length})
                </h3>
                {queue.length > 0 && (
                  <button
                    onClick={handleClearQueue}
                    className="text-[10px] font-semibold text-red-400 hover:text-red-300 transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <Trash2 size={10} />
                    Limpar Tudo
                  </button>
                )}
              </div>

              {queue.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/[0.04] bg-[#0c0c0e]/10 py-16 text-center">
                  <Shirt size={32} className="text-[#4A4A54] mb-3" />
                  <p className="text-xs font-medium text-[#7B7B86]">
                    Nenhuma imagem na fila de extração.
                  </p>
                  <p className="text-[10px] text-[#4A4A54] mt-1">
                    Faça o upload de fotos de roupas com estampas acima.
                  </p>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {queue.map((item) => {
                    const isProcessingThis = activeItemId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={`group relative overflow-hidden rounded-2xl border backdrop-blur-sm transition-all duration-200 ${
                          isProcessingThis
                            ? "border-[#9D7CFF] bg-[#9D7CFF]/5 shadow-lg shadow-[#9D7CFF]/5"
                            : item.status === "success"
                            ? "border-emerald-500/30 bg-emerald-950/5"
                            : item.status === "failed"
                            ? "border-red-500/30 bg-red-950/5"
                            : "border-white/[0.06] bg-[#0c0c0e]/40 hover:border-white/[0.12]"
                        }`}
                      >
                        {/* Card Content */}
                        <div className="p-4 flex gap-4">
                          {/* Image preview (Original) */}
                          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-white/[0.08] bg-neutral-900">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.previewUrl}
                              alt="Original"
                              className="h-full w-full object-cover"
                            />
                            {item.status === "success" && item.resultUrl && (
                              <button
                                onClick={() =>
                                  setSelectedResult({
                                    original: item.previewUrl,
                                    result: item.resultUrl!,
                                    name: item.filename
                                  })
                                }
                                className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              >
                                <Maximize2 size={14} className="text-white" />
                              </button>
                            )}
                          </div>

                          {/* Details & Status */}
                          <div className="min-w-0 flex-1 flex flex-col justify-between">
                            <div>
                              <p className="truncate text-xs font-semibold text-white">
                                {item.filename}
                              </p>
                              <p className="text-[10px] text-[#7B7B86] mt-0.5">
                                {item.fileSize}
                              </p>
                            </div>

                            {/* Status and operations */}
                            <div className="mt-3 flex items-center justify-between">
                              {/* Status Badges */}
                              {item.status === "pending" && (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold bg-white/[0.03] text-[#B8B8C0] border border-white/[0.06]">
                                  Pendente
                                </span>
                              )}
                              {item.status === "processing" && (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold bg-[#9D7CFF]/10 text-[#9D7CFF] border border-[#9D7CFF]/20 animate-pulse">
                                  Processando ({item.progress}%)
                                </span>
                              )}
                              {item.status === "success" && (
                                <span className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                  <CheckCircle2 size={9} />
                                  Concluído
                                </span>
                              )}
                              {item.status === "failed" && (
                                <span
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20 cursor-pointer"
                                  title={item.error}
                                >
                                  <AlertCircle size={9} />
                                  Erro
                                </span>
                              )}

                              {/* Card Actions */}
                              <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity">
                                {item.status === "success" && item.resultUrl && (
                                  <button
                                    onClick={() => handleDownload(item.resultUrl!, item.filename)}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-white/[0.06] text-[#B8B8C0] hover:text-white transition-colors cursor-pointer"
                                    title="Baixar Estampa"
                                  >
                                    <Download size={12} />
                                  </button>
                                )}
                                {item.status === "failed" && (
                                  <button
                                    onClick={() => processItem(item)}
                                    disabled={isProcessing}
                                    className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-white/[0.06] text-[#B8B8C0] hover:text-white transition-colors disabled:opacity-40 cursor-pointer"
                                    title="Tentar Novamente"
                                  >
                                    <RefreshCw size={12} />
                                  </button>
                                )}
                                <button
                                  onClick={() => handleRemoveItem(item.id)}
                                  disabled={isProcessingThis}
                                  className="flex h-6 w-6 items-center justify-center rounded-lg hover:bg-white/[0.06] text-red-400/80 hover:text-red-400 transition-colors disabled:opacity-40 cursor-pointer"
                                  title="Remover da fila"
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Variations List (only if success and multiple variations exist) */}
                        {item.status === "success" && item.resultPaths && item.resultPaths.length > 0 && (
                          <div className="px-4 pb-4 pt-3 border-t border-white/[0.04] bg-black/10">
                            <p className="text-[10px] font-bold text-[#7B7B86] uppercase tracking-wider mb-2 flex items-center gap-1">
                              <Sparkles size={9} className="text-[#9D7CFF]" />
                              Variações Geradas e Salvas
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {item.resultPaths.map((pUrl, idx) => (
                                <div key={idx} className="relative group/var h-12 w-12 overflow-hidden rounded-lg border border-white/[0.06] bg-neutral-900 flex items-center justify-center">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={pUrl} alt={`Variação ${idx + 1}`} className="h-full w-full object-cover" />
                                  <div className="absolute inset-0 bg-black/70 flex gap-1 items-center justify-center opacity-0 group-hover/var:opacity-100 transition-opacity">
                                    <button
                                      onClick={() => setSelectedResult({
                                        original: item.previewUrl,
                                        result: pUrl,
                                        name: `${item.filename} (Variação ${idx + 1})`
                                      })}
                                      className="p-1 hover:text-white text-[#B8B8C0] transition-colors cursor-pointer"
                                      title="Ampliar"
                                    >
                                      <Maximize2 size={10} />
                                    </button>
                                    <button
                                      onClick={() => handleDownload(pUrl, `${item.filename.replace(/\.[^/.]+$/, "")}_${idx + 1}`)}
                                      className="p-1 hover:text-white text-[#B8B8C0] transition-colors cursor-pointer"
                                      title="Baixar"
                                    >
                                      <Download size={10} />
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Progress Bar (Only during active extraction) */}
                        {isProcessingThis && (
                          <div className="absolute bottom-0 inset-x-0 h-0.5 bg-black/40">
                            <div
                              className="h-full bg-[#9D7CFF] transition-all duration-500"
                              style={{ width: `${item.progress}%` }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Right Area: Configurations (Always Visible) & Live Terminal Logs */}
          <div className="flex flex-col gap-6">
            
            {/* Configurations Box */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0c0c0e]/80 p-5 backdrop-blur-md">
              <h2 className="text-xs font-bold uppercase tracking-wider text-[#7B7B86] flex items-center gap-1.5 mb-4">
                <Sliders size={12} className="text-[#9D7CFF]" />
                Parâmetros do Google Flow
              </h2>
              
              <div className="flex flex-col gap-5">
                <div>
                  <label className="block text-[11px] font-semibold text-[#B8B8C0] mb-2">
                    Pasta de Destino (Lote)
                  </label>
                  <input
                    type="text"
                    value={batchFolder}
                    onChange={(e) => setBatchFolder(e.target.value)}
                    className="w-full rounded-xl border border-white/[0.08] bg-black/40 px-3.5 py-2.5 text-xs text-white focus:border-[#9D7CFF] focus:outline-none placeholder-white/20"
                    placeholder="Ex: Colecao_Verao_2026"
                  />
                  <p className="text-[9px] text-[#7B7B86] mt-1.5 leading-relaxed">
                    As variações de cada modelo serão salvas em subpastas individuais dentro de <code className="text-[#9D7CFF] bg-black/40 px-1 py-0.5 rounded">storage/generated/patterns/&lt;Pasta_do_Lote&gt;/&lt;Nome_do_Modelo&gt;/</code>.
                  </p>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#B8B8C0] mb-2">
                    Proporção da Estampa (Aspect Ratio)
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {(["1:1", "16:9", "4:3", "3:4", "9:16"] as const).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setAspectRatio(ratio)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium border transition-colors cursor-pointer ${
                          aspectRatio === ratio
                            ? "border-[#9D7CFF] bg-[#9D7CFF]/10 text-white"
                            : "border-white/[0.06] bg-white/[0.02] text-[#B8B8C0] hover:bg-white/[0.05]"
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-[#B8B8C0] mb-1.5">
                      Modelo da IA
                    </label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      className="w-full rounded-xl border border-white/[0.08] bg-black/40 px-3.5 py-2 text-xs text-white focus:border-[#9D7CFF] focus:outline-none"
                    >
                      <option value="Imagen 3">Imagen 3</option>
                      <option value="Imagen 2">Imagen 2</option>
                      <option value="Nano Banana 2">Nano Banana 2</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[#B8B8C0] mb-1.5">
                      Quantidade
                    </label>
                    <select
                      value={quantity}
                      onChange={(e) => setQuantity(Number(e.target.value))}
                      className="w-full rounded-xl border border-white/[0.08] bg-black/40 px-3.5 py-2 text-xs text-white focus:border-[#9D7CFF] focus:outline-none"
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n} variação{n > 1 ? "ões" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-[#B8B8C0] mb-1.5">
                    Prompt de Comando Otimizado
                  </label>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={6}
                    className="w-full rounded-xl border border-white/[0.08] bg-black/40 px-3.5 py-2.5 text-xs text-white placeholder-white/30 focus:border-[#9D7CFF] focus:outline-none focus:ring-1 focus:ring-[#9D7CFF] resize-y leading-relaxed font-sans"
                    placeholder="Escreva as instruções para a IA..."
                  />
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setPrompt(DEFAULT_PROMPT)}
                      className="text-[9px] font-semibold text-[#7B7B86] hover:text-white transition-colors cursor-pointer"
                    >
                      Resetar Prompt Padrão
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Terminal Console Logs */}
            <div className="flex flex-col gap-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#7B7B86] flex items-center gap-1.5">
                <TerminalIcon size={12} className="text-[#9D7CFF]" />
                Console do Google Flow (Logs)
              </h3>

              <div className="flex flex-col h-[280px] rounded-2xl border border-white/[0.06] bg-black/85 font-mono text-[10px] text-[#A6ACCD]">
                {/* Terminal Title Bar */}
                <div className="flex items-center gap-1.5 px-4 py-2 border-b border-white/[0.04] bg-[#0c0c0e] select-none">
                  <div className="h-2 w-2 rounded-full bg-red-500" />
                  <div className="h-2 w-2 rounded-full bg-yellow-500" />
                  <div className="h-2 w-2 rounded-full bg-green-500" />
                  <span className="text-[#4A4A54] ml-2 text-[9px] font-semibold uppercase tracking-wider">
                    Playwright Console
                  </span>
                </div>

                {/* Terminal Logs Content */}
                <div className="flex-1 overflow-y-auto p-4 space-y-2 select-text">
                  {globalLogs.length === 0 ? (
                    <div className="text-[#4A4A54] italic">
                      Nenhuma operação iniciada. Fila ociosa...
                    </div>
                  ) : (
                    globalLogs.map((log, index) => (
                      <div
                        key={index}
                        className={
                          log.includes("sucesso") || log.includes("concluído")
                            ? "text-emerald-400"
                            : log.includes("Erro") || log.includes("Falha")
                            ? "text-red-400"
                            : log.includes("Iniciando") || log.includes("Conectando")
                            ? "text-[#9D7CFF]"
                            : "text-[#B8B8C0]"
                        }
                      >
                        {log}
                      </div>
                    ))
                  )}
                  <div ref={terminalEndRef} />
                </div>
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* Side-by-Side Detail Comparison Dialog (Modal) */}
      {selectedResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md animate-fade-in">
          <div
            className="relative w-full max-w-4xl rounded-3xl border border-white/[0.08] bg-[#0c0c0e] p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/[0.06] mb-6">
              <div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                  Visualização da Estampa
                </h3>
                <p className="text-[10px] text-[#7B7B86] mt-0.5">
                  {selectedResult.name}
                </p>
              </div>
              <button
                onClick={() => setSelectedResult(null)}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-white/[0.03] border border-white/[0.08] hover:bg-white/[0.06] text-[#B8B8C0] hover:text-white transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Side by side Grid */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Original model photo */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-[#7B7B86] uppercase tracking-wider">
                  Foto Original do Modelo
                </span>
                <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/[0.06] bg-neutral-900 flex items-center justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedResult.original}
                    alt="Original Model"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              </div>

              {/* Extracted texture/print on white background */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold text-[#7B7B86] uppercase tracking-wider flex items-center gap-1">
                  Estampa Extraída (Fundo Branco)
                  <Sparkles size={10} className="text-[#9D7CFF]" />
                </span>
                <div className="relative aspect-square overflow-hidden rounded-2xl border border-white/[0.06] bg-white flex items-center justify-center p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedResult.result}
                    alt="Extracted Print"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
              </div>
            </div>

            {/* Action Bar */}
            <div className="flex justify-end gap-3 pt-6 border-t border-white/[0.06] mt-6">
              <button
                onClick={() => setSelectedResult(null)}
                className="h-10 rounded-xl px-5 text-xs font-semibold text-[#B8B8C0] hover:text-white transition-colors cursor-pointer"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  handleDownload(selectedResult.result, selectedResult.name);
                  setSelectedResult(null);
                }}
                className="flex h-10 items-center gap-2 rounded-xl px-5 text-xs font-semibold text-black bg-[#9D7CFF] hover:bg-[#b094ff] transition-colors cursor-pointer"
              >
                <Download size={14} />
                Baixar Estampa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
