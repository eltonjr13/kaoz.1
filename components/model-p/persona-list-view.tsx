"use client";

import React from "react";
import {
  Sparkles,
  MessageSquare,
  Trash2,
  Play,
  User,
  Hash,
  Smile,
  Zap,
} from "lucide-react";
import type { PersonaStyleProfile } from "@/lib/model-p/types";

interface PersonaListViewProps {
  personas: PersonaStyleProfile[];
  onOpenUpload: () => void;
  onSelectPlayground: (p: PersonaStyleProfile) => void;
  onDeletePersona: (id: string) => void;
}

export function PersonaListView({
  personas,
  onOpenUpload,
  onSelectPlayground,
  onDeletePersona,
}: PersonaListViewProps) {
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-2xl border border-[var(--line)] bg-[#101217] p-5">
        <div>
          <h2 className="text-sm font-semibold text-white">Réplicas & Clones de Conversa</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Perfis de estilo e voz aprendidos a partir de históricos de WhatsApp ou outros chats
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenUpload}
          className="inline-flex items-center gap-2 rounded-xl bg-[#7C6CF2] px-3.5 py-2 text-xs font-medium text-white hover:bg-[#6a5ad9] transition-colors shadow-sm self-start sm:self-center"
        >
          <Sparkles size={14} />
          <span>Clonar Novo Estilo</span>
        </button>
      </div>

      {personas.length === 0 ? (
        <EmptyPersonasState onOpenUpload={onOpenUpload} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {personas.map((persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              onSelectPlayground={onSelectPlayground}
              onDeletePersona={onDeletePersona}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyPersonasState({ onOpenUpload }: { onOpenUpload: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[#101217]/50 p-8 text-center space-y-3">
      <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-[#7C6CF2]/30 bg-[#7C6CF2]/10 text-[#a99fff]">
        <MessageSquare size={22} />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">Nenhum estilo conversacional clonado ainda</h3>
        <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
          Faça upload de uma conversa do WhatsApp (.txt) para o agente aprender a cadência, gírias, emojis e forma exata de falar de uma pessoa.
        </p>
      </div>
      <button
        type="button"
        onClick={onOpenUpload}
        className="inline-flex items-center gap-2 rounded-xl border border-[#7C6CF2]/40 bg-[#7C6CF2]/15 px-4 py-2 text-xs font-medium text-[#a99fff] hover:bg-[#7C6CF2]/25 hover:text-white transition-colors"
      >
        <Sparkles size={14} />
        <span>Fazer Upload de Conversa</span>
      </button>
    </div>
  );
}

function PersonaCard({
  persona,
  onSelectPlayground,
  onDeletePersona,
}: {
  persona: PersonaStyleProfile;
  onSelectPlayground: (p: PersonaStyleProfile) => void;
  onDeletePersona: (id: string) => void;
}) {
  const isClone = persona.role === "user_clone";
  const { stylometry } = persona;

  return (
    <div className="group rounded-2xl border border-[var(--line)] bg-[#111319] p-5 space-y-4 hover:border-zinc-600/80 hover:bg-[#131620] transition-all">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-[#7C6CF2]/30 bg-[#7C6CF2]/15 text-[#a99fff]">
            <User size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-white">{persona.name}</h3>
              <span className="rounded-full bg-[#7C6CF2]/20 px-2 py-0.5 text-[9px] font-semibold text-[#a99fff] border border-[#7C6CF2]/30">
                {isClone ? "Meu Clone" : "Simulador"}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
              {persona.description}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            if (window.confirm(`Excluir o perfil "${persona.name}"?`)) {
              onDeletePersona(persona.id);
            }
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-zinc-500 hover:text-red-400 rounded-md hover:bg-red-950/40"
          title="Excluir perfil"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 border-y border-white/[0.04] py-3 text-[11px]">
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Hash size={12} className="text-[#a99fff]" />
          <span>{stylometry.totalAnalyzedMessages} msgs</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-400">
          <Zap size={12} className="text-amber-400" />
          <span>{stylometry.averageWordsPerMessage} pal/msg</span>
        </div>
        <div className="flex items-center gap-1.5 text-zinc-400 truncate">
          <Smile size={12} className="text-emerald-400" />
          <span>
            {stylometry.topEmojis.length > 0
              ? stylometry.topEmojis.slice(0, 3).map((e) => e.emoji).join(" ")
              : "Sem emojis"}
          </span>
        </div>
      </div>

      {stylometry.commonSlang.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {stylometry.commonSlang.slice(0, 5).map((slang) => (
            <span
              key={slang}
              className="rounded-md border border-white/[0.06] bg-zinc-900/60 px-1.5 py-0.5 text-[10px] text-zinc-400 font-mono"
            >
              #{slang}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-zinc-500 font-mono">
          {new Date(persona.updatedAt).toLocaleDateString("pt-BR")}
        </span>
        <button
          type="button"
          onClick={() => onSelectPlayground(persona)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#7C6CF2]/15 border border-[#7C6CF2]/30 px-3 py-1.5 text-xs font-medium text-[#a99fff] hover:bg-[#7C6CF2] hover:text-white transition-all shadow-sm"
        >
          <Play size={11} className="fill-current" />
          <span>Testar no Chat</span>
        </button>
      </div>
    </div>
  );
}
