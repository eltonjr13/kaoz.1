"use client";

import React, { useState } from "react";
import {
  UploadCloud,
  FileText,
  User,
  CheckCircle2,
  AlertTriangle,
  X,
  Sparkles,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";
import type {
  ChatParticipantSummary,
  ParsedChatMessage,
  ParsedChatResult,
  PersonaRole,
  PersonaStyleProfile,
} from "@/lib/model-p/types";
import { filterParticipantMessages } from "@/lib/model-p/chat-parser";

interface PersonaUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPersonaCreated: (persona: PersonaStyleProfile) => void;
}

export function PersonaUploadModal({
  isOpen,
  onClose,
  onPersonaCreated,
}: PersonaUploadModalProps) {
  const [step, setStep] = useState<"upload" | "select" | "processing">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [pastedText, setPastedText] = useState("");
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState("");

  const [parseResult, setParseResult] = useState<ParsedChatResult | null>(null);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(null);
  const [role, setRole] = useState<PersonaRole>("simulator");
  const [isSynthesizing, setIsSynthesizing] = useState(false);

  if (!isOpen) return null;

  const handleParse = async () => {
    setError("");
    setParsing(true);
    try {
      let res: Response;
      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        res = await fetch("/api/model-p/chat-parser", {
          method: "POST",
          body: formData,
        });
      } else if (pastedText.trim().length > 0) {
        res = await fetch("/api/model-p/chat-parser", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: pastedText }),
        });
      } else {
        throw new Error("Selecione um arquivo .txt do WhatsApp ou cole o texto da conversa.");
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao processar arquivo de conversa.");
      if (!data.participants || data.participants.length === 0) {
        throw new Error("Nenhum participante identificado na conversa. Verifique o formato do texto.");
      }

      setParseResult(data);
      setSelectedParticipant(data.participants[0].name);
      setStep("select");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setParsing(false);
    }
  };

  const handleCreatePersona = async () => {
    if (!parseResult || !selectedParticipant) return;
    setIsSynthesizing(true);
    setError("");
    setStep("processing");

    try {
      const targetMessages = filterParticipantMessages(
        parseResult.messages,
        selectedParticipant
      ).map((m: ParsedChatMessage) => m.content);

      if (targetMessages.length === 0) {
        throw new Error(`Nenhuma mensagem válida encontrada para o participante "${selectedParticipant}".`);
      }

      const res = await fetch("/api/model-p/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetParticipant: selectedParticipant,
          role,
          messages: targetMessages,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao sintetizar perfil de persona.");

      onPersonaCreated(data.persona);
      handleReset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStep("select");
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleReset = () => {
    setStep("upload");
    setFile(null);
    setPastedText("");
    setParseResult(null);
    setSelectedParticipant(null);
    setRole("simulator");
    setError("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-2xl rounded-2xl border border-[var(--line)] bg-[#0d0f14] p-6 shadow-2xl space-y-6 animate-in fade-in zoom-in-95 duration-150 my-8">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl border border-[#7C6CF2]/30 bg-[#7C6CF2]/15 text-[#a99fff]">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Clonar Estilo de Conversa</h2>
              <p className="text-xs text-zinc-400">
                Aprenda o modo exato de falar a partir de mensagens reais de WhatsApp ou outros chats
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { handleReset(); onClose(); }}
            className="rounded-lg p-1 text-zinc-400 hover:bg-white/5 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400">
            <AlertTriangle size={15} className="shrink-0" />
            <p className="flex-1">{error}</p>
          </div>
        )}

        {step === "upload" && (
          <UploadStepView
            file={file}
            setFile={setFile}
            pastedText={pastedText}
            setPastedText={setPastedText}
            parsing={parsing}
            onParse={handleParse}
          />
        )}

        {step === "select" && parseResult && (
          <SelectParticipantStepView
            parseResult={parseResult}
            selectedParticipant={selectedParticipant}
            setSelectedParticipant={setSelectedParticipant}
            role={role}
            setRole={setRole}
            onBack={() => setStep("upload")}
            onConfirm={handleCreatePersona}
          />
        )}

        {step === "processing" && (
          <div className="flex flex-col items-center justify-center py-12 text-center space-y-4">
            <div className="relative flex size-16 items-center justify-center rounded-full bg-[#7C6CF2]/10 border border-[#7C6CF2]/30">
              <Sparkles size={32} className="animate-spin text-[#7C6CF2]" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Sintetizando Estilo e Voz</h3>
              <p className="text-xs text-zinc-400 mt-1 max-w-sm">
                Isolando apenas as falas de <strong className="text-zinc-200">{selectedParticipant}</strong>, calculando métricas de vocabulário, cadência e construindo o clone conversacional...
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function UploadStepView({
  file,
  setFile,
  pastedText,
  setPastedText,
  parsing,
  onParse,
}: {
  file: File | null;
  setFile: (f: File | null) => void;
  pastedText: string;
  setPastedText: (t: string) => void;
  parsing: boolean;
  onParse: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-zinc-700/80 bg-zinc-900/40 p-6 text-center hover:border-zinc-500 transition-colors">
        <UploadCloud size={32} className="mx-auto text-[#a99fff] mb-2" />
        <p className="text-xs font-medium text-zinc-200">
          Arraste e solte o arquivo <span className="font-mono text-[#a99fff]">.txt</span> exportado do WhatsApp
        </p>
        <p className="text-[11px] text-zinc-500 mt-0.5">
          WhatsApp &gt; Conversa &gt; Exportar conversa (sem mídia)
        </p>
        <label className="mt-3 inline-block cursor-pointer rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-[var(--panel-strong)] hover:text-white transition-colors">
          <span>Escolher Arquivo</span>
          <input
            type="file"
            accept=".txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] || null;
              if (f) setFile(f);
            }}
          />
        </label>
        {file && (
          <div className="mt-2 flex items-center justify-center gap-1.5 text-xs text-emerald-400">
            <FileText size={14} />
            <span>{file.name} ({(file.size / 1024).toFixed(1)} KB)</span>
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">Ou cole trechos de conversa diretamente:</label>
        <textarea
          value={pastedText}
          onChange={(e) => setPastedText(e.target.value)}
          placeholder={`12/05/2024, 14:20 - João: E aí beleza?\n12/05/2024, 14:21 - Você: Tudo certo mano!`}
          rows={4}
          className="w-full rounded-xl border border-[var(--line)] bg-[#111319] p-3 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-[#7C6CF2] focus:outline-none"
        />
      </div>

      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onParse}
          disabled={parsing || (!file && !pastedText.trim())}
          className="inline-flex items-center gap-2 rounded-xl bg-[#7C6CF2] px-4 py-2 text-xs font-medium text-white hover:bg-[#6a5ad9] disabled:opacity-50 transition-colors shadow-sm"
        >
          <span>{parsing ? "Lendo arquivo..." : "Identificar Participantes"}</span>
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}

function SelectParticipantStepView({
  parseResult,
  selectedParticipant,
  setSelectedParticipant,
  role,
  setRole,
  onBack,
  onConfirm,
}: {
  parseResult: ParsedChatResult;
  selectedParticipant: string | null;
  setSelectedParticipant: (s: string) => void;
  role: PersonaRole;
  setRole: (r: PersonaRole) => void;
  onBack: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 flex items-start gap-2.5 text-xs text-amber-300">
        <ShieldAlert size={16} className="shrink-0 mt-0.5 text-amber-400" />
        <p className="leading-relaxed">
          <strong>Isolamento de Estilo Ativado:</strong> Apenas as falas do participante escolhido serão analisadas. As mensagens de outros participantes ou suas respostas serão rigorosamente descartadas para não mesclar personalidades.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-zinc-300">
          De quem você deseja replicar o estilo? ({parseResult.participants.length} participantes detectados)
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-48 overflow-y-auto pr-1">
          {parseResult.participants.map((p: ChatParticipantSummary) => {
            const isSelected = selectedParticipant === p.name;
            return (
              <button
                key={p.name}
                type="button"
                onClick={() => setSelectedParticipant(p.name)}
                className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                  isSelected
                    ? "border-[#7C6CF2] bg-[#7C6CF2]/15 text-white"
                    : "border-[var(--line)] bg-[#111319] text-zinc-300 hover:border-zinc-600 hover:bg-[#141720]"
                }`}
              >
                <div className={`flex size-8 shrink-0 items-center justify-center rounded-lg border ${
                  isSelected ? "border-[#7C6CF2] bg-[#7C6CF2] text-white" : "border-zinc-700 bg-zinc-800 text-zinc-400"
                }`}>
                  <User size={15} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold truncate">{p.name}</p>
                    {isSelected && <CheckCircle2 size={13} className="text-[#a99fff] shrink-0" />}
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {p.messageCount} mensagens · {p.wordCount} palavras
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-semibold text-zinc-300">Como você quer usar esta réplica?</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setRole("simulator")}
            className={`rounded-xl border p-3 text-left transition-all ${
              role === "simulator"
                ? "border-[#7C6CF2] bg-[#7C6CF2]/15 text-white"
                : "border-[var(--line)] bg-[#111319] text-zinc-400 hover:border-zinc-600"
            }`}
          >
            <p className="text-xs font-semibold text-zinc-100">Simulador de Conversa</p>
            <p className="text-[11px] text-zinc-500 mt-1">O agente assume a identidade dessa pessoa para você conversar com ela.</p>
          </button>
          <button
            type="button"
            onClick={() => setRole("user_clone")}
            className={`rounded-xl border p-3 text-left transition-all ${
              role === "user_clone"
                ? "border-[#7C6CF2] bg-[#7C6CF2]/15 text-white"
                : "border-[var(--line)] bg-[#111319] text-zinc-400 hover:border-zinc-600"
            }`}
          >
            <p className="text-xs font-semibold text-zinc-100">Meu Clone Pessoal</p>
            <p className="text-[11px] text-zinc-500 mt-1">Aprende o seu próprio jeito para redigir ou responder exatamente como você.</p>
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-[var(--line)] px-3 py-1.5 text-xs text-zinc-400 hover:text-white transition-colors"
        >
          Voltar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!selectedParticipant}
          className="inline-flex items-center gap-2 rounded-xl bg-[#7C6CF2] px-4 py-2 text-xs font-medium text-white hover:bg-[#6a5ad9] disabled:opacity-50 transition-colors shadow-sm"
        >
          <Sparkles size={14} />
          <span>Criar Réplica de Estilo</span>
        </button>
      </div>
    </div>
  );
}
