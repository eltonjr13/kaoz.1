"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  Shield,
  RefreshCw,
  Link as LinkIcon,
  Unlink,
  CheckCircle2,
  AlertCircle,
  Info,
  ExternalLink,
} from "lucide-react";
import {
  CortexSkeleton,
  CortexEmptyState,
  CortexErrorState,
  CortexUpdatingBadge,
} from "./cortex-ui-states";

export interface IdentityItem {
  id: string;
  channel: string;
  externalUserId: string;
  username?: string;
  linkedProfileId?: string;
  effectiveProfileId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CortexIdentitiesProps {
  className?: string;
}

export function CortexIdentities({ className = "" }: CortexIdentitiesProps) {
  const [identities, setIdentities] = useState<IdentityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [actionInProgressId, setActionInProgressId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<{
    type: "success" | "info" | "error";
    text: string;
  } | null>(null);

  const fetchIdentities = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setIsUpdating(true);
    setError(null);

    try {
      const res = await fetch("/api/cortex/identities", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const json = await res.json();

      if (!res.ok || json.success === false) {
        throw new Error(
          json.error?.message || json.error || `Erro HTTP ${res.status}`
        );
      }

      const list: IdentityItem[] = json.data?.identities || json.identities || [];
      setIdentities(list);
    } catch (err: any) {
      console.error("[CortexIdentities] Erro ao carregar identidades:", err);
      setError({
        message: err.message || "Erro ao carregar identidades observadas.",
        code: err.code || "IDENTITIES_FETCH_FAILED",
      });
    } finally {
      setLoading(false);
      setIsUpdating(false);
    }
  }, []);

  useEffect(() => {
    void fetchIdentities();
  }, [fetchIdentities]);

  const handleToggleLink = async (identity: IdentityItem) => {
    const isLinked = Boolean(identity.linkedProfileId);
    const action = isLinked ? "unlink" : "link";

    let forgetDerived = false;
    if (isLinked) {
      forgetDerived = window.confirm(
        "Ao desvincular esta identidade, deseja também esquecer as memórias cognitivas derivadas das conversas deste canal?"
      );
    }

    setActionInProgressId(identity.id);
    setFeedbackMessage(null);

    try {
      const res = await fetch(
        `/api/cortex/identities/${encodeURIComponent(identity.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, forgetDerived }),
        }
      );
      const json = await res.json();

      if (!res.ok || json.success === false) {
        throw new Error(
          json.error?.message || json.error || "Falha ao atualizar vínculo da identidade."
        );
      }

      if (action === "link") {
        setFeedbackMessage({
          type: "success",
          text: `Identidade ${identity.channel} (${identity.username || identity.externalUserId}) vinculada com sucesso ao perfil local.`,
        });
      } else {
        const forgotten = json.data?.forgottenMemories || json.forgottenMemories || 0;
        setFeedbackMessage({
          type: "info",
          text: `Identidade ${identity.channel} desvinculada.${
            forgetDerived ? ` ${forgotten} memórias derivadas foram removidas.` : ""
          }`,
        });
      }

      await fetchIdentities(true);
    } catch (err: any) {
      setFeedbackMessage({
        type: "error",
        text: `Erro ao alterar vínculo: ${err.message}`,
      });
    } finally {
      setActionInProgressId(null);
    }
  };

  if (loading && identities.length === 0) {
    return (
      <div className={`w-full min-w-0 space-y-4 ${className}`}>
        <CortexSkeleton variant="rows" count={4} />
      </div>
    );
  }

  if (error && identities.length === 0) {
    return (
      <div className={`w-full min-w-0 space-y-4 ${className}`}>
        <CortexErrorState
          title="Falha ao carregar identidades observadas"
          message={error.message}
          code={error.code}
          onRetry={() => fetchIdentities(false)}
          isRetrying={loading}
        />
      </div>
    );
  }

  if (identities.length === 0) {
    return (
      <div className={`w-full min-w-0 space-y-4 ${className}`}>
        <CortexEmptyState
          icon={Shield}
          title="Nenhuma identidade externa observada ainda"
          description="Quando mensagens forem recebidas via Telegram, Discord ou Flow, as identidades dos remetentes serão registradas automaticamente para vinculação de perfil."
        />
      </div>
    );
  }

  const linkedCount = identities.filter((id) => Boolean(id.linkedProfileId)).length;
  const unlinkedCount = identities.length - linkedCount;

  return (
    <div className={`w-full min-w-0 max-w-full space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-[var(--text)]">
              Identidades Observadas
            </h2>
            {isUpdating && <CortexUpdatingBadge label="Atualizando..." />}
          </div>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Gerencie os vínculos entre identidades observadas em canais externos e o perfil cognitivo local.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-md border border-[var(--line)] bg-[var(--panel)] px-2.5 py-1 text-xs font-mono text-[var(--muted)]">
            {linkedCount} vinculadas · {unlinkedCount} não vinculadas
          </span>

          <button
            type="button"
            onClick={() => void fetchIdentities(true)}
            disabled={isUpdating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition hover:bg-white/[0.05] disabled:opacity-50"
            title="Atualizar identidades"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isUpdating ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      {/* Operation Feedback Toast/Banner */}
      {feedbackMessage && (
        <div
          role="status"
          className={`flex items-center gap-2.5 rounded-xl border p-3 text-xs ${
            feedbackMessage.type === "success"
              ? "border-emerald-500/30 bg-emerald-950/40 text-emerald-300"
              : feedbackMessage.type === "info"
              ? "border-cyan-500/30 bg-cyan-950/40 text-cyan-300"
              : "border-rose-500/30 bg-rose-950/40 text-rose-300"
          }`}
        >
          {feedbackMessage.type === "success" ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
          ) : feedbackMessage.type === "info" ? (
            <Info className="h-4 w-4 shrink-0 text-cyan-400" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-400" />
          )}
          <span className="flex-1">{feedbackMessage.text}</span>
          <button
            type="button"
            onClick={() => setFeedbackMessage(null)}
            className="text-xs opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Identities List */}
      <div className="space-y-2.5">
        {identities.map((identity) => {
          const isLinked = Boolean(identity.linkedProfileId);
          const isBusy = actionInProgressId === identity.id;

          const channelBadgeColor =
            identity.channel === "telegram"
              ? "bg-sky-950 text-sky-300 border-sky-800/50"
              : identity.channel === "discord"
              ? "bg-indigo-950 text-indigo-300 border-indigo-800/50"
              : "bg-emerald-950 text-emerald-300 border-emerald-800/50";

          return (
            <div
              key={identity.id}
              className="flex flex-col gap-3 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 transition hover:bg-white/[0.01] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-white/5 p-2 text-[var(--muted)]">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center rounded border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider ${channelBadgeColor}`}
                    >
                      {identity.channel}
                    </span>
                    <h4 className="text-sm font-semibold text-[var(--text)] truncate">
                      {identity.username ? `@${identity.username}` : identity.externalUserId}
                    </h4>
                    {isLinked ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-950/60 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        Vinculado ao perfil local
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-950/60 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                        <AlertCircle className="h-3 w-3" />
                        Não vinculado
                      </span>
                    )}
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-[var(--muted)] truncate">
                    ID Externo: {identity.externalUserId} · Perfil Efetivo:{" "}
                    {identity.effectiveProfileId || (isLinked ? "local-user" : "desconhecido")}
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                <button
                  type="button"
                  onClick={() => void handleToggleLink(identity)}
                  disabled={isBusy}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-[var(--bg)] disabled:opacity-50 ${
                    isLinked
                      ? "border border-rose-500/30 bg-rose-950/40 text-rose-300 hover:bg-rose-950/70 focus:ring-rose-400"
                      : "border border-[var(--signal-bright)]/40 bg-[var(--signal-soft)] text-[var(--signal-bright)] hover:bg-[var(--signal-soft)]/80 focus:ring-[var(--signal-bright)]"
                  }`}
                >
                  {isBusy ? (
                    <>
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      <span>Processando...</span>
                    </>
                  ) : isLinked ? (
                    <>
                      <Unlink className="h-3.5 w-3.5" />
                      <span>Desvincular</span>
                    </>
                  ) : (
                    <>
                      <LinkIcon className="h-3.5 w-3.5" />
                      <span>Vincular ao usuário local</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
