"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileText,
  Loader2,
  Sparkles,
  Users,
  ShieldCheck,
  Zap,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { WarRoomMessage, WarRoomSession, WarRoomArtifactReference } from "@/services/agents";
import type { ExecutionArtifact } from "@/services/orchestrator/orchestrator.types";

interface WarRoomFeedProps {
  session?: WarRoomSession;
  messages: WarRoomMessage[];
  isStreaming?: boolean;
  onOpenArtifact?: (artifact: ExecutionArtifact | WarRoomArtifactReference) => void;
}

export function WarRoomFeed({
  session,
  messages,
  isStreaming,
  onOpenArtifact,
}: WarRoomFeedProps) {
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  const toggleThought = (id: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const totalStages = session?.totalStages || 6;
  const currentStage = messages.length;
  const isComplete = session?.review?.status === "approved";
  const needsRevision = session?.review?.status === "needs_revision";

  return (
    <div className="w-full max-w-4xl mx-auto my-4 rounded-2xl border border-white/10 bg-[#0c0d12]/90 backdrop-blur-xl shadow-2xl overflow-hidden text-white">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4 bg-gradient-to-r from-[#13141f] to-[#0a0a0f]">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#9D7CFF]/15 text-[#9D7CFF] border border-[#9D7CFF]/30 shadow-lg shadow-[#9D7CFF]/10">
            <Users size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#9D7CFF]">
                Sala de Guerra Multiagente
              </span>
              <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] border border-white/10 px-2 py-0.5 text-[10px] font-medium text-white/70">
                {isComplete ? (
                  <>
                    <CheckCircle2 size={11} className="text-emerald-400" />
                    Consenso Alcançado
                  </>
                ) : needsRevision ? (
                  <>
                    <ShieldCheck size={11} className="text-amber-400" />
                    Revisão Obrigatória
                  </>
                ) : isStreaming ? (
                  <>
                    <Loader2 size={11} className="animate-spin text-[#9D7CFF]" />
                    Debate em Andamento
                  </>
                ) : (
                  <>
                    <Zap size={11} className="text-amber-400" />
                    {messages.length} de {totalStages} Especialistas
                  </>
                )}
              </span>
            </div>
            <h3 className="text-sm font-semibold text-white/95 mt-0.5 truncate max-w-md sm:max-w-xl">
              {session?.topic || "Alinhamento Criativo e Estratégico"}
            </h3>
          </div>
        </div>

        {/* Progress pills */}
        <div className="flex items-center gap-1.5 bg-black/40 px-3 py-1.5 rounded-xl border border-white/5 text-xs text-white/60">
          <span className="font-mono font-medium text-white/90">
            {messages.length}/{totalStages}
          </span>
          <span className="text-white/40">etapas</span>
        </div>
      </div>

      {/* Specialist Step Stepper */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1 p-2.5 bg-black/30 border-b border-white/5">
        {[
          { label: "Estratégia", icon: "👑", role: "campaign-director", color: "#9D7CFF" },
          { label: "Audiência", icon: "🎯", role: "audience-strategist", color: "#38BDF8" },
          { label: "Marca", icon: "🛡️", role: "brand-governance", color: "#34D399" },
          { label: "Copy", icon: "✍️", role: "copywriter", color: "#F59E0B" },
          { label: "Visual", icon: "🎨", role: "visual-director", color: "#EC4899" },
          { label: "Revisão", icon: "🔍", role: "creative-reviewer", color: "#10B981" },
        ].map((step, idx) => {
          const isDone = idx < messages.length;
          const isCurrent = idx === messages.length && isStreaming;
          return (
            <div
              key={step.role}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] transition-all ${
                isDone
                  ? "bg-white/[0.05] text-white/90 font-medium"
                  : isCurrent
                  ? "bg-[#9D7CFF]/15 text-[#9D7CFF] border border-[#9D7CFF]/30 animate-pulse"
                  : "text-white/30"
              }`}
            >
              <span>{step.icon}</span>
              <span className="truncate">{step.label}</span>
              {isDone && <CheckCircle2 size={10} className="ml-auto text-emerald-400 shrink-0" />}
            </div>
          );
        })}
      </div>

      {/* Messages Feed */}
      <div className="p-4 sm:p-5 space-y-4 max-h-[600px] overflow-y-auto">
        <AnimatePresence initial={false}>
          {messages.map((msg, index) => {
            const hasThought = Boolean(msg.thought);
            const isThoughtOpen = expandedThoughts[msg.id] ?? false;

            return (
              <motion.div
                key={msg.id || index}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
                className="flex gap-3.5 sm:gap-4 p-4 rounded-xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.035] transition-colors"
                style={{
                  borderLeft: `3px solid ${msg.agentColor || "#9D7CFF"}`,
                }}
              >
                {/* Avatar Icon */}
                <div
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg shadow-md"
                  style={{
                    backgroundColor: `${msg.agentColor}18`,
                    border: `1px solid ${msg.agentColor}40`,
                  }}
                >
                  {msg.agentAvatar}
                </div>

                {/* Content Body */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-white/95">
                        {msg.agentName}
                      </span>
                      <span
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                        style={{
                          backgroundColor: `${msg.agentColor}20`,
                          color: msg.agentColor,
                        }}
                      >
                        {msg.agentTitle}
                      </span>
                    </div>
                    <span className="text-[10px] text-white/40 font-mono">
                      Etapa {msg.stageNumber || index + 1}/{totalStages}
                    </span>
                  </div>

                  {/* Internal Thought (Expansível) */}
                  {hasThought && (
                    <div className="my-2 rounded-lg bg-black/40 border border-white/5 p-2 text-xs">
                      <button
                        type="button"
                        onClick={() => toggleThought(msg.id)}
                        className="flex items-center justify-between w-full text-left text-white/50 hover:text-white/80 transition-colors"
                      >
                        <span className="flex items-center gap-1.5 font-mono text-[11px]">
                          <Brain size={12} className="text-[#9D7CFF]" />
                          Justificativa Estratégica
                        </span>
                        {isThoughtOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                      </button>
                      {isThoughtOpen && (
                        <p className="mt-1.5 text-white/70 text-[11px] leading-relaxed border-t border-white/5 pt-1.5">
                          {msg.thought}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Rendered Content */}
                  <div className="prose prose-invert prose-sm max-w-none text-white/85 text-xs sm:text-sm leading-relaxed">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>

                  {/* Artifacts Produced by this agent */}
                  {msg.artifactsProduced && msg.artifactsProduced.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 pt-2 border-t border-white/5">
                      {msg.artifactsProduced.map((art) => (
                        <button
                          key={art.id}
                          type="button"
                          onClick={() => onOpenArtifact?.(art)}
                          className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white transition-all shadow-sm group"
                        >
                          <FileText size={13} className="text-[#9D7CFF] group-hover:scale-110 transition-transform" />
                          <span className="font-medium font-mono text-[11px] truncate max-w-[200px]">
                            {art.name}
                          </span>
                          <span className="text-[10px] text-[#9D7CFF] font-semibold bg-[#9D7CFF]/10 px-1.5 py-0.5 rounded">
                            Ver no Canvas
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {msg.generationMode === "synthetic_fallback" && (
                    <div className="mt-2 rounded-lg border border-amber-400/20 bg-amber-400/10 px-2.5 py-2 text-[11px] text-amber-200">
                      Execução degradada: {msg.warning || "conteúdo sintético local utilizado."}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {isStreaming && (
          <div className="flex items-center justify-center gap-2 py-3 text-xs text-white/50 animate-pulse">
            <Loader2 size={14} className="animate-spin text-[#9D7CFF]" />
            <span>Aguardando próximo especialista na Sala de Guerra...</span>
          </div>
        )}
      </div>
    </div>
  );
}
