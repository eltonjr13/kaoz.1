"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Eye, File, FileJson, FileText, Loader2, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { ExecutionArtifact } from "@/services/orchestrator/orchestrator.types";

function withDownload(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=true`;
}

function artifactUrl(artifact: ExecutionArtifact): string {
  if (artifact.url) return artifact.url;
  return artifact.path ? `/api/orchestrator/artifacts?path=${encodeURIComponent(artifact.path)}` : "";
}

function canPreview(artifact: ExecutionArtifact): boolean {
  if (typeof artifact.previewAvailable === "boolean") return artifact.previewAvailable;
  const mime = artifact.mimeType || "";
  return mime === "application/pdf" || mime.startsWith("text/") || mime.startsWith("application/json");
}

function formatSize(size?: number): string {
  if (!size || size < 1) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function artifactIcon(artifact: ExecutionArtifact) {
  if (artifact.type === "json") return <FileJson size={17} />;
  if (["markdown", "pdf", "document", "text", "csv", "html"].includes(artifact.type)) return <FileText size={17} />;
  return <File size={17} />;
}

function isTextPreview(artifact: ExecutionArtifact): boolean {
  const mime = artifact.mimeType || "";
  return artifact.type !== "html" && artifact.type !== "pdf" && (mime.startsWith("text/") || mime.startsWith("application/json"));
}

function ArtifactPreview({ artifact, onClose }: { artifact: ExecutionArtifact; onClose: () => void }) {
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(isTextPreview(artifact));
  const [error, setError] = useState("");
  const url = artifact.url || "";

  useEffect(() => {
    if (!isTextPreview(artifact) || !url) return;
    const controller = new AbortController();
    setLoading(true);
    fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Falha ao abrir o arquivo (HTTP ${response.status}).`);
        return response.text();
      })
      .then(setContent)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [artifact, url]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={`Visualização de ${artifact.name}`}>
      <div className="flex h-[min(900px,92vh)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0a0a0e] shadow-2xl">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <span className="text-[#9D7CFF]">{artifactIcon(artifact)}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{artifact.name}</div>
            <div className="text-[10px] uppercase tracking-wide text-white/40">{artifact.mimeType || artifact.type}</div>
          </div>
          {url && (
            <a href={withDownload(url)} className="rounded-lg border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Baixar arquivo">
              <Download size={16} />
            </a>
          )}
          <button type="button" onClick={onClose} className="rounded-lg border border-white/10 p-2 text-white/60 hover:bg-white/10 hover:text-white" aria-label="Fechar visualização">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-[#111116]">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-white/50"><Loader2 size={16} className="animate-spin" /> Carregando documento...</div>
          ) : error ? (
            <div className="flex h-full items-center justify-center p-8 text-sm text-red-300">{error}</div>
          ) : artifact.type === "pdf" || artifact.mimeType === "application/pdf" ? (
            <iframe title={artifact.name} src={url} className="h-full min-h-[70vh] w-full border-0 bg-white" />
          ) : artifact.type === "html" || artifact.mimeType?.startsWith("text/html") ? (
            <iframe title={artifact.name} src={url} sandbox="" className="h-full min-h-[70vh] w-full border-0 bg-white" />
          ) : artifact.type === "markdown" || artifact.mimeType?.startsWith("text/markdown") ? (
            <article className="prose prose-invert mx-auto max-w-4xl p-6 text-sm prose-pre:border prose-pre:border-white/10 prose-pre:bg-black/40 sm:p-10"><ReactMarkdown>{content}</ReactMarkdown></article>
          ) : (
            <pre className="min-h-full whitespace-pre-wrap break-words p-6 font-mono text-xs leading-relaxed text-white/80 sm:p-10">{content}</pre>
          )}
        </div>
      </div>
    </div>
  );
}

export function ArtifactCards({ artifacts, className = "" }: { artifacts: ExecutionArtifact[]; className?: string }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeArtifact = useMemo(() => artifacts.find((artifact) => artifact.id === activeId) || null, [activeId, artifacts]);

  if (!artifacts.length) return null;
  return (
    <>
      <div className={`grid w-full gap-2 sm:grid-cols-2 ${className}`}>
        {artifacts.map((artifact) => {
          const url = artifactUrl(artifact);
          return (
            <div key={artifact.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-black/25 p-3">
              <span className="rounded-lg bg-[#9D7CFF]/15 p-2 text-[#9D7CFF]">{artifactIcon(artifact)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium text-white/90">{artifact.name}</div>
                <div className="mt-0.5 text-[9px] uppercase tracking-wide text-white/35">{artifact.type}{artifact.size ? ` · ${formatSize(artifact.size)}` : ""}</div>
              </div>
              {canPreview(artifact) && url && (
                <button type="button" onClick={() => setActiveId(artifact.id)} className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label={`Visualizar ${artifact.name}`}>
                  <Eye size={15} />
                </button>
              )}
              {url && (
                <a href={withDownload(url)} className="rounded-lg p-2 text-white/50 hover:bg-white/10 hover:text-white" aria-label={`Baixar ${artifact.name}`}>
                  <Download size={15} />
                </a>
              )}
            </div>
          );
        })}
      </div>
      {activeArtifact && <ArtifactPreview artifact={activeArtifact} onClose={() => setActiveId(null)} />}
    </>
  );
}
