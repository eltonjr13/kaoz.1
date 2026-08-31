"use client";

import React, { useEffect, useState } from "react";
import {
  UserCheck,
  Brain,
  Lightbulb,
  Briefcase,
  AlertCircle,
  RefreshCw,
  Trash2,
  ExternalLink,
  ShieldCheck,
} from "lucide-react";
import type {
  PersonalModelItem,
  PersonalModelSnapshot,
  PersonalModelEvidenceDetail,
  PersonaStyleProfile,
} from "@/lib/model-p/types";
import { EvidenceModal } from "./evidence-modal";
import { PersonaUploadModal } from "./persona-upload-modal";
import { PersonaListView } from "./persona-list-view";
import { PersonaChatPlayground } from "./persona-chat-playground";
import { MessageSquare, Sparkles } from "lucide-react";

function ConfidenceBadge({ level, score }: { level: "high" | "medium" | "low"; score: number }) {
  const percent = Math.round(score * 100);
  if (level === "high") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
        <span className="size-1.5 rounded-full bg-emerald-400" />
        Alta ({percent}%)
      </span>
    );
  }
  if (level === "medium") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
        <span className="size-1.5 rounded-full bg-amber-400" />
        Média ({percent}%)
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-zinc-500/30 bg-zinc-500/10 px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
      <span className="size-1.5 rounded-full bg-zinc-400" />
      Baixa ({percent}%)
    </span>
  );
}

function MemoryCard({
  item,
  isForgetting,
  onForget,
  onInspect,
}: {
  item: PersonalModelItem;
  isForgetting: boolean;
  onForget: (id: string) => void;
  onInspect: (item: PersonalModelItem) => void;
}) {
  return (
    <div
      key={item.id}
      className="group relative rounded-xl border border-[var(--line)] bg-[#111319] p-4 transition-all duration-200 hover:border-zinc-600/80 hover:bg-[#141720]"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium leading-snug text-zinc-100 break-words flex-1">
          {item.content}
        </p>
        <div className="shrink-0 flex items-center gap-1.5">
          <ConfidenceBadge level={item.confidenceLevel} score={item.confidenceScore} />
          <button
            type="button"
            onClick={() => onForget(item.id)}
            disabled={isForgetting}
            title="Esquecer memória"
            aria-label="Esquecer memória"
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-zinc-500 hover:text-red-400 rounded-md hover:bg-red-950/40"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/[0.04] pt-2 text-[10px] text-zinc-500">
        <span className="font-mono">
          {new Date(item.updatedAt).toLocaleDateString("pt-BR")}
        </span>
        {(item.evidence.length > 0 || item.evidenceRefsCount > 0) && (
          <button
            type="button"
            onClick={() => onInspect(item)}
            className="inline-flex items-center gap-1 text-[#a99fff] hover:text-white transition-colors"
          >
            <span>Por que acredito nisso?</span>
            <ExternalLink size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

function EmptySection({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--line)] p-6 text-center text-xs text-zinc-500 bg-[#0d0f14]/50">
      {message}
    </div>
  );
}

function ModelPCategorySection({
  title,
  subtitle,
  icon,
  items,
  emptyMessage,
  isForgettingId,
  onForget,
  onInspect,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  items: PersonalModelItem[] | undefined;
  emptyMessage: string;
  isForgettingId: string | null;
  onForget: (id: string) => void;
  onInspect: (item: PersonalModelItem) => void;
}) {
  const hasItems = items && items.length > 0;
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[#101217] p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        {icon}
        <div>
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p className="text-[11px] text-zinc-500">{subtitle}</p>
        </div>
      </div>
      <div className="space-y-2.5">
        {hasItems
          ? items.map((item) => (
              <MemoryCard
                key={item.id}
                item={item}
                isForgetting={isForgettingId === item.id}
                onForget={onForget}
                onInspect={onInspect}
              />
            ))
          : <EmptySection message={emptyMessage} />}
      </div>
    </div>
  );
}

export function ModelPDashboard() {
  const [activeTab, setActiveTab] = useState<"cognitive" | "personas">("personas");
  const [snapshot, setSnapshot] = useState<PersonalModelSnapshot | null>(null);
  const [personas, setPersonas] = useState<PersonaStyleProfile[]>([]);
  const [selectedPlaygroundPersona, setSelectedPlaygroundPersona] = useState<PersonaStyleProfile | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEvidence, setSelectedEvidence] = useState<PersonalModelEvidenceDetail | null>(null);
  const [loadingEvidence, setLoadingEvidence] = useState(false);
  const [forgetId, setForgetId] = useState<string | null>(null);

  const fetchModel = async () => {
    setLoading(true);
    setError("");
    try {
      const [resModel, resPersonas] = await Promise.all([
        fetch("/api/model-p", { cache: "no-store" }),
        fetch("/api/model-p/personas", { cache: "no-store" }),
      ]);
      const dataModel = await resModel.json();
      const dataPersonas = await resPersonas.json();

      if (resModel.ok) setSnapshot(dataModel.snapshot || null);
      if (resPersonas.ok && Array.isArray(dataPersonas.personas)) {
        setPersonas(dataPersonas.personas);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchModel();
  }, []);

  const handleDeletePersona = async (id: string) => {
    try {
      setPersonas((prev) => prev.filter((p) => p.id !== id));
      if (selectedPlaygroundPersona?.id === id) {
        setSelectedPlaygroundPersona(null);
      }
      await fetch(`/api/model-p/personas/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void fetchModel();
    }
  };

  const handleInspectEvidence = async (item: PersonalModelItem) => {
    setLoadingEvidence(true);
    try {
      const res = await fetch(`/api/model-p/evidence/${encodeURIComponent(item.id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Não foi possível recuperar evidências.");
      setSelectedEvidence(data.evidence);
    } catch {
      setSelectedEvidence({
        memoryId: item.id,
        content: item.content,
        kind: item.kind,
        confidenceScore: item.confidenceScore,
        confidenceLevel: item.confidenceLevel,
        evidenceTexts: item.evidence,
        referencedMessages: [],
      });
    } finally {
      setLoadingEvidence(false);
    }
  };

  const handleForget = async (memoryId: string) => {
    if (!window.confirm("Esquecer esta memória? O agente deixará de considerá-la.")) return;
    setForgetId(memoryId);

    if (snapshot) {
      const filterOut = (items: PersonalModelItem[]) => items.filter((i) => i.id !== memoryId);
      setSnapshot({
        ...snapshot,
        facts: filterOut(snapshot.facts),
        preferences: filterOut(snapshot.preferences),
        workStyles: filterOut(snapshot.workStyles),
        behavioralSignals: filterOut(snapshot.behavioralSignals),
        recentMemories: filterOut(snapshot.recentMemories),
        summary: {
          ...snapshot.summary,
          totalMemories: Math.max(0, snapshot.summary.totalMemories - 1),
        },
      });
    }

    try {
      const res = await fetch(`/api/model-p?memoryId=${encodeURIComponent(memoryId)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Falha ao esquecer memória.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      void fetchModel();
    } finally {
      setForgetId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-[300px] flex-col items-center justify-center p-8 text-center text-zinc-400">
        <RefreshCw size={24} className="animate-spin text-[#7C6CF2] mb-3" />
        <p className="text-sm font-medium">Carregando o modelo do usuário...</p>
        <p className="text-xs text-zinc-500 mt-1">Interpretando memórias cognitivas consolidadas</p>
      </div>
    );
  }

  const summary = snapshot?.summary;

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="rounded-2xl border border-[var(--line)] bg-[#101217] p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-[#7C6CF2]/30 bg-[#7C6CF2]/15 text-[#a99fff] shadow-[0_0_20px_rgba(124,108,242,0.2)]">
              <UserCheck size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                  Model P
                </h1>
                <span className="rounded-full bg-[#7C6CF2]/20 px-2 py-0.5 text-[10px] font-semibold text-[#a99fff] border border-[#7C6CF2]/40">
                  V1.0.1
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-400 max-w-xl leading-relaxed">
                Como o agente compreende quem você é, como pensa e como trabalha.
                Derivado continuamente do histórico de interações do Kaoz.1.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-center">
            <button
              type="button"
              onClick={() => void fetchModel()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-xs font-medium text-zinc-300 hover:bg-[var(--panel-strong)] hover:text-white transition-colors"
            >
              <RefreshCw size={13} />
              Atualizar
            </button>
          </div>
        </div>

        {summary && (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 border-t border-[var(--line)] pt-5">
            <div className="rounded-xl border border-white/[0.04] bg-[#0c0e12] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Memórias Totais
              </p>
              <p className="mt-1 text-lg font-bold text-white font-mono">
                {summary.totalMemories}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.04] bg-[#0c0e12] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Fatos & Identidade
              </p>
              <p className="mt-1 text-lg font-bold text-white font-mono">
                {summary.factsCount}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.04] bg-[#0c0e12] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Preferências
              </p>
              <p className="mt-1 text-lg font-bold text-white font-mono">
                {summary.preferencesCount}
              </p>
            </div>

            <div className="rounded-xl border border-white/[0.04] bg-[#0c0e12] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                Confiança Média
              </p>
              <p className="mt-1 text-lg font-bold text-white font-mono">
                {Math.round(summary.averageConfidence * 100)}%
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-b border-[var(--line)] pb-3">
        <button
          type="button"
          onClick={() => { setActiveTab("personas"); setSelectedPlaygroundPersona(null); }}
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
            activeTab === "personas"
              ? "bg-[#7C6CF2] text-white shadow-sm"
              : "text-zinc-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Sparkles size={14} />
          <span>Réplicas de Estilo (WhatsApp & Chats)</span>
          <span className="rounded-full bg-black/30 px-1.5 py-0.2 text-[10px]">
            {personas.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("cognitive")}
          className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-xs font-semibold transition-all ${
            activeTab === "cognitive"
              ? "bg-[#7C6CF2] text-white shadow-sm"
              : "text-zinc-400 hover:text-white hover:bg-white/5"
          }`}
        >
          <Brain size={14} />
          <span>Memória Cognitiva do Usuário</span>
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-800/60 bg-red-950/50 p-4 text-xs text-red-300 flex items-center gap-2">
          <AlertCircle size={15} />
          <span>{error}</span>
        </div>
      )}

      {activeTab === "personas" ? (
        <PersonasTabContent
          personas={personas}
          selectedPlaygroundPersona={selectedPlaygroundPersona}
          onBackFromPlayground={() => setSelectedPlaygroundPersona(null)}
          onOpenUpload={() => setIsUploadModalOpen(true)}
          onSelectPlayground={(p) => setSelectedPlaygroundPersona(p)}
          onDeletePersona={handleDeletePersona}
        />
      ) : (
        <CognitiveMemoryGrid
          snapshot={snapshot}
          forgetId={forgetId}
          onForget={handleForget}
          onInspect={handleInspectEvidence}
        />
      )}

      <PersonaUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onPersonaCreated={(newPersona) => {
          setPersonas((prev) => [newPersona, ...prev]);
          setSelectedPlaygroundPersona(newPersona);
        }}
      />

      <EvidenceModal
        evidence={selectedEvidence}
        loading={loadingEvidence}
        onClose={() => setSelectedEvidence(null)}
      />
    </div>
  );
}

function CognitiveMemoryGrid({
  snapshot,
  forgetId,
  onForget,
  onInspect,
}: {
  snapshot: PersonalModelSnapshot | null;
  forgetId: string | null;
  onForget: (id: string) => void;
  onInspect: (item: PersonalModelItem) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <ModelPCategorySection
        title="Perfil & Fatos"
        subtitle="O que o agente sabe de concreto sobre você"
        icon={
          <div className="rounded-lg bg-blue-500/10 p-1.5 text-blue-400 border border-blue-500/20">
            <Brain size={16} />
          </div>
        }
        items={snapshot?.facts}
        emptyMessage="Nenhum fato pessoal assimilado ainda."
        isForgettingId={forgetId}
        onForget={onForget}
        onInspect={onInspect}
      />

      <ModelPCategorySection
        title="Como Você Pensa"
        subtitle="Preferências pessoais e estéticas aprendidas"
        icon={
          <div className="rounded-lg bg-purple-500/10 p-1.5 text-purple-400 border border-purple-500/20">
            <Lightbulb size={16} />
          </div>
        }
        items={snapshot?.preferences}
        emptyMessage="Nenhuma preferência assimilada ainda."
        isForgettingId={forgetId}
        onForget={onForget}
        onInspect={onInspect}
      />

      <ModelPCategorySection
        title="Como Você Trabalha"
        subtitle="Regras de fluxo, projetos e tecnologias"
        icon={
          <div className="rounded-lg bg-emerald-500/10 p-1.5 text-emerald-400 border border-emerald-500/20">
            <Briefcase size={16} />
          </div>
        }
        items={snapshot?.workStyles}
        emptyMessage="Nenhuma regra de trabalho assimilada ainda."
        isForgettingId={forgetId}
        onForget={onForget}
        onInspect={onInspect}
      />

      <ModelPCategorySection
        title="Sinais Comportamentais"
        subtitle="Correções e limites assimilados de conversas"
        icon={
          <div className="rounded-lg bg-amber-500/10 p-1.5 text-amber-400 border border-amber-500/20">
            <ShieldCheck size={16} />
          </div>
        }
        items={snapshot?.behavioralSignals}
        emptyMessage="Nenhum sinal comportamental registrado ainda."
        isForgettingId={forgetId}
        onForget={onForget}
        onInspect={onInspect}
      />
    </div>
  );
}

function PersonasTabContent({
  personas,
  selectedPlaygroundPersona,
  onBackFromPlayground,
  onOpenUpload,
  onSelectPlayground,
  onDeletePersona,
}: {
  personas: PersonaStyleProfile[];
  selectedPlaygroundPersona: PersonaStyleProfile | null;
  onBackFromPlayground: () => void;
  onOpenUpload: () => void;
  onSelectPlayground: (p: PersonaStyleProfile) => void;
  onDeletePersona: (id: string) => void;
}) {
  if (selectedPlaygroundPersona) {
    return (
      <PersonaChatPlayground
        persona={selectedPlaygroundPersona}
        onBack={onBackFromPlayground}
      />
    );
  }

  return (
    <PersonaListView
      personas={personas}
      onOpenUpload={onOpenUpload}
      onSelectPlayground={onSelectPlayground}
      onDeletePersona={onDeletePersona}
    />
  );
}
