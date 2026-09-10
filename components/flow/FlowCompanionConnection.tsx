'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { companionSnapshot, connectCompanion, isDesktopFlow, mountCompanion, subscribeCompanion } from '@/lib/flow/companion-client';

export function FlowCompanionProvider({ children }: { children: React.ReactNode }) {
  useEffect(mountCompanion, []);
  return children;
}

export function FlowCompanionConnection({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState(companionSnapshot);
  const [desktop, setDesktop] = useState(true);
  const [id, setId] = useState('');
  useEffect(() => {
    setDesktop(isDesktopFlow());
    setId(localStorage.getItem('kaoz-flow-extension-id') || '');
    return subscribeCompanion(() => setState(companionSnapshot()));
  }, []);
  if (desktop) return null;
  if (compact) return <Link className="absolute right-4 top-6 z-50 rounded-full border border-white/15 bg-black/80 px-3 py-2 text-xs text-zinc-200" href="/flow/images">{state.busy ? 'Gerando no Chrome…' : 'Imagens · Chrome'}</Link>;
  return <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
    <h2 className="font-semibold">Conexão com o Chrome</h2>
    <p className="my-3 text-sm text-zinc-300" role="status">{state.message}</p>
    {!state.connected && <>
      <p className="mb-3 text-sm text-zinc-400">Na extensão Kaoz Flow Companion, use Conectar ao Kaoz. Para instalar ou atualizar, consulte as instruções abaixo.</p>
      <label className="text-sm" htmlFor="companion-id">ID da extensão</label>
      <div className="mt-2 flex gap-2"><input id="companion-id" className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/30 p-2" value={id} onChange={event => setId(event.target.value)} /><button className="rounded-lg bg-lime-300 px-4 text-black" onClick={() => void connectCompanion(id).catch(() => {})}>Conectar</button></div>
    </>}
    <details className="mt-3 text-sm text-zinc-400"><summary className="cursor-pointer">Instalação e atualização da extensão</summary>
      <p className="mt-2">Abra chrome://extensions, ative Modo do desenvolvedor e carregue a pasta extensions/flow-companion do Kaoz. Se já estiver instalada, clique em Recarregar. Use a versão 0.2.0 ou superior.</p>
      <p className="mt-2">Mantenha esta aba aberta durante a geração. O Flow abrirá um projeto próprio e usará a conta conectada no Chrome.</p>
    </details>
  </section>;
}
