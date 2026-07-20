"use client";

import { useEffect, useState } from "react";

type Conversation = { id: string; channel: string; title: string; updatedAt: string; messageCount: number };
type SearchHit = { id: string; conversationId: string; channel: string; conversationTitle: string; content: string; createdAt: string };
type Identity = { id: string; channel: string; externalUserId: string; username?: string; linkedProfileId?: string };
type Stats = { conversations: number; messages: number; identities: number; pendingJobs: number; databaseBytes: number };

export function CortexConversationArchive() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [query, setQuery] = useState("");
  const [channel, setChannel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [opened, setOpened] = useState<{ conversation: Conversation; messages: Array<{ id: string; role: string; content: string; createdAt: string }> } | null>(null);

  const refresh = async () => {
    const [archiveResponse, identitiesResponse] = await Promise.all([fetch(`/api/conversations?limit=100${channel ? `&channel=${channel}` : ""}`), fetch('/api/cortex/identities')]);
    const archive = await archiveResponse.json();
    const identityData = await identitiesResponse.json();
    setConversations(archive.conversations || []);
    setStats(archive.stats || null);
    setIdentities((identityData.identities || []).filter((identity: Identity) => identity.channel !== 'flow'));
  };

  useEffect(() => { void refresh(); }, [channel]);

  const search = async () => {
    if (!query.trim()) { setResults([]); return; }
    const params = new URLSearchParams({ q: query });
    if (channel) params.set('channel', channel);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(`${to}T23:59:59`).toISOString());
    const response = await fetch(`/api/conversations/search?${params}`);
    setResults((await response.json()).results || []);
  };

  const openConversation = async (id: string) => {
    const response = await fetch(`/api/conversations/${encodeURIComponent(id)}?limit=100&offset=0`);
    if (response.ok) setOpened(await response.json());
  };

  const removeConversation = async (conversation: Conversation) => {
    const forgetDerived = window.confirm('Tambem esquecer memorias quentes derivadas desta conversa?');
    if (!window.confirm(`Excluir permanentemente "${conversation.title}"?`)) return;
    await fetch(`/api/conversations/${encodeURIComponent(conversation.id)}?forgetDerived=${forgetDerived}`, { method: 'DELETE' });
    setOpened(null);
    await refresh();
  };

  const updateIdentity = async (identity: Identity, action: 'link' | 'unlink') => {
    const forgetDerived = action === 'unlink' && window.confirm('Ao desvincular, esquecer tambem memorias derivadas desta identidade?');
    await fetch(`/api/cortex/identities/${encodeURIComponent(identity.id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, forgetDerived }) });
    await refresh();
  };

  return <section className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-5 text-white">
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Arquivo de conversas</h2><p className="text-sm text-white/50">Histórico local pesquisável do Flow, Telegram e Discord.</p></div>
      {stats && <div className="text-xs text-white/50">{stats.conversations} conversas · {stats.messages} mensagens · {stats.pendingJobs} jobs · {(stats.databaseBytes / 1024 / 1024).toFixed(1)} MB</div>}
    </div>
    <div className="grid gap-2 md:grid-cols-[1fr_140px_150px_150px_auto]">
      <input className="rounded-lg border border-white/10 bg-white/5 px-3 py-2" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && void search()} placeholder="Pesquisar no histórico" />
      <select className="rounded-lg border border-white/10 bg-[#151515] px-3 py-2" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">Todos</option><option value="flow">Flow</option><option value="telegram">Telegram</option><option value="discord">Discord</option></select>
      <input type="date" className="rounded-lg border border-white/10 bg-white/5 px-2 py-2" value={from} onChange={(event) => setFrom(event.target.value)} />
      <input type="date" className="rounded-lg border border-white/10 bg-white/5 px-2 py-2" value={to} onChange={(event) => setTo(event.target.value)} />
      <button className="rounded-lg bg-violet-600 px-4 py-2" onClick={() => void search()}>Buscar</button>
    </div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <div className="space-y-2">{(results.length ? results : conversations).map((item) => <button key={item.id} onClick={() => void openConversation('conversationId' in item ? item.conversationId : item.id)} className="block w-full rounded-xl border border-white/10 p-3 text-left hover:bg-white/5"><div className="flex justify-between gap-3"><span className="font-medium">{'conversationTitle' in item ? item.conversationTitle : item.title}</span><span className="text-xs uppercase text-violet-300">{item.channel}</span></div>{'content' in item ? <p className="mt-1 line-clamp-2 text-sm text-white/60">{item.content}</p> : <p className="mt-1 text-xs text-white/45">{item.messageCount} mensagens · {new Date(item.updatedAt).toLocaleString()}</p>}</button>)}</div>
      {opened && <div className="rounded-xl border border-white/10 p-3"><div className="mb-3 flex items-center justify-between"><h3 className="font-semibold">{opened.conversation.title}</h3><button className="text-sm text-red-300" onClick={() => void removeConversation(opened.conversation)}>Excluir</button></div><div className="max-h-96 space-y-2 overflow-auto">{opened.messages.map((message) => <div key={message.id} className={`rounded-lg p-2 text-sm ${message.role === 'user' ? 'bg-violet-500/10' : 'bg-white/5'}`}><span className="text-xs uppercase text-white/40">{message.role}</span><p className="whitespace-pre-wrap">{message.content}</p></div>)}</div></div>}
    </div>
    <div className="mt-6"><h3 className="mb-2 font-semibold">Identidades observadas</h3><div className="space-y-2">{identities.map((identity) => <div key={identity.id} className="flex items-center justify-between rounded-lg border border-white/10 p-3 text-sm"><span>{identity.channel} · {identity.username || identity.externalUserId}</span><button className="rounded-md border border-white/15 px-3 py-1" onClick={() => void updateIdentity(identity, identity.linkedProfileId ? 'unlink' : 'link')}>{identity.linkedProfileId ? 'Desvincular' : 'Vincular ao usuário local'}</button></div>)}</div></div>
  </section>;
}
