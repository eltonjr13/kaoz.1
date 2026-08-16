"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, HardDrive, HeartPulse, Loader2, RefreshCw, XCircle } from "lucide-react";

type HealthState = "healthy" | "warning" | "error" | "info";
type HealthCheck = { id: string; label: string; state: HealthState; detail: string };
type HealthReport = { checkedAt: string; overall: Exclude<HealthState, "info">; summary: string; groups: Array<{ id: string; label: string; checks: HealthCheck[] }> };

const stateStyle: Record<HealthState, { icon: typeof CheckCircle2; label: string; className: string }> = {
  healthy: { icon: CheckCircle2, label: "Pronto", className: "border-emerald-500/20 bg-emerald-500/10 text-emerald-300" },
  warning: { icon: AlertTriangle, label: "Atenção", className: "border-amber-500/20 bg-amber-500/10 text-amber-200" },
  error: { icon: XCircle, label: "Ação necessária", className: "border-rose-500/20 bg-rose-500/10 text-rose-200" },
  info: { icon: CircleHelp, label: "Informação", className: "border-sky-500/20 bg-sky-500/10 text-sky-200" },
};

export function SystemHealthPanel() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/system-health", { cache: "no-store" });
      const data = await response.json() as HealthReport & { error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível verificar o sistema.");
      setReport(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível verificar o sistema.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const overallStyle = report ? stateStyle[report.overall] : stateStyle.info;
  const OverallIcon = overallStyle.icon;

  return (
    <section className="rounded-2xl border border-white/[0.08] bg-[#0d0d0f] p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"><HeartPulse size={19} /></div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-200">Saúde do sistema</h2>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-500">Diagnóstico somente de leitura dos runtimes, modelos, integrações e ambiente local. Chaves de API nunca são exibidas.</p>
          </div>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading} className="inline-flex items-center justify-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-200 transition hover:bg-white/[0.08] disabled:opacity-50">
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Verificar agora
        </button>
      </div>

      {error && <div className="mt-5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-[11px] text-rose-200">{error}</div>}

      {report && (
        <>
          <div className={`mt-5 flex items-center gap-3 rounded-xl border px-4 py-3 ${overallStyle.className}`}>
            <OverallIcon size={18} className="shrink-0" />
            <div><p className="text-xs font-bold">{overallStyle.label}</p><p className="mt-0.5 text-[11px] opacity-80">{report.summary}</p></div>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            {report.groups.map((group) => (
              <div key={group.id}>
                <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-zinc-500">{group.label}</h3>
                <div className="divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.07] bg-black/15">
                  {group.checks.map((check) => {
                    const style = stateStyle[check.state];
                    const Icon = style.icon;
                    return <div key={check.id} className="flex gap-3 px-3 py-3"><Icon size={16} className={style.className.split(" ").at(-1)} /><div className="min-w-0"><div className="flex items-center gap-2"><p className="text-[11px] font-semibold text-zinc-200">{check.label}</p><span className={`rounded-full border px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${style.className}`}>{style.label}</span></div><p className="mt-1 text-[10px] leading-relaxed text-zinc-500">{check.detail}</p></div></div>;
                  })}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-5 flex items-center gap-1.5 text-[10px] text-zinc-600"><HardDrive size={12} /> Última verificação: {new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium" }).format(new Date(report.checkedAt))}</p>
        </>
      )}
    </section>
  );
}
