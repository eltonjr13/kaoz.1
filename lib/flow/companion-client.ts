'use client';

type Reply = { ok: boolean; error?: string; version?: string; jobId?: string; status?: string; stage?: string; images?: { width: number; height: number }[]; dataUrl?: string };
type ChromeRuntime = { lastError?: { message?: string }; sendMessage: (id: string, message: unknown, callback: (response: Reply) => void) => void };
type Command = { id: string; prompt: string; options: Record<string, unknown> };
export type CompanionState = { connected: boolean; busy: boolean; message: string; version?: string };
let current: CompanionState = { connected: false, busy: false, message: 'Conecte a extensão para gerar imagens no Chrome.' };
const listeners = new Set<() => void>();
let runner: Promise<void> | null = null;
let consumers = 0;
let extensionId = '';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const isDesktopFlow = () => typeof window !== 'undefined' && 'kaoz1Desktop' in window;
function runtime() { return (window as Window & { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime; }
function setState(value: Partial<CompanionState>) { current = { ...current, ...value }; listeners.forEach(listener => listener()); }
export function companionSnapshot() { return current; }
export function subscribeCompanion(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

function token() {
  let value = sessionStorage.getItem('kaoz-flow-browser-token');
  if (!value) {
    value = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('kaoz-flow-browser-token', value);
  }
  return value;
}
export function companionHeaders() { return { 'Content-Type': 'application/json', 'x-kaoz-flow-browser': token() }; }

export function companionMessage(message: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const api = runtime();
    if (!api || !/^[a-p]{32}$/.test(extensionId)) return reject(new Error('Abra o Kaoz pelo botão Conectar ao Kaoz da extensão.'));
    const timer = setTimeout(() => reject(new Error('A extensão não respondeu. O pedido não será reenviado automaticamente.')), 40000);
    api.sendMessage(extensionId, message, response => {
      clearTimeout(timer);
      if (api.lastError) reject(new Error(api.lastError.message || 'A extensão desconectou.'));
      else if (!response?.ok) reject(new Error(response?.error || 'Resposta inválida da extensão.'));
      else resolve(response);
    });
  });
}

export async function connectCompanion(id?: string) {
  extensionId = (id || localStorage.getItem('kaoz-flow-extension-id') || '').trim();
  try {
    const result = await companionMessage({ type: 'ping' });
    if (!result.version || Number(result.version.split('.')[1]) < 2) throw new Error('Recarregue a extensão no Chrome para usar a versão 0.2.0 ou superior.');
    localStorage.setItem('kaoz-flow-extension-id', extensionId);
    setState({ connected: true, message: 'Flow Companion conectado.', version: result.version });
    startRunner();
  } catch (error) {
    setState({ connected: false, message: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function report(command: Command, payload: Record<string, unknown>) {
  const response = await fetch('/api/flow/companion', { method: 'POST', headers: companionHeaders(), body: JSON.stringify({ id: command.id, ...payload }) });
  if (!response.ok) throw new Error((await response.json()).error || 'Não foi possível salvar o resultado no Kaoz.');
  const saved = await response.json();
  if (saved.result?.success) {
    sessionStorage.setItem('kaoz-flow-last-images', JSON.stringify(saved.result));
    window.dispatchEvent(new CustomEvent('kaoz-flow-images-saved', { detail: saved.result }));
  }
}

async function runCommand(command: Command) {
  setState({ busy: true, message: 'Abrindo o Flow no Chrome…' });
  try {
    const { jobId } = await companionMessage({ type: 'start', requestId: command.id, prompt: command.prompt, options: command.options });
    for (let attempt = 0; attempt < 150; attempt++) {
      const result = await companionMessage({ type: 'status', jobId });
      setState({ message: result.stage || 'Gerando imagens no Flow…' });
      if (result.status === 'completed') {
        const images: string[] = [];
        for (let index = 0; index < (result.images?.length || 0); index++) {
          setState({ message: `Recebendo imagem ${index + 1}…` });
          const image = await companionMessage({ type: 'image', jobId, index });
          if (!image.dataUrl) throw new Error('O Flow não retornou a imagem original.');
          images.push(image.dataUrl);
        }
        await report(command, { images });
        await companionMessage({ type: 'acknowledge', jobId }).catch(() => {});
        setState({ busy: false, message: 'Imagens recebidas e salvas no Kaoz.' });
        return;
      }
      await sleep(2500);
    }
    throw new Error('A geração excedeu o tempo de espera. Confira a aba do Flow.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await report(command, { error: message });
    setState({ busy: false, message });
  }
}

function startRunner() {
  if (runner || !current.connected) return;
  runner = (async () => {
    while (consumers > 0 || current.busy) {
      try {
        const response = await fetch('/api/flow/companion', { headers: companionHeaders(), cache: 'no-store' });
        if (!response.ok) throw new Error('A conexão do Kaoz com a extensão ficou indisponível.');
        const { command } = await response.json() as { command: Command | null };
        if (command) await runCommand(command);
      } catch (error) { setState({ message: error instanceof Error ? error.message : String(error), busy: false }); }
      await sleep(1500);
    }
  })().finally(() => { runner = null; });
}

export function mountCompanion() {
  if (isDesktopFlow()) return () => {};
  consumers++;
  const queryId = new URLSearchParams(location.search).get('extensionId');
  void connectCompanion(queryId || undefined).catch(() => {});
  return () => { consumers = Math.max(0, consumers - 1); };
}

export async function flowImageFetch(url: string, init: RequestInit) {
  if (isDesktopFlow()) return fetch(url, init);
  const body = JSON.parse(String(init.body || '{}'));
  const kind = body.approvedPlan?.flow || body.type;
  if (!['image', 'ad-creative'].includes(kind)) return fetch(url, init);
  if (!current.connected) await connectCompanion();
  startRunner();
  return fetch(url, { ...init, headers: { ...init.headers, ...companionHeaders() } });
}
