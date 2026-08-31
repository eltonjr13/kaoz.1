"use client";

import React, { useState } from "react";
import { Send, Bot, User, Trash2, ArrowLeft } from "lucide-react";
import type { PersonaPlaygroundMessage, PersonaStyleProfile } from "@/lib/model-p/types";

interface PersonaChatPlaygroundProps {
  persona: PersonaStyleProfile;
  onBack: () => void;
}

export function PersonaChatPlayground({ persona, onBack }: PersonaChatPlaygroundProps) {
  const [messages, setMessages] = useState<PersonaPlaygroundMessage[]>([
    {
      id: "initial-1",
      role: "assistant",
      content: persona.fewShotExamples?.[0]?.output || "Opa, e aí! Pode falar.",
      createdAt: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: PersonaPlaygroundMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(`/api/model-p/personas/${encodeURIComponent(persona.id)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newHistory }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao obter resposta do clone.");

      const assistantMsg: PersonaPlaygroundMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: data.message,
        createdAt: new Date().toISOString(),
      };
      setMessages([...newHistory, assistantMsg]);
    } catch (err) {
      const errMsg: PersonaPlaygroundMessage = {
        id: `msg-${Date.now() + 1}`,
        role: "assistant",
        content: `(Erro ao responder: ${err instanceof Error ? err.message : String(err)})`,
        createdAt: new Date().toISOString(),
      };
      setMessages([...newHistory, errMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([
      {
        id: "initial-clear",
        role: "assistant",
        content: persona.fewShotExamples?.[0]?.output || "Opa, e aí! Pode falar.",
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  return (
    <div className="flex flex-col h-[560px] rounded-2xl border border-[var(--line)] bg-[#0e1015] shadow-lg overflow-hidden">
      <div className="flex items-center justify-between border-b border-white/[0.06] bg-[#12151c] px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
            title="Voltar para lista de perfis"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-[#7C6CF2]/30 bg-[#7C6CF2]/15 text-[#a99fff]">
            <Bot size={16} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-white">{persona.name}</h3>
              <span className="rounded bg-[#7C6CF2]/20 px-1.5 py-0.5 text-[9px] font-medium text-[#a99fff]">
                {persona.role === "user_clone" ? "Meu Clone" : "Simulador"}
              </span>
            </div>
            <p className="text-[10px] text-zinc-500 truncate max-w-xs">
              Alvo: {persona.targetParticipant} ({persona.stylometry.totalAnalyzedMessages} msgs analisadas)
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleClear}
          title="Limpar histórico de teste"
          className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-300 transition-colors"
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex items-start gap-2.5 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}
          >
            <div
              className={`flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] ${
                m.role === "user"
                  ? "bg-zinc-800 text-zinc-300 border border-zinc-700"
                  : "bg-[#7C6CF2]/20 text-[#a99fff] border border-[#7C6CF2]/30"
              }`}
            >
              {m.role === "user" ? <User size={12} /> : <Bot size={12} />}
            </div>
            <div
              className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-xs leading-relaxed ${
                m.role === "user"
                  ? "bg-[#7C6CF2] text-white rounded-tr-none"
                  : "bg-[#161922] text-zinc-200 border border-[var(--line)] rounded-tl-none"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-zinc-500 text-xs italic pl-8">
            <span className="size-1.5 rounded-full bg-[#7C6CF2] animate-bounce" />
            <span className="size-1.5 rounded-full bg-[#7C6CF2] animate-bounce [animation-delay:0.2s]" />
            <span className="size-1.5 rounded-full bg-[#7C6CF2] animate-bounce [animation-delay:0.4s]" />
            <span>digitando...</span>
          </div>
        )}
      </div>

      <form onSubmit={handleSend} className="border-t border-white/[0.06] bg-[#12151c] p-3 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Fale com ${persona.targetParticipant}...`}
          disabled={loading}
          className="flex-1 rounded-xl border border-[var(--line)] bg-[#0d0f14] px-3.5 py-2 text-xs text-white placeholder:text-zinc-600 focus:border-[#7C6CF2] focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#7C6CF2] text-white hover:bg-[#6a5ad9] disabled:opacity-40 transition-colors shadow-sm"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
