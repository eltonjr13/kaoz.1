"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, ExternalLink, Loader2, LogOut, Save, ShieldCheck, ChevronDown, ChevronUp, Settings2 } from "lucide-react";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import type { GoogleDriveConnectionStatus } from "@/services/google-drive/google-drive.types";

type StatusMessage = { text: string; type: "success" | "error" | "info" };
type Overview = {
  status: GoogleDriveConnectionStatus;
  configuration: { clientId: string; clientSecretConfigured: boolean; apiKey: string; appId: string; isEnvConfigured?: boolean; hasCustomConfig?: boolean };
};

async function json(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
  return data;
}

function DriveStatusBadge({ status }: { status: GoogleDriveConnectionStatus | null }) {
  let label = "Não configurado";
  let color = "border-white/10 bg-white/5 text-zinc-400";

  if (status?.configured) {
    label = status.isEnvConfigured ? "Pronto (via .env)" : "Configurado";
    color = "border-cyan-500/30 bg-cyan-500/10 text-cyan-300";
  }
  if (status?.connected) {
    label = `Conectado${status.email ? ` · ${status.email}` : ""}`;
    color = "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }

  return <span className={`rounded-full border px-3 py-1 text-[10px] font-bold ${color}`}>{label}</span>;
}

function DriveConnectionActions(props: {
  status: GoogleDriveConnectionStatus | null;
  busy: string | null;
  connect: () => void;
  test: () => void;
  disconnect: () => void;
}) {
  const { status, busy, connect, test, disconnect } = props;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {status?.connected ? (
        <>
          {!status.batchReady && (
            <button disabled={!!busy} onClick={connect} className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-xs font-bold text-black hover:bg-amber-300 disabled:opacity-40"><ExternalLink size={14} /> Reconectar para lotes</button>
          )}
          <button disabled={!!busy} onClick={test} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Testar conexão</button>
          <button disabled={!!busy} onClick={disconnect} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"><LogOut size={14} /> Desconectar</button>
        </>
      ) : (
        <button disabled={!!busy || !status?.configured} onClick={connect} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-40"><ExternalLink size={14} /> Conectar conta do Google Drive</button>
      )}
      <DriveDestination status={status} />
    </div>
  );
}

function DriveDestination({ status }: { status: GoogleDriveConnectionStatus | null }) {
  return status?.defaultFolder
    ? <span className="ml-auto text-[11px] text-zinc-400">Destino: <strong className="text-zinc-200">{status.defaultFolder.name}</strong></span>
    : null;
}

export function GoogleDriveSettingsCard({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [status, setStatus] = useState<GoogleDriveConnectionStatus | null>(null);
  const [form, setForm] = useState({ clientId: "", clientSecret: "", apiKey: "", appId: "" });
  const [busy, setBusy] = useState<string | null>("load");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/google-drive", { cache: "no-store" });
    const data = await json(response) as unknown as Overview;
    setStatus(data.status);
    setForm({ clientId: data.configuration.clientId, clientSecret: "", apiKey: data.configuration.apiKey, appId: data.configuration.appId });
  }, []);

  useEffect(() => {
    load().catch((error) => onStatusMessage({ text: String(error), type: "error" })).finally(() => setBusy(null));
  }, [load, onStatusMessage]);

  async function save() {
    setBusy("save");
    try {
      const data = await json(await fetch("/api/google-drive", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      })) as { status?: GoogleDriveConnectionStatus };
      if (data.status) setStatus(data.status);
      onStatusMessage({ text: "Configuração do Google Drive salva com segurança.", type: "success" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function connect() {
    setBusy("connect");
    try {
      const data = await json(await fetch("/api/google-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "authorize" }),
      })) as { authorizationUrl?: string };
      if (!data.authorizationUrl) throw new Error("URL de autorização não recebida.");
      window.open(data.authorizationUrl, "_blank", "noopener,noreferrer");
      onStatusMessage({ text: "Conclua a autorização no navegador. O status será atualizado automaticamente.", type: "info" });
      for (let attempt = 0; attempt < 80; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const response = await fetch("/api/google-drive", { cache: "no-store" });
        const overview = await json(response) as unknown as Overview;
        setStatus(overview.status);
        if (overview.status.connected) {
          onStatusMessage({ text: `Google Drive conectado${overview.status.email ? ` como ${overview.status.email}` : ""}.`, type: "success" });
          return;
        }
        if (overview.status.lastError) {
          onStatusMessage({ text: overview.status.lastError, type: "error" });
          return;
        }
      }
      onStatusMessage({ text: "A autorização não foi concluída dentro do tempo esperado.", type: "error" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy("test");
    try {
      const data = await json(await fetch("/api/google-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "test" }),
      })) as { status?: GoogleDriveConnectionStatus };
      if (data.status) setStatus(data.status);
      onStatusMessage({ text: "Conexão com o Google Drive confirmada.", type: "success" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    if (!window.confirm("Desconectar o Google Drive e revogar o acesso desta conta?")) return;
    setBusy("disconnect");
    try {
      const data = await json(await fetch("/api/google-drive", { method: "DELETE" })) as { status?: GoogleDriveConnectionStatus };
      if (data.status) setStatus(data.status);
      onStatusMessage({ text: "Google Drive desconectado.", type: "success" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  const inputClass = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-xs text-zinc-100 outline-none transition focus:border-emerald-500/50";

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.035] p-5 shadow-[0_0_24px_rgba(16,185,129,0.05)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-white text-[#4285F4]"><Cloud size={22} /></span>
          <div>
            <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <span>Google Drive</span>
              <InfoTooltip text="Importe vídeos escolhidos por você, renderize localmente e envie o resultado para uma pasta do Drive. Usa drive.file para criar resultados e drive.readonly para descobrir a estrutura dos cursos." />
            </h3>
            <p className="mt-0.5 text-[11px] text-zinc-400">Integração na nuvem para aulas e lotes</p>
          </div>
        </div>
        <DriveStatusBadge status={status} />
      </div>

      <DriveConnectionActions status={status} busy={busy} connect={() => void connect()} test={() => void test()} disconnect={() => void disconnect()} />

      {status?.connected && !status.batchReady && (
        <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2 text-[10px] text-amber-200">Reconexão necessária para processamento em lote. A conexão antiga não possui o escopo <code>drive.readonly</code>.</p>
      )}

      {/* Accordion / Optional manual config */}
      <div className="mt-5 border-t border-white/10 pt-3">
        <button
          type="button"
          onClick={() => setShowAdvanced((prev) => !prev)}
          className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-400 hover:text-zinc-200 transition"
        >
          <Settings2 size={13} />
          <span>{showAdvanced ? "Ocultar credenciais manuais" : "Configuração avançada de credenciais (opcional)"}</span>
          {showAdvanced ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>

        {showAdvanced && (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
            <p className="text-[11px] leading-relaxed text-zinc-400">
              Caso as credenciais não estejam configuradas no arquivo <code>.env.local</code> (com <code>GOOGLE_DRIVE_CLIENT_ID</code>, etc.), você pode preenchê-las manualmente abaixo:
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Client ID OAuth Desktop<input className={inputClass} value={form.clientId} onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))} placeholder="...apps.googleusercontent.com" /></label>
              <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Client Secret OAuth Desktop<input className={inputClass} type="password" value={form.clientSecret} onChange={(event) => setForm((current) => ({ ...current, clientSecret: event.target.value }))} placeholder="Cole o secret do cliente Desktop" /></label>
              <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">API key do Picker<input className={inputClass} type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="AIza..." /></label>
              <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Project Number / App ID<input className={inputClass} value={form.appId} onChange={(event) => setForm((current) => ({ ...current, appId: event.target.value }))} placeholder="123456789012" /></label>
            </div>
            <button
              disabled={!!busy}
              onClick={() => void save()}
              className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-zinc-200 hover:bg-white/10 disabled:opacity-40"
            >
              {busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar credenciais manuais
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

