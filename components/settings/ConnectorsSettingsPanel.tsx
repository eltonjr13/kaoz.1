"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Clock3, Link2, Loader2, MessageCircle, PlugZap, Save, Send, ShieldCheck, Trash2 } from "lucide-react";
import type { ConnectorAccount, ConnectorDefinition, ConnectorHistoryEntry, ConnectorInboundHistoryEntry, ConnectorProvider, DiscordGatewayRuntimeStatus } from "@/services/connectors/connector.types";

interface StatusMessage { text: string; type: "success" | "error" | "info"; }
interface Overview { catalog: ConnectorDefinition[]; accounts: ConnectorAccount[]; history: ConnectorHistoryEntry[]; inboundHistory: ConnectorInboundHistoryEntry[]; discordGateway: DiscordGatewayRuntimeStatus; }

const EMPTY: Overview = { catalog: [], accounts: [], history: [], inboundHistory: [], discordGateway: { state: "stopped", reconnectCount: 0 } };

async function responseJson(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  return body;
}

function healthLabel(account?: ConnectorAccount) {
  if (!account) return { label: "Não configurado", color: "text-zinc-500", dot: "bg-zinc-600" };
  if (!account.enabled) return { label: "Desativado", color: "text-zinc-500", dot: "bg-zinc-600" };
  if (account.health === "connected") return { label: "Conectado", color: "text-emerald-400", dot: "bg-emerald-400" };
  if (account.health === "error") return { label: "Com erro", color: "text-rose-400", dot: "bg-rose-400" };
  return { label: "Aguardando teste", color: "text-amber-400", dot: "bg-amber-400" };
}

export function ConnectorsSettingsPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [overview, setOverview] = useState<Overview>(EMPTY);
  const [credentials, setCredentials] = useState<Record<string, Record<string, string>>>({});
  const [displayNames, setDisplayNames] = useState<Record<string, string>>({});
  const [publicConfigs, setPublicConfigs] = useState<Record<string, Record<string, string>>>({});
  const [busy, setBusy] = useState<string | null>("load");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/connectors", { cache: "no-store" });
      const next = await responseJson(response) as unknown as Overview;
      setOverview(next);
      setPublicConfigs((current) => Object.fromEntries(next.accounts.map((account) => [account.provider, { ...account.publicConfig, ...current[account.provider] }])));
    } catch (error) {
      onStatusMessage({ text: `Falha ao carregar conectores: ${error instanceof Error ? error.message : String(error)}`, type: "error" });
    } finally { setBusy(null); }
  }, [onStatusMessage]);

  useEffect(() => { void load(); }, [load]);

  const accountByProvider = useMemo(() => new Map(overview.accounts.map((account) => [account.provider, account])), [overview.accounts]);

  async function save(definition: ConnectorDefinition) {
    const account = accountByProvider.get(definition.provider);
    setBusy(`save:${definition.provider}`);
    try {
      const response = await fetch("/api/connectors", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: account?.id,
          provider: definition.provider,
          displayName: displayNames[definition.provider] || account?.displayName || definition.name,
          enabled: account?.enabled ?? true,
          credentials: credentials[definition.provider] || {},
          publicConfig: publicConfigs[definition.provider] || account?.publicConfig || {},
        })
      });
      await responseJson(response);
      setCredentials((current) => ({ ...current, [definition.provider]: {} }));
      await load();
      onStatusMessage({ text: `${definition.name} salvo. Use “Testar conexão” para validar as credenciais.`, type: "success" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setBusy(null); }
  }

  async function testConnection(account: ConnectorAccount) {
    setBusy(`test:${account.id}`);
    try {
      const response = await fetch("/api/connectors/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: account.id }) });
      await responseJson(response);
      await load();
      onStatusMessage({ text: `Conexão ${account.displayName} confirmada.`, type: "success" });
    } catch (error) {
      await load();
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setBusy(null); }
  }

  async function toggle(account: ConnectorAccount) {
    setBusy(`toggle:${account.id}`);
    try {
      const response = await fetch("/api/connectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: account.id, provider: account.provider, displayName: account.displayName, enabled: !account.enabled }) });
      await responseJson(response);
      await load();
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setBusy(null); }
  }

  async function remove(account: ConnectorAccount) {
    if (!window.confirm(`Remover a conexão “${account.displayName}” e suas credenciais locais?`)) return;
    setBusy(`remove:${account.id}`);
    try {
      await responseJson(await fetch(`/api/connectors?id=${encodeURIComponent(account.id)}`, { method: "DELETE" }));
      await load();
      onStatusMessage({ text: "Conexão removida.", type: "success" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setBusy(null); }
  }

  if (busy === "load") return <div className="flex min-h-40 items-center justify-center text-zinc-500"><Loader2 size={18} className="animate-spin" /></div>;

  return (
    <div className="max-w-5xl space-y-7">
      <div className="flex flex-col gap-3 border-b border-white/[0.07] pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-zinc-200"><PlugZap size={15} className="text-emerald-400" /> Conectores</h2>
          <p className="max-w-3xl text-[11px] leading-relaxed text-zinc-500">Conecte canais externos ao agente. Pedidos explícitos de envio publicam diretamente; no Discord, o modo bidirecional responde apenas a menções autorizadas.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-1.5 text-[10px] font-bold text-emerald-300"><ShieldCheck size={13} /> Credenciais cifradas localmente</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {overview.catalog.map((definition) => {
          const account = accountByProvider.get(definition.provider);
          const health = healthLabel(account);
          const isBusy = busy?.endsWith(account?.id || definition.provider);
          return (
            <section key={definition.provider} className={`rounded-2xl border p-5 ${definition.availability === "planned" ? "border-white/[0.05] bg-white/[0.015] opacity-65" : "border-white/[0.08] bg-[#111114]"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100">{definition.name}</h3>
                  <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{definition.description}</p>
                </div>
                {definition.availability === "planned" ? (
                  <span className="rounded-full border border-white/10 px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider text-zinc-500">Em breve</span>
                ) : (
                  <span className={`flex shrink-0 items-center gap-1.5 text-[10px] font-bold ${health.color}`}><span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />{health.label}</span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap gap-1.5">
                {definition.capabilities.map((capability) => <span key={capability} className="rounded-md border border-white/[0.06] bg-black/20 px-2 py-1 text-[9px] text-zinc-500">{capability.replaceAll("_", " ")}</span>)}
              </div>

              {definition.availability === "available" && (
                <div className="mt-5 space-y-3 border-t border-white/[0.06] pt-4">
                  <label className="block space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Nome desta conexão</span><input value={displayNames[definition.provider] ?? account?.displayName ?? definition.name} onChange={(event) => setDisplayNames((current) => ({ ...current, [definition.provider]: event.target.value }))} className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-zinc-200 outline-none focus:border-emerald-500/40" /></label>
                  {definition.credentialFields.map((field) => (
                    <label key={field.key} className="block space-y-1.5">
                      <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{field.label}{field.required ? " *" : ""}</span>
                      <input type={field.type === "password" ? "password" : field.type} value={credentials[definition.provider]?.[field.key] || ""} onChange={(event) => setCredentials((current) => ({ ...current, [definition.provider]: { ...current[definition.provider], [field.key]: event.target.value } }))} placeholder={account?.hasCredentials ? "Deixe em branco para manter o valor atual" : field.placeholder} className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-emerald-500/40" />
                    </label>
                  ))}
                  {definition.provider === "discord" && <DiscordInboundSettings
                    config={publicConfigs.discord || account?.publicConfig || {}}
                    status={overview.discordGateway}
                    onChange={(next) => setPublicConfigs((current) => ({ ...current, discord: next }))}
                  />}
                  {account?.lastError && <div className="flex items-start gap-2 rounded-lg border border-rose-500/15 bg-rose-500/[0.04] p-2.5 text-[10px] leading-relaxed text-rose-300"><AlertCircle size={12} className="mt-0.5 shrink-0" />{account.lastError}</div>}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button disabled={!!busy} onClick={() => void save(definition)} className="flex items-center gap-1.5 rounded-full bg-white px-3 py-2 text-[10px] font-bold text-black disabled:opacity-40">{isBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Salvar</button>
                    {account && <button disabled={!!busy} onClick={() => void testConnection(account)} className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 px-3 py-2 text-[10px] font-bold text-emerald-300 disabled:opacity-40"><Link2 size={12} /> Testar conexão</button>}
                    {account && <button disabled={!!busy} onClick={() => void toggle(account)} className="rounded-full border border-white/10 px-3 py-2 text-[10px] font-bold text-zinc-400 disabled:opacity-40">{account.enabled ? "Desativar" : "Ativar"}</button>}
                    {account && <button disabled={!!busy} onClick={() => void remove(account)} title="Remover" className="ml-auto rounded-full border border-rose-500/15 p-2 text-rose-400 disabled:opacity-40"><Trash2 size={12} /></button>}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="rounded-2xl border border-white/[0.07] bg-[#111114] p-5">
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-300"><Clock3 size={14} /> Histórico de publicações</h3><span className="text-[10px] text-zinc-600">Últimas {overview.history.length}</span></div>
        {overview.history.length === 0 ? <p className="py-7 text-center text-[11px] text-zinc-600">As publicações aprovadas aparecerão aqui com o resultado e o link remoto.</p> : (
          <div className="mt-4 divide-y divide-white/[0.05]">{overview.history.map((entry) => <div key={entry.id} className="flex items-start gap-3 py-3"><div className={`mt-0.5 ${entry.status === "published" ? "text-emerald-400" : "text-rose-400"}`}>{entry.status === "published" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold uppercase text-zinc-400">{entry.provider}</span><span className="text-[9px] text-zinc-600">{new Date(entry.publishedAt).toLocaleString("pt-BR")}</span></div><p className="mt-1 truncate text-[11px] text-zinc-500">{entry.textPreview || entry.error}</p></div>{entry.url && <a href={entry.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 hover:text-emerald-300"><Send size={11} /> Abrir</a>}</div>)}</div>
        )}
      </section>

      <section className="rounded-2xl border border-white/[0.07] bg-[#111114] p-5">
        <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-zinc-300"><MessageCircle size={14} /> Interações recebidas</h3><span className="text-[10px] text-zinc-600">Últimas {overview.inboundHistory.length}</span></div>
        {overview.inboundHistory.length === 0 ? <p className="py-7 text-center text-[11px] text-zinc-600">Mencione o bot em um canal permitido. As respostas e bloqueios aparecerão aqui.</p> : (
          <div className="mt-4 divide-y divide-white/[0.05]">{overview.inboundHistory.map((entry) => <div key={entry.id} className="flex items-start gap-3 py-3">
            <div className={`mt-0.5 ${entry.status === "responded" ? "text-emerald-400" : entry.status === "failed" ? "text-rose-400" : "text-amber-400"}`}>{entry.status === "responded" ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}</div>
            <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-[10px] font-bold text-zinc-400">{entry.username || entry.userId}</span><span className="text-[9px] uppercase text-zinc-600">{entry.status}</span><span className="text-[9px] text-zinc-600">{new Date(entry.receivedAt).toLocaleString("pt-BR")}</span></div><p className="mt-1 truncate text-[11px] text-zinc-500">{entry.requestPreview}</p>{(entry.error || entry.reason) && <p className="mt-1 text-[10px] text-rose-300">{entry.error || `Ignorado: ${entry.reason}`}</p>}</div>
            {typeof entry.durationMs === "number" && <span className="text-[9px] text-zinc-600">{entry.durationMs} ms</span>}
          </div>)}</div>
        )}
      </section>
    </div>
  );
}

function DiscordInboundSettings({ config, status, onChange }: { config: Record<string, string>; status: DiscordGatewayRuntimeStatus; onChange: (next: Record<string, string>) => void }) {
  const update = (key: string, value: string) => onChange({ ...config, [key]: value });
  const statusColor = status.state === "connected" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/[0.05]" : status.state === "error" ? "text-rose-400 border-rose-500/20 bg-rose-500/[0.05]" : "text-amber-400 border-amber-500/20 bg-amber-500/[0.05]";
  return <div className="space-y-3 rounded-xl border border-indigo-500/15 bg-indigo-500/[0.035] p-3.5">
    <div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300"><Bot size={12} /> Bot bidirecional</p><p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Responde somente quando for mencionado em canais permitidos.</p></div><label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-300"><input type="checkbox" checked={config.inboundEnabled === "true"} onChange={(event) => update("inboundEnabled", String(event.target.checked))} /> Ativar</label></div>
    {config.inboundEnabled === "true" && <>
      <div className={`rounded-lg border px-2.5 py-2 text-[10px] ${statusColor}`}>Gateway: {status.state}{status.lastError ? ` — ${status.lastError}` : ""}</div>
      <ConfigField label="IDs de canais permitidos" value={config.allowedChannelIds || config.channelId || ""} placeholder="Um ou mais IDs separados por vírgula" onChange={(value) => update("allowedChannelIds", value)} />
      <ConfigField label="IDs de servidores permitidos (opcional)" value={config.allowedGuildIds || config.guildId || ""} placeholder="Vazio usa apenas a allowlist de canais" onChange={(value) => update("allowedGuildIds", value)} />
      <ConfigField label="IDs de usuários permitidos (opcional)" value={config.allowedUserIds || ""} placeholder="Vazio permite qualquer usuário do canal" onChange={(value) => update("allowedUserIds", value)} />
      <ConfigField label="Máximo de pedidos por usuário/minuto" value={config.maxRequestsPerMinute || "5"} placeholder="5" onChange={(value) => update("maxRequestsPerMinute", value.replace(/\D/g, "").slice(0, 2))} />
      <p className="text-[9px] leading-relaxed text-zinc-600">Use IDs copiados com o Modo desenvolvedor do Discord. O bot ignora mensagens sem menção e mensagens de outros bots.</p>
    </>}
  </div>;
}

function ConfigField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="block space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-indigo-500/40" /></label>;
}
