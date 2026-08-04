"use client";

import { useCallback, useEffect, useState } from "react";
import { Cloud, ExternalLink, Loader2, LogOut, Save, ShieldCheck } from "lucide-react";
import type { GoogleDriveConnectionStatus } from "@/services/google-drive/google-drive.types";

type StatusMessage = { text: string; type: "success" | "error" | "info" };
type Overview = {
  status: GoogleDriveConnectionStatus;
  configuration: { clientId: string; apiKey: string; appId: string };
};

async function json(response: Response) {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${response.status}`);
  return data;
}

function DriveStatusBadge({ status }: { status: GoogleDriveConnectionStatus | null }) {
  let label = "Não configurado";
  if (status?.configured) label = "Configurado";
  if (status?.connected) label = `Conectado${status.email ? ` · ${status.email}` : ""}`;
  return <span className={`rounded-full border px-3 py-1 text-[10px] font-bold ${status?.connected ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-white/10 bg-white/5 text-zinc-400"}`}>{label}</span>;
}

function DriveConnectionActions(props: {
  status: GoogleDriveConnectionStatus | null;
  busy: string | null;
  save: () => void;
  connect: () => void;
  test: () => void;
  disconnect: () => void;
}) {
  const { status, busy, save, connect, test, disconnect } = props;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button disabled={!!busy} onClick={save} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-zinc-200 hover:bg-white/10 disabled:opacity-40">{busy === "save" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Salvar</button>
      {status?.connected ? (
        <>
          <button disabled={!!busy} onClick={test} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-40">{busy === "test" ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Testar conexão</button>
          <button disabled={!!busy} onClick={disconnect} className="inline-flex items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-40"><LogOut size={14} /> Desconectar</button>
        </>
      ) : (
        <button disabled={!!busy || !status?.configured} onClick={connect} className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-black hover:bg-emerald-400 disabled:opacity-40"><ExternalLink size={14} /> Conectar conta</button>
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
  const [form, setForm] = useState({ clientId: "", apiKey: "", appId: "" });
  const [busy, setBusy] = useState<string | null>("load");

  const load = useCallback(async () => {
    const response = await fetch("/api/google-drive", { cache: "no-store" });
    const data = await json(response) as unknown as Overview;
    setStatus(data.status);
    setForm(data.configuration);
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
            <h3 className="text-sm font-bold text-zinc-100">Google Drive</h3>
            <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-zinc-400">Importe vídeos escolhidos por você, renderize localmente e envie o resultado para uma pasta do Drive.</p>
          </div>
        </div>
        <DriveStatusBadge status={status} />
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-3">
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Client ID OAuth Desktop<input className={inputClass} value={form.clientId} onChange={(event) => setForm((current) => ({ ...current, clientId: event.target.value }))} placeholder="...apps.googleusercontent.com" /></label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">API key do Picker<input className={inputClass} type="password" value={form.apiKey} onChange={(event) => setForm((current) => ({ ...current, apiKey: event.target.value }))} placeholder="AIza..." /></label>
        <label className="space-y-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">Project Number / App ID<input className={inputClass} value={form.appId} onChange={(event) => setForm((current) => ({ ...current, appId: event.target.value }))} placeholder="123456789012" /></label>
      </div>

      <DriveConnectionActions status={status} busy={busy} save={() => void save()} connect={() => void connect()} test={() => void test()} disconnect={() => void disconnect()} />
      <p className="mt-3 text-[10px] leading-relaxed text-zinc-500">Ative as APIs Google Drive e Google Picker no mesmo projeto Cloud. O Kaoz.1 solicita apenas <code className="text-zinc-300">drive.file</code>; arquivos e pastas precisam ser escolhidos no Picker.</p>
    </section>
  );
}
