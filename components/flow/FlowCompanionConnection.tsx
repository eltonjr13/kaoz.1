'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { companionSnapshot, connectCompanion, isDesktopFlow, mountCompanion, subscribeCompanion } from '@/lib/flow/companion-client';

type DesktopCompanionState = {
  connected: boolean;
  busy: boolean;
  message: string;
  registered?: boolean;
  registrationReason?: string;
  extensionId?: string;
  version?: string;
};

function describeDesktopConnection(state: DesktopCompanionState): string {
  if (state.connected) return `Conectado${state.version ? ` · v${state.version}` : ''}`;
  return state.registered ? 'Aguardando extensão' : 'Ponte indisponível';
}

function hasRegistrationProblem(state: DesktopCompanionState): boolean {
  if (state.registered) return false;
  if (!state.registrationReason) return false;
  return state.registrationReason !== 'not-started';
}

function resolveExtensionIdFromLocation(): string {
  try {
    return new URLSearchParams(location.search).get('extensionId') || localStorage.getItem('kaoz-flow-extension-id') || '';
  } catch {
    return '';
  }
}

async function readDesktopCompanionState(): Promise<DesktopCompanionState | null> {
  try {
    return (await window.kaoz1Desktop?.getFlowCompanionStatus()) || null;
  } catch {
    return null;
  }
}

function describeDesktopCompactLabel(state: DesktopCompanionState): string {
  if (state.busy) return 'Gerando no Chrome…';
  return state.connected ? 'Chrome conectado' : 'Conectar Chrome';
}

function describeBrowserCompactLabel(state: CompanionState): string {
  return state.busy ? 'Gerando no Chrome…' : 'Imagens · Chrome';
}

async function openChromeCompanion(): Promise<string | null> {
  try {
    const result = await window.kaoz1Desktop?.openFlowCompanion();
    if (!result || result.opened) return null;
    return result.message || 'Não foi possível abrir o Chrome.';
  } catch {
    return null;
  }
}

export function FlowCompanionProvider({ children }: { children: React.ReactNode }) {
  useEffect(mountCompanion, []);
  return children;
}

export function FlowCompanionConnection({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState(companionSnapshot);
  const [desktop, setDesktop] = useState(true);
  const [desktopState, setDesktopState] = useState<DesktopCompanionState>({ connected: false, busy: false, message: 'Verificando a extensão no Chrome…' });
  const [id, setId] = useState('');
  useEffect(() => {
    const isDesktop = isDesktopFlow();
    setDesktop(isDesktop);
    setId(resolveExtensionIdFromLocation());
    if (isDesktop) {
      let active = true;
      const refresh = async () => {
        const next = await readDesktopCompanionState();
        if (active && next) setDesktopState(next);
      };
      void refresh();
      const timer = window.setInterval(() => void refresh(), 3000);
      return () => { active = false; window.clearInterval(timer); };
    }
    return subscribeCompanion(() => setState(companionSnapshot()));
  }, []);
  if (desktop) {
    if (compact) return <Link className="absolute right-4 top-6 z-50 rounded-full border border-white/15 bg-black/80 px-3 py-2 text-xs text-zinc-200" href="/flow/images">{describeDesktopCompactLabel(desktopState)}</Link>;
    const openChrome = async () => {
      const problem = await openChromeCompanion();
      if (problem) setDesktopState(current => ({ ...current, message: problem }));
    };
    return <section className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <h2 className="font-semibold">Flow pelo Chrome</h2>
      <p className="my-3 text-sm text-zinc-300" role="status">{desktopState.message}</p>
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-3 py-1 text-xs ${desktopState.connected ? 'bg-lime-300/15 text-lime-200' : 'bg-amber-300/15 text-amber-200'}`}>
          {describeDesktopConnection(desktopState)}
        </span>
        {!desktopState.connected && <button className="rounded-lg bg-lime-300 px-4 py-2 text-sm font-medium text-black" onClick={() => void openChrome()}>Abrir extensão no Chrome</button>}
      </div>
      {hasRegistrationProblem(desktopState) && (
        <p className="mt-3 text-xs text-amber-200/80">Motivo registrado: {desktopState.registrationReason}</p>
      )}
      <p className="mt-3 text-xs text-zinc-400">As imagens do aplicativo desktop usam sua sessão normal do Google Flow no Chrome.</p>
    </section>;
  }
  if (compact) return <Link className="absolute right-4 top-6 z-50 rounded-full border border-white/15 bg-black/80 px-3 py-2 text-xs text-zinc-200" href="/flow/images">{describeBrowserCompactLabel(state)}</Link>;
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
