"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { motion } from "framer-motion";
import { Brain, CheckCircle2, ChevronDown, ChevronUp, Crown, FileText, Loader2, Palette, PenLine, SearchCheck, ShieldCheck, Target, Users } from "lucide-react";
import { RichMarkdown } from "@/components/markdown/RichMarkdown";
import type { WarRoomMessage, WarRoomSession, WarRoomArtifactReference } from "@/services/agents";
import type { ExecutionArtifact } from "@/services/orchestrator/orchestrator.types";

interface WarRoomFeedProps {
  session?: WarRoomSession;
  messages: WarRoomMessage[];
  isStreaming?: boolean;
  onOpenArtifact?: (artifact: ExecutionArtifact | WarRoomArtifactReference) => void;
}

type StageDefinition = { label: string; shortLabel: string; role: string; icon: ComponentType<{ size?: number; className?: string }>; color: string };

const STAGES: readonly StageDefinition[] = [
  { label: "Direção estratégica", shortLabel: "Estratégia", role: "campaign-director", icon: Crown, color: "#A78BFA" },
  { label: "Estratégia de público", shortLabel: "Audiência", role: "audience-strategist", icon: Target, color: "#38BDF8" },
  { label: "Governança de marca", shortLabel: "Marca", role: "brand-governance", icon: ShieldCheck, color: "#34D399" },
  { label: "Copy e roteiro", shortLabel: "Copy", role: "copywriter", icon: PenLine, color: "#F59E0B" },
  { label: "Direção visual", shortLabel: "Visual", role: "visual-director", icon: Palette, color: "#F472B6" },
  { label: "Auditoria criativa", shortLabel: "Revisão", role: "creative-reviewer", icon: SearchCheck, color: "#2DD4BF" },
];

function stageForMessage(message: WarRoomMessage, index: number): StageDefinition {
  return STAGES.find((stage) => stage.role === message.agentRole) || STAGES[index] || STAGES[0];
}

function reviewPresentation(status: WarRoomSession["review"] extends infer T ? T : never) {
  if (status?.status === "approved") return { label: "Consenso alcançado", className: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" };
  if (status?.status === "needs_revision") return { label: "Revisão necessária", className: "border-amber-400/20 bg-amber-400/10 text-amber-200" };
  return { label: "Em análise", className: "border-violet-400/20 bg-violet-400/10 text-violet-200" };
}

function WarRoomHeader({ session, messageCount, totalStages, isStreaming }: { session?: WarRoomSession; messageCount: number; totalStages: number; isStreaming?: boolean }) {
  const review = reviewPresentation(session?.review);
  return (
    <header className="border-b border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.16),transparent_42%)] px-5 py-5 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-violet-400/25 bg-violet-400/10 text-violet-300"><Users size={20} /></div>
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Sala de Guerra</span>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium ${review.className}`}>
                {isStreaming ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}{review.label}
              </span>
            </div>
            <h2 className="max-w-3xl text-base font-semibold leading-snug text-zinc-50 sm:text-lg">{session?.topic || "Alinhamento criativo e estratégico"}</h2>
            <p className="mt-1 text-xs text-zinc-500">Decisões organizadas por especialista, com artefatos e justificativas rastreáveis.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-400">
          <span className="font-mono font-semibold text-zinc-100">{messageCount}/{totalStages}</span><span>etapas concluídas</span>
        </div>
      </div>
    </header>
  );
}

function stageButtonClass(hasMessage: boolean, isActive: boolean, isCurrent: boolean): string {
  if (isActive) return "border-violet-400/35 bg-violet-400/12 text-white shadow-lg shadow-violet-950/20";
  if (hasMessage) return "border-white/[0.07] bg-white/[0.03] text-zinc-400 hover:border-white/15 hover:bg-white/[0.06] hover:text-zinc-100";
  if (isCurrent) return "animate-pulse border-violet-400/20 bg-violet-400/[0.06] text-violet-300";
  return "cursor-default border-transparent bg-transparent text-zinc-700";
}

function StageNavigation({ messages, activeIndex, isStreaming, onSelect }: { messages: WarRoomMessage[]; activeIndex: number; isStreaming?: boolean; onSelect: (message: WarRoomMessage) => void }) {
  return (
    <nav className="grid grid-cols-2 gap-2 border-b border-white/10 bg-black/20 p-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Especialistas da Sala de Guerra">
      {STAGES.map((stage, index) => {
        const StageIcon = stage.icon;
        const message = messages[index];
        const isActive = Boolean(message) && index === activeIndex;
        const isCurrent = !message && index === messages.length && Boolean(isStreaming);
        return (
          <button key={stage.role} type="button" disabled={!message} onClick={() => message && onSelect(message)} className={`group flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-all ${stageButtonClass(Boolean(message), isActive, isCurrent)}`}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${stage.color}18`, color: stage.color }}>
              {isCurrent ? <Loader2 size={14} className="animate-spin" /> : <StageIcon size={14} />}
            </span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium">{stage.shortLabel}</span>
            {message && <CheckCircle2 size={11} className={isActive ? "text-emerald-300" : "text-emerald-500/60"} />}
          </button>
        );
      })}
    </nav>
  );
}

function ThoughtPanel({ thought }: { thought: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.025]">
      <button type="button" onClick={() => setIsOpen((value) => !value)} className="flex w-full items-center justify-between px-3.5 py-3 text-left text-xs text-zinc-400 hover:text-zinc-200">
        <span className="flex items-center gap-2"><Brain size={14} className="text-violet-300" /> Raciocínio estratégico</span>{isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {isOpen && <p className="border-t border-white/[0.07] px-4 py-3 text-xs leading-5 text-zinc-400">{thought}</p>}
    </div>
  );
}

function ArtifactLinks({ artifacts, onOpen }: { artifacts: readonly WarRoomArtifactReference[]; onOpen?: (artifact: ExecutionArtifact | WarRoomArtifactReference) => void }) {
  if (!artifacts.length) return null;
  return (
    <div className="mt-6 border-t border-white/10 pt-4">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Entregáveis desta etapa</p>
      <div className="flex flex-wrap gap-2">{artifacts.map((artifact) => (
        <button key={artifact.id} type="button" onClick={() => onOpen?.(artifact)} className="flex min-w-0 items-center gap-2 rounded-xl border border-violet-400/20 bg-violet-400/[0.07] px-3 py-2 text-left text-xs text-zinc-200 hover:border-violet-400/40 hover:bg-violet-400/10">
          <FileText size={14} className="shrink-0 text-violet-300" /><span className="max-w-[240px] truncate font-mono text-[11px]">{artifact.name}</span><span className="text-[10px] font-medium text-violet-300">Abrir</span>
        </button>
      ))}</div>
    </div>
  );
}

function ActiveMessagePanel({ message, index, totalStages, onOpenArtifact }: { message?: WarRoomMessage; index: number; totalStages: number; onOpenArtifact?: (artifact: ExecutionArtifact | WarRoomArtifactReference) => void }) {
  if (!message) return <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin text-violet-300" /> Preparando a primeira análise...</div>;
  const stage = stageForMessage(message, index);
  const ActiveIcon = stage.icon;
  return (
    <motion.article key={message.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-start gap-3 border-b border-white/10 pb-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ borderColor: `${stage.color}35`, backgroundColor: `${stage.color}12`, color: stage.color }}><ActiveIcon size={18} /></div>
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="text-sm font-semibold text-zinc-50">{message.agentName}</h3><span className="text-xs text-zinc-500">{stage.label}</span></div><p className="mt-1 text-[11px] uppercase tracking-wider text-zinc-600">Etapa {message.stageNumber || index + 1} de {totalStages}</p></div>
      </div>
      {message.thought && <ThoughtPanel key={message.id} thought={message.thought} />}
      <RichMarkdown content={message.content} />
      <ArtifactLinks artifacts={message.artifactsProduced || []} onOpen={onOpenArtifact} />
      {message.generationMode === "synthetic_fallback" && <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/[0.08] px-3 py-2.5 text-xs text-amber-100">Execução degradada: {message.warning || "conteúdo sintético local utilizado."}</div>}
    </motion.article>
  );
}

export function WarRoomFeed({ session, messages, isStreaming, onOpenArtifact }: WarRoomFeedProps) {
  const [activeMessageId, setActiveMessageId] = useState("");
  useEffect(() => {
    const latest = messages.at(-1);
    if (latest && (!activeMessageId || isStreaming)) setActiveMessageId(latest.id);
  }, [activeMessageId, isStreaming, messages]);
  const activeIndex = useMemo(() => {
    const index = messages.findIndex((message) => message.id === activeMessageId);
    return index >= 0 ? index : Math.max(0, messages.length - 1);
  }, [activeMessageId, messages]);
  const totalStages = session?.totalStages || STAGES.length;
  return (
    <section className="my-3 w-full overflow-hidden rounded-3xl border border-white/10 bg-[#090a0f]/95 text-white shadow-2xl shadow-black/40 backdrop-blur-xl">
      <WarRoomHeader session={session} messageCount={messages.length} totalStages={totalStages} isStreaming={isStreaming} />
      <StageNavigation messages={messages} activeIndex={activeIndex} isStreaming={isStreaming} onSelect={(message) => setActiveMessageId(message.id)} />
      <div className="p-4 sm:p-6"><ActiveMessagePanel message={messages[activeIndex]} index={activeIndex} totalStages={totalStages} onOpenArtifact={onOpenArtifact} /></div>
    </section>
  );
}
