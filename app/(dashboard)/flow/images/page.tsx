'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FlowCompanionConnection } from '@/components/flow/FlowCompanionConnection';
import { flowImageFetch } from '@/lib/flow/companion-client';

type Result = { path: string; filename: string; paths?: string[]; createdAt: string };
export default function FlowImagesPage() {
  const [prompt, setPrompt] = useState('Uma pequena galinha astronauta branca em uma estufa lunar, plantas verdes e planeta Terra ao fundo. Ilustração 3D cinematográfica detalhada, sem texto.');
  const [ratio, setRatio] = useState('1:1');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  useEffect(() => {
    try { setResult(JSON.parse(sessionStorage.getItem('kaoz-flow-last-images') || 'null')); } catch { /* No saved result. */ }
    const onSaved = (event: Event) => setResult((event as CustomEvent<Result>).detail);
    window.addEventListener('kaoz-flow-images-saved', onSaved);
    return () => window.removeEventListener('kaoz-flow-images-saved', onSaved);
  }, []);
  async function generate() {
    setBusy(true); setError('');
    try {
      const response = await flowImageFetch('/api/flow/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image', prompt, quantity, aspectRatio: ratio, model: 'Nano Banana 2', operation: 'simple' }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'A geração não foi concluída.');
      setResult(data); sessionStorage.setItem('kaoz-flow-last-images', JSON.stringify(data));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <main className="mx-auto w-full max-w-4xl space-y-6 overflow-y-auto px-6 py-10 text-zinc-100">
    <Link href="/flow" className="text-sm text-zinc-400">← Voltar à conversa</Link>
    <div><h1 className="text-3xl font-semibold">Imagens com o Flow</h1><p className="mt-2 text-zinc-400">Crie no Chrome e receba os arquivos originais no Kaoz.1.</p></div>
    <FlowCompanionConnection />
    <section className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-5">
      <label htmlFor="image-prompt" className="block font-medium">Descreva a imagem</label>
      <textarea id="image-prompt" rows={5} maxLength={12000} className="w-full rounded-xl border border-white/15 bg-black/30 p-3" value={prompt} onChange={event => setPrompt(event.target.value)} />
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">Formato<select aria-label="Formato" className="ml-2 rounded bg-zinc-800 p-2" value={ratio} onChange={event => setRatio(event.target.value)}>{['1:1', '16:9', '9:16', '4:3', '3:4'].map(value => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Quantidade<select aria-label="Quantidade" className="ml-2 rounded bg-zinc-800 p-2" value={quantity} onChange={event => setQuantity(event.target.value)}>{['1', '2', '3', '4'].map(value => <option key={value}>{value}</option>)}</select></label>
        <button disabled={busy || !prompt.trim()} onClick={() => void generate()} className="rounded-xl bg-lime-300 px-5 py-3 font-medium text-black disabled:opacity-40">{busy ? 'Gerando…' : 'Gerar imagens'}</button>
      </div>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    </section>
    {result && <section><h2 className="mb-4 text-xl">Imagens salvas no Kaoz</h2><div className="grid gap-5 sm:grid-cols-2">{(result.paths || [result.path]).map((file, index) => {
      const url = `/api/flow/media?path=${encodeURIComponent(file)}`;
      return <figure key={file} className="space-y-2"><img className="w-full rounded-xl" src={url} alt={`Imagem ${index + 1} gerada no Flow`} /><figcaption><a className="text-lime-300" href={`${url}&download=true`}>Baixar imagem {index + 1}</a></figcaption></figure>;
    })}</div></section>}
  </main>;
}
