"use client";

import { X, Search, MessageSquare } from "lucide-react";
import type { PersonalModelEvidenceDetail } from "@/lib/model-p/types";

interface EvidenceModalProps {
  evidence: PersonalModelEvidenceDetail | null;
  loading: boolean;
  onClose: () => void;
}

export function EvidenceModal({ evidence, loading, onClose }: EvidenceModalProps) {
  if (!evidence && !loading) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="fixed inset-0 bg-black/75 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        className="relative z-10 w-full max-w-xl max-h-[85vh] flex flex-col rounded-2xl border border-[var(--line)] bg-[#0e1015] text-[var(--text)] shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div className="flex items-center gap-2">
            <Search size={16} className="text-[#7C6CF2]" />
            <h3 className="text-sm font-semibold tracking-tight text-white">
              Origem & Evidências
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition-colors hover:bg-[var(--panel-strong)] hover:text-white"
            aria-label="Fechar"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-xs text-[var(--muted)]">
              Carregando evidências e histórico...
            </div>
          ) : evidence ? (
            <>
              <div className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7C6CF2]">
                    Memória Registrada
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                      evidence.confidenceLevel === "high"
                        ? "bg-emerald-950/70 text-emerald-300 border border-emerald-800/50"
                        : evidence.confidenceLevel === "medium"
                        ? "bg-amber-950/70 text-amber-300 border border-amber-800/50"
                        : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                    }`}
                  >
                    Confiança: {Math.round(evidence.confidenceScore * 100)}%
                  </span>
                </div>
                <p className="text-sm font-medium text-white break-words">
                  {evidence.content}
                </p>
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
                  Por que o agente assimilou isso?
                </h4>
                {evidence.evidenceTexts.length === 0 ? (
                  <p className="text-xs text-[var(--muted)] italic">
                    Nenhuma justificativa textual direta armazenada.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {evidence.evidenceTexts.map((text, idx) => (
                      <div
                        key={idx}
                        className="rounded-lg border border-[var(--line)] bg-[#13161d] p-3 text-xs text-zinc-300 italic border-l-2 border-l-[#7C6CF2]"
                      >
                        &ldquo;{text}&rdquo;
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">
                  Conversas & Mensagens de Origem ({evidence.referencedMessages.length})
                </h4>
                {evidence.referencedMessages.length === 0 ? (
                  <p className="text-xs text-[var(--muted)] italic">
                    Nenhuma mensagem arquivada vinculada a este registro.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {evidence.referencedMessages.map((msg) => (
                      <div
                        key={msg.messageId}
                        className="rounded-xl border border-[var(--line)] bg-[#12151c] p-3 text-xs space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-[11px] text-[var(--muted)]">
                          <span className="flex items-center gap-1.5 font-medium text-zinc-300">
                            <MessageSquare size={13} className="text-[#7C6CF2]" />
                            {msg.title}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {new Date(msg.createdAt).toLocaleString("pt-BR")}
                          </span>
                        </div>
                        <div className="bg-black/30 rounded-lg p-2.5 text-zinc-200 break-words font-mono text-[11px]">
                          <span className="font-bold text-[#a99fff] mr-2">
                            {msg.role === "user" ? "Você:" : "Agente:"}
                          </span>
                          {msg.content}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex justify-end border-t border-[var(--line)] px-5 py-3 bg-[var(--panel)]">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-1.5 text-xs font-medium text-white bg-zinc-800 hover:bg-zinc-700 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
