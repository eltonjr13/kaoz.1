"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Check,
  Code2,
  Copy,
  Download,
  Edit3,
  Eye,
  File,
  FileCode,
  FileJson,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  Save,
  Sparkles,
  Trash2,
  X,
  RefreshCw,
  Play,
  Volume2,
  Film,
  Sliders,
  Clapperboard,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ExecutionArtifact } from "@/services/orchestrator/orchestrator.types";
import type { WarRoomArtifactReference } from "@/services/agents";

export interface LiveCanvasArtifactItem {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly mimeType?: string;
  readonly url?: string;
  readonly content?: string;
  readonly size?: number;
  readonly updatedAt?: string;
}

interface LiveArtifactCanvasProps {
  isOpen: boolean;
  onClose: () => void;
  artifacts: (ExecutionArtifact | WarRoomArtifactReference | LiveCanvasArtifactItem)[];
  activeArtifactId?: string;
  onSelectArtifact?: (id: string) => void;
  onArtifactUpdated?: (artifact: ExecutionArtifact) => void;
  onCampaignProduced?: (job: any) => void;
}

function getArtifactIcon(type: string, name: string) {
  if (type === "image" || name.endsWith(".png") || name.endsWith(".jpg")) return <ImageIcon size={15} />;
  if (type === "json" || name.endsWith(".json")) return <FileJson size={15} />;
  if (type === "code" || name.endsWith(".ts") || name.endsWith(".js") || name.endsWith(".py")) return <FileCode size={15} />;
  return <FileText size={15} />;
}

export function LiveArtifactCanvas({
  isOpen,
  onClose,
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  onArtifactUpdated,
  onCampaignProduced,
}: LiveArtifactCanvasProps) {
  const normalizedArtifacts: LiveCanvasArtifactItem[] = useMemo(() => {
    return artifacts.map((art) => ({
      id: art.id,
      name: art.name,
      type: (art as ExecutionArtifact).type || "markdown",
      mimeType: (art as ExecutionArtifact).mimeType || "text/markdown",
      url: (art as ExecutionArtifact).url || `/api/artifacts/${art.id}`,
      content: (art as { content?: string }).content,
      size: (art as ExecutionArtifact).size,
      updatedAt: (art as ExecutionArtifact).updatedAt,
    }));
  }, [artifacts]);

  const [selectedId, setSelectedId] = useState<string>("");
  const [editorContent, setEditorContent] = useState<string>("");
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [loadingContent, setLoadingContent] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [showProductionModal, setShowProductionModal] = useState<boolean>(false);
  const [isProducing, setIsProducing] = useState<boolean>(false);
  const [productionJob, setProductionJob] = useState<any | null>(null);
  const [generateImages, setGenerateImages] = useState<boolean>(true);
  const [generateAudio, setGenerateAudio] = useState<boolean>(true);
  const [createDavinciPlan, setCreateDavinciPlan] = useState<boolean>(true);
  const [selectedAspectRatio, setSelectedAspectRatio] = useState<"9:16" | "16:9" | "1:1">("9:16");
  const [productionError, setProductionError] = useState<string | null>(null);
  const [playingAudioUrl, setPlayingAudioUrl] = useState<string | null>(null);

  // Sync selected artifact
  useEffect(() => {
    if (activeArtifactId && normalizedArtifacts.some((a) => a.id === activeArtifactId)) {
      setSelectedId(activeArtifactId);
    } else if (normalizedArtifacts.length > 0 && (!selectedId || !normalizedArtifacts.some((a) => a.id === selectedId))) {
      setSelectedId(normalizedArtifacts[0].id);
    }
  }, [activeArtifactId, normalizedArtifacts, selectedId]);

  const currentArtifact = useMemo(() => {
    return normalizedArtifacts.find((a) => a.id === selectedId) || normalizedArtifacts[0];
  }, [normalizedArtifacts, selectedId]);

  // Load artifact content when selected
  useEffect(() => {
    if (!currentArtifact) return;

    // If content is already in memory
    if (currentArtifact.content) {
      setEditorContent(currentArtifact.content);
      setError(null);
      return;
    }

    if (!currentArtifact.url) return;

    const controller = new AbortController();
    setLoadingContent(true);
    setError(null);

    fetch(currentArtifact.url, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Falha ao ler artefato (${res.status})`);
        return res.text();
      })
      .then((text) => {
        setEditorContent(text);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoadingContent(false));

    return () => controller.abort();
  }, [currentArtifact]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(editorContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleSave = async () => {
    if (!currentArtifact) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(currentArtifact.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: editorContent,
          name: currentArtifact.name,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erro ao salvar alterações.");
      setIsEditing(false);
      if (onArtifactUpdated && data.artifact) {
        onArtifactUpdated(data.artifact);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleStartProduction = async () => {
    setIsProducing(true);
    setProductionError(null);
    try {
      const res = await fetch("/api/campaigns/produce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifacts: normalizedArtifacts.map((a) => ({
            filename: a.name,
            title: a.name,
            content: a.id === currentArtifact?.id ? editorContent : a.content,
          })),
          artifactIds: normalizedArtifacts.map((a) => a.id),
          options: {
            generateImages,
            generateAudio,
            createDavinciPlan,
            aspectRatio: selectedAspectRatio,
          },
          sync: true,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Falha ao produzir campanha.");
      }
      setProductionJob(data.job);
      onCampaignProduced?.(data.job);
    } catch (err: any) {
      setProductionError(err?.message || "Erro na produção de campanha.");
    } finally {
      setIsProducing(false);
    }
  };

  if (!isOpen || normalizedArtifacts.length === 0) return null;

  return (
    <div
      className={`fixed z-50 flex flex-col bg-[#0a0a0e]/95 backdrop-blur-2xl border-l border-white/10 text-white shadow-2xl transition-all duration-300 ${
        isFullScreen
          ? "inset-0 w-full h-full"
          : "inset-y-0 right-0 w-full sm:w-[560px] md:w-[680px] lg:w-[760px]"
      }`}
    >
      {/* Top Header */}
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3 bg-gradient-to-r from-[#12131b] to-[#0a0a0e]">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#9D7CFF]/15 text-[#9D7CFF] border border-[#9D7CFF]/30">
            <Sparkles size={16} />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#9D7CFF]">
              Live Artifact Canvas
            </h2>
            <p className="text-[11px] text-white/50 truncate">
              {normalizedArtifacts.length} {normalizedArtifacts.length === 1 ? "documento disponível" : "documentos gerados"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowProductionModal(true)}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#9D7CFF] to-[#7B5AFF] text-white px-3 py-1.5 text-xs font-semibold hover:from-[#A88BFF] hover:to-[#8C6DFF] transition-all shadow-md shadow-[#9D7CFF]/20 cursor-pointer"
            title="Produzir Campanha Multimídia em 1 Clique"
          >
            <Clapperboard size={14} />
            <span>Produzir Campanha</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFullScreen((prev) => !prev)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            title={isFullScreen ? "Restaurar tamanho" : "Tela cheia"}
          >
            {isFullScreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white transition-colors"
            title="Fechar Canvas"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/5 bg-black/40 px-3 py-2 scrollbar-thin">
        {normalizedArtifacts.map((art) => {
          const isSelected = art.id === selectedId;
          return (
            <button
              key={art.id}
              type="button"
              onClick={() => {
                setSelectedId(art.id);
                onSelectArtifact?.(art.id);
              }}
              className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs transition-all whitespace-nowrap ${
                isSelected
                  ? "bg-[#9D7CFF]/20 text-white font-medium border border-[#9D7CFF]/40 shadow-sm"
                  : "text-white/50 hover:bg-white/[0.05] hover:text-white/80 border border-transparent"
              }`}
            >
              <span className={isSelected ? "text-[#9D7CFF]" : "text-white/40"}>
                {getArtifactIcon(art.type, art.name)}
              </span>
              <span className="truncate max-w-[150px]">{art.name}</span>
            </button>
          );
        })}
      </div>

      {/* Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-4 py-2 bg-black/20 text-xs">
        <div className="flex items-center gap-2">
          {/* Mode Switcher */}
          <div className="flex items-center rounded-lg bg-white/[0.04] p-0.5 border border-white/5">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all ${
                !isEditing
                  ? "bg-[#9D7CFF]/25 text-white font-medium shadow-sm"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              <Eye size={13} />
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-all ${
                isEditing
                  ? "bg-[#9D7CFF]/25 text-white font-medium shadow-sm"
                  : "text-white/50 hover:text-white/80"
              }`}
            >
              <Edit3 size={13} />
              <span>Editor</span>
            </button>
          </div>

          {currentArtifact?.size && (
            <span className="text-[11px] text-white/40 font-mono hidden sm:inline">
              {(currentArtifact.size / 1024).toFixed(1)} KB
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {isEditing && (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-3 py-1 text-xs font-medium hover:bg-emerald-500/30 transition-all disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              <span>Salvar</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-all"
            title="Copiar texto"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            <span>{copied ? "Copiado" : "Copiar"}</span>
          </button>

          {currentArtifact?.url && (
            <a
              href={`${currentArtifact.url}${currentArtifact.url.includes("?") ? "&" : "?"}download=true`}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs text-white/70 hover:bg-white/10 hover:text-white transition-all no-underline"
              title="Baixar arquivo"
            >
              <Download size={13} />
              <span>Baixar</span>
            </a>
          )}
        </div>
      </div>

      {/* Editor / Preview Content Body */}
      <div className="min-h-0 flex-1 overflow-auto bg-[#0d0e14] p-4 sm:p-6">
        {loadingContent ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-white/50">
            <Loader2 size={16} className="animate-spin text-[#9D7CFF]" />
            Carregando documento...
          </div>
        ) : error ? (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-xs text-red-300">
            {error}
          </div>
        ) : isEditing ? (
          <textarea
            value={editorContent}
            onChange={(e) => setEditorContent(e.target.value)}
            className="h-full w-full resize-none rounded-xl border border-white/10 bg-black/40 p-4 font-mono text-xs text-white/90 focus:border-[#9D7CFF]/50 focus:outline-none leading-relaxed"
            placeholder="Conteúdo do documento..."
          />
        ) : (
          <article className="prose prose-invert prose-sm max-w-none text-white/85 leading-relaxed prose-headings:text-white prose-a:text-[#9D7CFF] prose-code:text-[#38BDF8] prose-pre:bg-black/60 prose-pre:border prose-pre:border-white/10">
            <ReactMarkdown>{editorContent}</ReactMarkdown>
          </article>
        )}
      </div>

      {/* Footer Status */}
      <div className="flex items-center justify-between border-t border-white/5 bg-black/30 px-4 py-2 text-[11px] text-white/40">
        <span className="font-mono">{currentArtifact?.name || "Sem arquivo"}</span>
        <span>{editorContent.length} caracteres</span>
      </div>

      {/* ── Central de Produção Automatizada Modal / Overlay ── */}
      {showProductionModal && (
        <div className="absolute inset-0 z-50 flex flex-col bg-[#0c0d12]/98 backdrop-blur-2xl p-5 overflow-auto">
          {/* Header Modal */}
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#9D7CFF]/20 text-[#9D7CFF] border border-[#9D7CFF]/40">
                <Clapperboard size={20} />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  Central de Produção Automatizada
                  <span className="rounded-full bg-[#9D7CFF]/20 px-2 py-0.5 text-[10px] font-semibold text-[#9D7CFF]">
                    One-Click Pipeline
                  </span>
                </h3>
                <p className="text-xs text-white/50">
                  Transforme os roteiros e prompts deste Canvas em imagens, locuções e timeline do DaVinci.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowProductionModal(false)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          {/* Body Modal */}
          <div className="my-5 flex-1 space-y-5">
            {/* Options Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
                generateImages ? "bg-[#9D7CFF]/15 border-[#9D7CFF]/40 text-white" : "bg-white/[0.02] border-white/5 text-white/50"
              }`}>
                <input
                  type="checkbox"
                  checked={generateImages}
                  onChange={(e) => setGenerateImages(e.target.checked)}
                  className="mt-1 rounded accent-[#9D7CFF]"
                />
                <div>
                  <div className="text-xs font-semibold">🖼️ Gerar Imagens</div>
                  <div className="text-[11px] text-white/60">Gera imagens para cada cena via Flow</div>
                </div>
              </label>

              <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
                generateAudio ? "bg-[#9D7CFF]/15 border-[#9D7CFF]/40 text-white" : "bg-white/[0.02] border-white/5 text-white/50"
              }`}>
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(e) => setGenerateAudio(e.target.checked)}
                  className="mt-1 rounded accent-[#9D7CFF]"
                />
                <div>
                  <div className="text-xs font-semibold">🎙️ Sintetizar Vozes</div>
                  <div className="text-[11px] text-white/60">Sintetiza as falas do roteiro em áudio</div>
                </div>
              </label>

              <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-all ${
                createDavinciPlan ? "bg-[#9D7CFF]/15 border-[#9D7CFF]/40 text-white" : "bg-white/[0.02] border-white/5 text-white/50"
              }`}>
                <input
                  type="checkbox"
                  checked={createDavinciPlan}
                  onChange={(e) => setCreateDavinciPlan(e.target.checked)}
                  className="mt-1 rounded accent-[#9D7CFF]"
                />
                <div>
                  <div className="text-xs font-semibold">🎞️ Timeline DaVinci</div>
                  <div className="text-[11px] text-white/60">Cria plano com marcadores sincronizados</div>
                </div>
              </label>
            </div>

            {/* Aspect Ratio Selector */}
            <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/30 p-3 text-xs">
              <span className="text-white/70 font-medium">Proporção dos Vídeos / Imagens:</span>
              <div className="flex items-center gap-2">
                {(["9:16", "16:9", "1:1"] as const).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    onClick={() => setSelectedAspectRatio(ratio)}
                    className={`rounded-lg px-3 py-1 text-xs font-medium transition-all ${
                      selectedAspectRatio === ratio
                        ? "bg-[#9D7CFF] text-white shadow-md shadow-[#9D7CFF]/20"
                        : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    {ratio} {ratio === "9:16" ? "(Reels/TikTok)" : ratio === "16:9" ? "(YouTube)" : "(Feed)"}
                  </button>
                ))}
              </div>
            </div>

            {/* Error Message */}
            {productionError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300 flex items-center gap-2">
                <AlertCircle size={15} />
                <span>{productionError}</span>
              </div>
            )}

            {/* Production Progress */}
            {isProducing && (
              <div className="rounded-2xl border border-[#9D7CFF]/30 bg-[#9D7CFF]/10 p-4 space-y-3">
                <div className="flex items-center justify-between text-xs font-medium text-[#9D7CFF]">
                  <span className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" />
                    Produzindo campanha multimídia...
                  </span>
                  <span>Aguarde a finalização</span>
                </div>
                <div className="h-2 w-full rounded-full bg-black/40 overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-[#9D7CFF] to-[#00F0FF] animate-pulse w-3/4 rounded-full" />
                </div>
              </div>
            )}

            {/* Production Results Gallery */}
            {productionJob && productionJob.assets && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-white/80 flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-400" />
                    Ativos Produzidos ({productionJob.assets.length} Cenas)
                  </h4>
                  {productionJob.davinciPlan && (
                    <span className="text-[11px] text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-full px-2.5 py-0.5">
                      Timeline DaVinci Pronta
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {productionJob.assets.map((asset: any) => (
                    <div
                      key={asset.sceneNumber}
                      className="rounded-xl border border-white/10 bg-black/40 overflow-hidden flex flex-col"
                    >
                      {/* Image Preview */}
                      <div className="aspect-[9/16] max-h-[220px] bg-black/60 relative overflow-hidden flex items-center justify-center border-b border-white/5">
                        {asset.imageUrl ? (
                          <img
                            src={asset.imageUrl}
                            alt={asset.title}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="text-center p-4 text-xs text-white/40">
                            Sem imagem
                          </div>
                        )}
                        <span className="absolute top-2 left-2 rounded-md bg-black/70 backdrop-blur-md px-2 py-0.5 text-[10px] font-bold text-white">
                          Cena {asset.sceneNumber}
                        </span>
                      </div>

                      {/* Scene Info & Audio Player */}
                      <div className="p-3 flex-1 flex flex-col justify-between space-y-2">
                        <div>
                          <div className="text-xs font-semibold text-white truncate">{asset.title}</div>
                          <p className="text-[11px] text-white/60 line-clamp-2 mt-0.5">{asset.voiceoverText}</p>
                        </div>

                        {asset.audioUrl && (
                          <div className="pt-2 border-t border-white/5">
                            <audio controls src={asset.audioUrl} className="w-full h-8" />
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer Modal Action */}
          <div className="flex items-center justify-between border-t border-white/10 pt-4">
            <button
              type="button"
              onClick={() => setShowProductionModal(false)}
              className="rounded-xl px-4 py-2 text-xs text-white/60 hover:bg-white/10 hover:text-white"
            >
              Fechar
            </button>

            <button
              type="button"
              onClick={handleStartProduction}
              disabled={isProducing || (!generateImages && !generateAudio && !createDavinciPlan)}
              className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#9D7CFF] to-[#7B5AFF] text-white px-5 py-2 text-xs font-bold hover:from-[#A88BFF] hover:to-[#8C6DFF] transition-all shadow-lg shadow-[#9D7CFF]/25 disabled:opacity-50 cursor-pointer"
            >
              {isProducing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Produzindo...</span>
                </>
              ) : (
                <>
                  <Play size={14} />
                  <span>{productionJob ? "Produzir Novamente" : "Iniciar Produção de Ativos"}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
