"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Bot, CheckCircle2, Clock3, Link2, Loader2, MessageCircle, PlugZap, Save, Send, ShieldCheck, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import type { ConnectorAccount, ConnectorDefinition, ConnectorHistoryEntry, ConnectorInboundHistoryEntry, ConnectorProvider, DiscordGatewayRuntimeStatus, TelegramPollingRuntimeStatus } from "@/services/connectors/connector.types";
import { isConnectorInboundEnabled } from "@/services/connectors/connector.catalog";

interface StatusMessage { text: string; type: "success" | "error" | "info"; }
interface Overview { catalog: ConnectorDefinition[]; accounts: ConnectorAccount[]; history: ConnectorHistoryEntry[]; inboundHistory: ConnectorInboundHistoryEntry[]; discordGateway: DiscordGatewayRuntimeStatus; telegramPolling: TelegramPollingRuntimeStatus; }

const EMPTY: Overview = { catalog: [], accounts: [], history: [], inboundHistory: [], discordGateway: { state: "stopped", reconnectCount: 0 }, telegramPolling: { state: "stopped", reconnectCount: 0 } };

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 127.14 96.36" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5c.89-.65,1.76-1.34,2.58-2.06a75.48,75.48,0,0,0,72.9,0c.82.72,1.69,1.41,2.58,2.06a68.43,68.43,0,0,1-10.5,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129,54.65,122.54,31.58,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z"/>
    </svg>
  );
}

function BlueskyIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M111.8 62.2C170.2 105.9 226.7 186 256 240.3c29.3-54.3 85.8-134.4 144.2-178.1c51.4-38.5 111.8-52.8 111.8 35.7c0 14.9-5.1 120.3-8.2 163.6c-7.6 104.9-57 141-118.5 158.7c-50.5 14.5-98.8-12.7-129.3-43.2c-30.5 30.5-78.8 57.7-129.3 43.2C75.2 381.7 25.8 345.6 18.2 240.7C15.1 197.4 10 92 10 77.1c0-88.5 60.4-74.2 111.8-14.9z"/>
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
  );
}

function LinkedinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0z"/>
    </svg>
  );
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.64 6.8c-.15 1.58-.8 5.42-1.13 7.19-.14.75-.42 1-.68 1.03-.58.05-1.02-.38-1.58-.75-.88-.58-1.38-.94-2.23-1.5-.99-.65-.35-1.01.22-1.59.15-.15 2.71-2.48 2.76-2.69.01-.03.01-.14-.07-.2-.08-.06-.19-.04-.27-.02-.12.02-1.96 1.24-5.54 3.65-.52.36-.99.53-1.41.52-.46-.01-1.35-.26-2.01-.48-.81-.27-1.46-.42-1.4-.88.03-.24.37-.49 1.03-.75 4.04-1.76 6.74-2.92 8.09-3.48 3.85-1.6 4.64-1.88 5.17-1.89.11 0 .37.03.54.17.14.12.18.28.2.45-.02.07-.02.13-.03.19z"/>
    </svg>
  );
}

function YoutubeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.108C19.524 3.545 12 3.545 12 3.545s-7.525 0-9.388.51A3.003 3.003 0 0 0 .502 6.163C0 8.07 0 12 0 12s0 3.93.502 5.837a3.003 3.003 0 0 0 2.11 2.108c1.863.51 9.388.51 9.388.51s7.525 0 9.388-.51a3.003 3.003 0 0 0 2.11-2.108C24 15.93 24 12 24 12s0-3.93-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5"/>
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>
    </svg>
  );
}

function getProviderIcon(provider: ConnectorProvider, className?: string) {
  switch (provider) {
    case "discord":
      return <DiscordIcon className={className} />;
    case "bluesky":
      return <BlueskyIcon className={className} />;
    case "x":
      return <XIcon className={className} />;
    case "linkedin":
      return <LinkedinIcon className={className} />;
    case "telegram":
      return <TelegramIcon className={className} />;
    case "youtube":
      return <YoutubeIcon className={className} />;
    case "instagram":
      return <InstagramIcon className={className} />;
    default:
      return <PlugZap className={className} />;
  }
}

function getProviderStyle(provider: ConnectorProvider) {
  switch (provider) {
    case "discord":
      return {
        bg: "bg-[#5865F2]/10",
        text: "text-[#5865F2]",
        border: "border-[#5865F2]/20"
      };
    case "bluesky":
      return {
        bg: "bg-[#0285FF]/10",
        text: "text-[#0285FF]",
        border: "border-[#0285FF]/20"
      };
    case "x":
      return {
        bg: "bg-white/10",
        text: "text-zinc-100",
        border: "border-white/20"
      };
    case "linkedin":
      return {
        bg: "bg-[#0A66C2]/10",
        text: "text-[#0A66C2]",
        border: "border-[#0A66C2]/20"
      };
    case "telegram":
      return {
        bg: "bg-[#26A5E4]/10",
        text: "text-[#26A5E4]",
        border: "border-[#26A5E4]/20"
      };
    case "youtube":
      return {
        bg: "bg-[#FF0000]/10",
        text: "text-[#FF0000]",
        border: "border-[#FF0000]/20"
      };
    case "instagram":
      return {
        bg: "bg-pink-500/10",
        text: "text-pink-400",
        border: "border-pink-500/20"
      };
    default:
      return {
        bg: "bg-emerald-500/10",
        text: "text-emerald-400",
        border: "border-emerald-500/20"
      };
  }
}

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
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

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

      <div className="grid gap-4 lg:grid-cols-2 items-start">
        {overview.catalog.map((definition) => {
          const account = accountByProvider.get(definition.provider);
          const health = healthLabel(account);
          const isBusy = busy?.endsWith(account?.id || definition.provider);
          const isExpanded = expandedProvider === definition.provider;
          const style = getProviderStyle(definition.provider);
          const isPlanned = definition.availability === "planned";

          return (
            <section
              key={definition.provider}
              onClick={() => {
                if (!isPlanned) {
                  setExpandedProvider(isExpanded ? null : definition.provider);
                }
              }}
              className={`rounded-2xl border transition-all duration-300 ease-in-out select-none ${
                isPlanned
                  ? "border-white/[0.05] bg-white/[0.015] opacity-65"
                  : isExpanded
                  ? "border-white/[0.15] bg-white/[0.03] shadow-[0_0_25px_rgba(112,0,255,0.06)]"
                  : "border-white/[0.08] bg-white/[0.01] hover:bg-white/[0.025] hover:border-white/[0.14] hover:shadow-[0_0_20px_rgba(112,0,255,0.04)] cursor-pointer"
              }`}
            >
              <div className="flex items-start justify-between gap-3 p-5">
                <div className="flex items-start gap-3.5 min-w-0">
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${style.bg} ${style.text} ${style.border} transition-colors duration-300`}>
                    {getProviderIcon(definition.provider, "h-5 w-5")}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-zinc-100">{definition.name}</h3>
                      {!isPlanned && (
                        <span className={`flex shrink-0 items-center gap-1.5 text-[10px] font-bold ${health.color}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${health.dot}`} />
                          {health.label}
                        </span>
                      )}
                    </div>
                    <p className={`mt-1 text-[11px] leading-relaxed text-zinc-500 transition-all duration-300 ${isExpanded ? "" : "line-clamp-1"}`}>
                      {definition.description}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {definition.capabilities.map((capability) => (
                        <span key={capability} className="rounded-md border border-white/[0.04] bg-black/20 px-1.5 py-0.5 text-[8.5px] text-zinc-500">
                          {capability.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 self-start mt-1">
                  {isPlanned ? (
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-zinc-500">Em breve</span>
                  ) : (
                    <div className="text-zinc-500 hover:text-zinc-300 transition-colors">
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </div>
                  )}
                </div>
              </div>

              {!isPlanned && isExpanded && (
                <div onClick={(e) => e.stopPropagation()} className="border-t border-white/[0.06] bg-black/[0.12] p-5 space-y-4 rounded-b-2xl">
                  <label className="block space-y-1.5">
                    <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Nome desta conexão</span>
                    <input value={displayNames[definition.provider] ?? account?.displayName ?? definition.name} onChange={(event) => setDisplayNames((current) => ({ ...current, [definition.provider]: event.target.value }))} className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-zinc-200 outline-none focus:border-emerald-500/40" />
                  </label>
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
                  {definition.provider === "telegram" && <TelegramInboundSettings
                    config={publicConfigs.telegram || account?.publicConfig || {}}
                    status={overview.telegramPolling}
                    onChange={(next) => setPublicConfigs((current) => ({ ...current, telegram: next }))}
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
  const inboundEnabled = isConnectorInboundEnabled("discord", config);
  return <div className="space-y-3 rounded-xl border border-indigo-500/15 bg-indigo-500/[0.035] p-3.5">
    <div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-indigo-300"><Bot size={12} /> Bot bidirecional</p><p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Responde somente quando for mencionado em canais permitidos.</p></div><label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-300"><input type="checkbox" checked={inboundEnabled} onChange={(event) => update("inboundEnabled", String(event.target.checked))} /> Bidirecional</label></div>
    {inboundEnabled && <>
      <div className={`rounded-lg border px-2.5 py-2 text-[10px] ${statusColor}`}>Gateway: {status.state}{status.lastError ? ` — ${status.lastError}` : ""}</div>
      <ConfigField label="IDs de canais permitidos" value={config.allowedChannelIds || config.channelId || ""} placeholder="Um ou mais IDs separados por vírgula" onChange={(value) => update("allowedChannelIds", value)} />
      <ConfigField label="IDs de servidores permitidos (opcional)" value={config.allowedGuildIds || config.guildId || ""} placeholder="Vazio usa apenas a allowlist de canais" onChange={(value) => update("allowedGuildIds", value)} />
      <ConfigField label="IDs de usuários permitidos (opcional)" value={config.allowedUserIds || ""} placeholder="Vazio permite qualquer usuário do canal" onChange={(value) => update("allowedUserIds", value)} />
      <ConfigField label="Máximo de pedidos por usuário/minuto" value={config.maxRequestsPerMinute || "5"} placeholder="5" onChange={(value) => update("maxRequestsPerMinute", value.replace(/\D/g, "").slice(0, 2))} />
      <p className="text-[9px] leading-relaxed text-zinc-600">Use IDs copiados com o Modo desenvolvedor do Discord. O bot ignora mensagens sem menção e mensagens de outros bots.</p>
    </>}
  </div>;
}

function TelegramInboundSettings({ config, status, onChange }: { config: Record<string, string>; status: TelegramPollingRuntimeStatus; onChange: (next: Record<string, string>) => void }) {
  const update = (key: string, value: string) => onChange({ ...config, [key]: value });
  const statusColor = status.state === "connected" ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/[0.05]" : status.state === "error" ? "text-rose-400 border-rose-500/20 bg-rose-500/[0.05]" : "text-amber-400 border-amber-500/20 bg-amber-500/[0.05]";
  const inboundEnabled = isConnectorInboundEnabled("telegram", config);
  return <div className="space-y-3 rounded-xl border border-sky-500/15 bg-sky-500/[0.035] p-3.5">
    <div className="flex items-center justify-between gap-3"><div><p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-sky-300"><Bot size={12} /> Bot bidirecional</p><p className="mt-1 text-[10px] leading-relaxed text-zinc-500">Responde no chat configurado usando polling seguro, sem webhook público.</p></div><label className="flex cursor-pointer items-center gap-2 text-[10px] text-zinc-300"><input type="checkbox" checked={inboundEnabled} onChange={(event) => update("inboundEnabled", String(event.target.checked))} /> Bidirecional</label></div>
    {inboundEnabled && <>
      <div className={`rounded-lg border px-2.5 py-2 text-[10px] ${statusColor}`}>Polling: {status.state}{status.lastError ? ` — ${status.lastError}` : ""}</div>
      <ConfigField label="IDs de chats permitidos" value={config.allowedChatIds || config.chatId || ""} placeholder="Usa o chat configurado por padrão" onChange={(value) => update("allowedChatIds", value)} />
      <ConfigField label="IDs de usuários permitidos (opcional)" value={config.allowedUserIds || ""} placeholder="Vazio permite usuários do chat autorizado" onChange={(value) => update("allowedUserIds", value)} />
      <ConfigField label="Máximo de pedidos por usuário/minuto" value={config.maxRequestsPerMinute || "5"} placeholder="5" onChange={(value) => update("maxRequestsPerMinute", value.replace(/\D/g, "").slice(0, 2))} />
      <p className="text-[9px] leading-relaxed text-zinc-600">Para conversar em privado, configure o ID daquele chat como destino e envie primeiro /start ao bot no Telegram.</p>
    </>}
  </div>;
}

function ConfigField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="block space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-indigo-500/40" /></label>;
}
