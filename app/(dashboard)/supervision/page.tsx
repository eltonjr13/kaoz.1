"use client";

import type { SupervisionDashboardSnapshot } from "@/services/agents";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

const issueTypes = [
  "failure",
  "deadlock",
  "timeout",
  "loop",
  "inactive-agent",
  "stuck-task",
  "duplicate",
  "infinite-retry",
] as const;

export default function SupervisionDashboardPage() {
  const [dashboard, setDashboard] =
    useState<SupervisionDashboardSnapshot>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const refresh = async () => {
    try {
      const response = await fetch("/api/supervision/dashboard", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Dashboard indisponível (${response.status}).`);
      }
      setDashboard(
        (await response.json()) as SupervisionDashboardSnapshot,
      );
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, []);

  const latest = dashboard?.executions[0];
  const latestReport = latest?.reports.at(-1);

  return (
    <div className="h-full overflow-y-auto bg-[#09090b] px-5 py-6 text-white md:px-8">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-[#9D7CFF]">
              <ShieldCheck size={15} />
              Control plane
            </div>
            <h1 className="text-2xl font-semibold tracking-[-0.03em]">
              Supervisão multiagente
            </h1>
            <p className="mt-1 text-sm text-[#8E8E99]">
              Scheduler, planejamento, agentes, mensagens e Blackboard em
              tempo real.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-[#D4D4D8]"
          >
            <RefreshCw
              size={14}
              className={loading ? "animate-spin" : undefined}
            />
            Atualizar
          </button>
        </header>

        {error && (
          <div className="rounded-2xl border border-red-400/20 bg-red-400/[0.06] px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <Metric
            label="Execuções"
            value={dashboard?.summary.executions ?? 0}
            icon={<Workflow size={16} />}
          />
          <Metric
            label="Saudáveis"
            value={dashboard?.summary.healthy ?? 0}
            icon={<CheckCircle2 size={16} />}
            tone="green"
          />
          <Metric
            label="Com falhas"
            value={dashboard?.summary.unhealthy ?? 0}
            icon={<AlertTriangle size={16} />}
            tone="red"
          />
          <Metric
            label="Issues abertas"
            value={dashboard?.summary.openIssues ?? 0}
            icon={<Activity size={16} />}
            tone="amber"
          />
          <Metric
            label="Recuperações"
            value={dashboard?.summary.recoveriesApplied ?? 0}
            icon={<RotateCcw size={16} />}
            tone="purple"
          />
          <Metric
            label="Recovery errors"
            value={dashboard?.summary.recoveriesFailed ?? 0}
            icon={<AlertTriangle size={16} />}
            tone="red"
          />
        </section>

        {!latest ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.02] text-center">
            <ShieldCheck size={28} className="mb-3 text-[#696972]" />
            <p className="text-sm text-[#C5C5CC]">
              Nenhuma execução supervisionada ainda.
            </p>
            <p className="mt-1 text-xs text-[#73737D]">
              Os dados aparecerão quando o ChiefAgent iniciar um objetivo.
            </p>
          </div>
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
              <Panel title="Componentes observados">
                <div className="grid gap-2 sm:grid-cols-2">
                  {(latest.snapshot.components ?? []).map((component) => (
                    <div
                      key={component.name}
                      className="rounded-2xl border border-white/[0.07] bg-black/20 p-4"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium capitalize text-[#E4E4E7]">
                          {component.name.replace("-", " ")}
                        </span>
                        <Status status={component.status} />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[#777781]">
                        {Object.entries(component.metrics).map(
                          ([key, value]) => (
                            <span key={key}>
                              {key}:{" "}
                              <strong className="text-[#BDBDC5]">
                                {value}
                              </strong>
                            </span>
                          ),
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>

              <Panel title="Detecções">
                <div className="grid grid-cols-2 gap-2">
                  {issueTypes.map((type) => (
                    <div
                      key={type}
                      className="rounded-xl bg-white/[0.035] px-3 py-2.5"
                    >
                      <div className="text-[11px] text-[#777781]">{type}</div>
                      <div className="mt-1 text-lg font-semibold">
                        {dashboard?.summary.issuesByType[type] ?? 0}
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Panel title="Issues mais recentes">
                <div className="space-y-2">
                  {(latestReport?.issues ?? []).length === 0 ? (
                    <Empty label="Nenhuma anomalia detectada." />
                  ) : (
                    latestReport?.issues.map((issue) => (
                      <div
                        key={issue.id}
                        className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold uppercase tracking-wide text-[#F2B8B5]">
                            {issue.type}
                          </span>
                          <span className="text-[10px] uppercase text-[#777781]">
                            {issue.severity}
                          </span>
                        </div>
                        <p className="mt-2 text-sm text-[#D4D4D8]">
                          {issue.message}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </Panel>

              <Panel title="Ações de recuperação">
                <div className="space-y-2">
                  {latest.recoveries.length === 0 ? (
                    <Empty label="Nenhuma recuperação foi necessária." />
                  ) : (
                    [...latest.recoveries]
                      .reverse()
                      .slice(0, 12)
                      .map((recovery) => (
                        <div
                          key={recovery.id}
                          className="flex items-start justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3"
                        >
                          <div>
                            <div className="text-xs font-semibold text-[#E4E4E7]">
                              {recovery.action.type}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs text-[#777781]">
                              {recovery.action.reason}
                            </p>
                          </div>
                          <Status status={recovery.status} />
                        </div>
                      ))
                  )}
                </div>
              </Panel>
            </section>

            <Panel title="Execução atual">
              <div className="grid gap-3 md:grid-cols-4">
                <Detail label="Execution ID" value={latest.executionId} />
                <Detail
                  label="Plano"
                  value={`${latest.snapshot.planId} v${latest.snapshot.planVersion}`}
                />
                <Detail
                  label="Tarefas"
                  value={String(latest.snapshot.tasks.length)}
                />
                <Detail
                  label="Última análise"
                  value={formatTime(latest.updatedAt)}
                />
              </div>
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon: ReactNode;
  tone?: "neutral" | "green" | "red" | "amber" | "purple";
}) {
  const colors = {
    neutral: "text-[#A1A1AA]",
    green: "text-emerald-300",
    red: "text-red-300",
    amber: "text-amber-300",
    purple: "text-[#B8A5FF]",
  };
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
      <div className={`flex items-center gap-2 ${colors[tone]}`}>
        {icon}
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/[0.07] bg-[#101013] p-4 md:p-5">
      <h2 className="mb-4 text-sm font-semibold text-[#E4E4E7]">{title}</h2>
      {children}
    </section>
  );
}

function Status({ status }: { status: string }) {
  const healthy = ["healthy", "applied", "completed"].includes(status);
  const failed = ["failed", "unavailable"].includes(status);
  return (
    <span
      className={`rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
        healthy
          ? "bg-emerald-400/10 text-emerald-300"
          : failed
            ? "bg-red-400/10 text-red-300"
            : "bg-amber-400/10 text-amber-300"
      }`}
    >
      {status}
    </span>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-xs text-[#6F6F78]">
      {label}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white/[0.025] p-3">
      <div className="text-[10px] uppercase tracking-wide text-[#6F6F78]">
        {label}
      </div>
      <div className="mt-2 truncate text-xs text-[#D4D4D8]">{value}</div>
    </div>
  );
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(value));
}
