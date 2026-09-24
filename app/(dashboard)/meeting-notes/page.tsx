"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Circle, FileText, Mic, Pause, Play, RotateCcw, Square } from "lucide-react";
import { useMeetingNotes } from "@/components/meeting-notes/MeetingNotesProvider";
import type { MeetingSegmentTag, MeetingSession } from "@/lib/meeting-notes/meeting-notes-store";
import { summarizeMeeting } from "@/lib/meeting-notes/meeting-digest";
import type { MeetingDigest } from "@/lib/meeting-notes/meeting-digest";

interface MeetingListItem {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  segmentCount: number;
  pendingCount: number;
}

function clock(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : "Não foi possível concluir a operação.";
}

function DigestSection({ title, items }: { title: string; items: MeetingDigest["summary"] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
      <h3 className="mb-3 text-sm font-semibold text-white">{title}</h3>
      {items.length ? (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.segmentId} className="text-sm leading-relaxed text-zinc-300">
              <a href={`#segment-${item.segmentId}`} className="mr-2 font-mono text-xs text-violet-300 hover:underline">{clock(item.startMs)}</a>
              {item.text}
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-zinc-500">Nenhum trecho identificado.</p>}
    </section>
  );
}

// The page coordinates separate capture, persistence and digest modules.
// eslint-disable-next-line complexity
export default function MeetingNotesPage() {
  const { activeSession, captureState, preview, error: captureError, pendingCount, start, pause, stop, clearError } = useMeetingNotes();
  const [sessions, setSessions] = useState<MeetingListItem[]>([]);
  const [selected, setSelected] = useState<MeetingSession | null>(null);
  const [digest, setDigest] = useState<MeetingDigest | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [pageError, setPageError] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const selectedIdRef = useRef<string | null>(null);
  const notesRef = useRef("");
  const savedNotesRef = useRef("");

  const loadList = useCallback(async () => {
    const response = await fetch("/api/meeting-notes", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { sessions?: MeetingListItem[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "Falha ao carregar reuniões.");
    setSessions(payload.sessions || []);
    return payload.sessions || [];
  }, []);

  const select = useCallback(async (id: string) => {
    const response = await fetch(`/api/meeting-notes/${id}`, { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { session?: MeetingSession; digest?: MeetingDigest; error?: string };
    if (!response.ok || !payload.session) throw new Error(payload.error || "Falha ao abrir reunião.");
    selectedIdRef.current = id;
    setSelected(payload.session);
    setDigest(payload.digest || null);
    setTitleDraft(payload.session.title);
    setNotesDraft(payload.session.notes);
    notesRef.current = payload.session.notes;
    savedNotesRef.current = payload.session.notes;
  }, []);

  useEffect(() => {
    void loadList().then((items) => {
      const id = activeSession?.id || items[0]?.id;
      if (id && !selectedIdRef.current) void select(id).catch((cause) => setPageError(messageFrom(cause)));
    }).catch((cause) => setPageError(messageFrom(cause)));
  }, [loadList, select]);

  useEffect(() => {
    if (!activeSession) return;
    void loadList().catch((cause) => setPageError(messageFrom(cause)));
    if (selectedIdRef.current !== activeSession.id && captureState === "recording") {
      selectedIdRef.current = activeSession.id;
      setSelected(activeSession);
      setDigest(summarizeMeeting(activeSession));
      setTitleDraft(activeSession.title);
      setNotesDraft(activeSession.notes);
      notesRef.current = activeSession.notes;
      savedNotesRef.current = activeSession.notes;
    } else if (selectedIdRef.current === activeSession.id) {
      setSelected(activeSession);
      setDigest(summarizeMeeting(activeSession));
      if (notesRef.current === savedNotesRef.current) {
        setNotesDraft(activeSession.notes);
        notesRef.current = activeSession.notes;
        savedNotesRef.current = activeSession.notes;
      }
    }
  }, [activeSession, captureState, loadList]);

  const patch = async (id: string, body: object) => {
    const response = await fetch(`/api/meeting-notes/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as { session?: MeetingSession; digest?: MeetingDigest; error?: string };
    if (!response.ok || !payload.session) throw new Error(payload.error || "Falha ao salvar reunião.");
    setSelected(payload.session);
    setDigest(payload.digest || null);
    void loadList().catch(() => undefined);
    return payload.session;
  };

  useEffect(() => {
    const id = selected?.id;
    if (!id || notesDraft === savedNotesRef.current) return;
    const timer = setTimeout(() => {
      setSavingNotes(true);
      const written = notesRef.current;
      void patch(id, { notes: written })
        .then(() => { savedNotesRef.current = written; })
        .catch((cause) => setPageError(messageFrom(cause)))
        .finally(() => setSavingNotes(false));
    }, 700);
    return () => clearTimeout(timer);
  }, [notesDraft, selected?.id]);

  const saveNotesNow = async () => {
    if (!selected || notesRef.current === savedNotesRef.current) return;
    try {
      setSavingNotes(true);
      const written = notesRef.current;
      await patch(selected.id, { notes: written });
      savedNotesRef.current = written;
    } catch (cause) {
      setPageError(messageFrom(cause));
    } finally {
      setSavingNotes(false);
    }
  };

  const saveTitle = async () => {
    if (!selected || titleDraft.trim() === selected.title) return;
    try {
      await patch(selected.id, { title: titleDraft });
    } catch (cause) {
      setPageError(messageFrom(cause));
    }
  };

  const updateSegment = async (id: string, change: { text?: string; tag?: MeetingSegmentTag }) => {
    if (!selected) return;
    try {
      await patch(selected.id, { segment: { id, ...change } });
    } catch (cause) {
      setPageError(messageFrom(cause));
    }
  };

  const retryChunk = async (chunkId: string) => {
    if (!selected) return;
    try {
      const response = await fetch(`/api/meeting-notes/${selected.id}/segments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chunkId, retry: true, runtime: window.kaoz1Desktop ? "desktop" : "web" }),
      });
      const payload = await response.json().catch(() => ({})) as { session?: MeetingSession; digest?: MeetingDigest; error?: string };
      if (!response.ok || !payload.session) throw new Error(payload.error || "Falha ao reprocessar áudio.");
      setSelected(payload.session);
      setDigest(payload.digest || null);
    } catch (cause) {
      setPageError(messageFrom(cause));
    }
  };

  const selectedIsActive = selected?.id === activeSession?.id && captureState !== "idle";
  const recording = selectedIsActive && captureState === "recording";

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#0b0d13] px-5 py-7 text-zinc-200 md:px-9">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">Kaoz.1 acompanha e registra</p>
            <h1 className="text-3xl font-semibold tracking-tight text-white">Anotações de reunião</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-400">Grave pelo microfone, revise a transcrição e marque decisões e próximos passos.</p>
          </div>
          {captureState !== "idle" && (
            <div className="flex items-center gap-2 rounded-full border border-red-400/30 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
              {captureState === "recording" ? "Microfone ligado · gravando" : "Finalizando captura"}
            </div>
          )}
        </header>

        {(pageError || captureError) && (
          <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100">
            <AlertCircle size={17} className="mt-0.5 shrink-0" />
            <span>{pageError || captureError}</span>
            <button type="button" className="ml-auto text-xs underline" onClick={() => { setPageError(""); clearError(); }}>Fechar</button>
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="h-fit rounded-2xl border border-white/10 bg-white/[0.035] p-4">
            <label htmlFor="meeting-new-title" className="text-xs font-semibold text-zinc-400">Nova reunião</label>
            <input id="meeting-new-title" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} placeholder="Nome da reunião" maxLength={160} className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-violet-400" />
            <button type="button" disabled={captureState !== "idle"} onClick={() => void start(undefined, newTitle)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-violet-500 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
              <Mic size={16} /> Iniciar e gravar
            </button>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">Use com o conhecimento dos participantes. A captura é só do microfone; falas registradas viram notas, nunca comandos da agente. Ao ocultar o app na bandeja a gravação continua; sair completamente do app encerra a captura.</p>
            <div className="mt-6 border-t border-white/10 pt-4">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">Reuniões</h2>
              <div className="space-y-1">
                {sessions.map((item) => (
                  <button key={item.id} type="button" onClick={() => void select(item.id).catch((cause) => setPageError(messageFrom(cause)))} className={`w-full rounded-lg p-3 text-left text-sm transition ${selected?.id === item.id ? "bg-violet-500/15 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-white"}`}>
                    <span className="block truncate font-medium">{item.title}</span>
                    <span className="mt-1 block text-xs text-zinc-500">{new Date(item.createdAt).toLocaleDateString("pt-BR")} · {item.segmentCount} trechos</span>
                  </button>
                ))}
                {!sessions.length && <p className="text-xs text-zinc-500">Nenhuma reunião registrada.</p>}
              </div>
            </div>
          </aside>

          <div className="min-w-0 space-y-5">
            {!selected ? (
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-10 text-center text-sm text-zinc-500">
                <FileText size={28} className="mx-auto mb-3 text-zinc-600" />
                Inicie uma reunião para acompanhar a transcrição aqui.
              </div>
            ) : (
              <>
                <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <input aria-label="Título da reunião" value={titleDraft} onChange={(event) => setTitleDraft(event.target.value)} onBlur={() => void saveTitle()} maxLength={160} className="min-w-[200px] flex-1 border-b border-transparent bg-transparent py-1 text-xl font-semibold text-white outline-none focus:border-violet-400" />
                    {selected.status === "stopped" ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-300"><Check size={14} /> Encerrada</span>
                    ) : selectedIsActive && recording ? (
                      <>
                        <button type="button" onClick={() => void pause()} className="flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/5"><Pause size={15} /> Pausar</button>
                        <button type="button" onClick={() => void stop()} className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200"><Square size={14} /> Encerrar</button>
                      </>
                    ) : (
                      <>
                        <button type="button" disabled={captureState !== "idle"} onClick={() => void start(selected)} className="flex items-center gap-2 rounded-lg bg-violet-500 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play size={15} /> {selected.status === "draft" ? "Gravar" : "Retomar"}</button>
                        {selected.status === "paused" && <button type="button" disabled={captureState !== "idle"} onClick={() => void patch(selected.id, { status: "stopped" }).catch((cause) => setPageError(messageFrom(cause)))} className="rounded-lg border border-white/15 px-3 py-2 text-sm disabled:opacity-50">Encerrar</button>}
                      </>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-zinc-500">{selected.segments.length} trechos salvos · {pendingCount ? `${pendingCount} em processamento` : "Tudo salvo"}</p>
                  {recording && <p aria-live="polite" className="mt-4 rounded-xl border border-violet-400/20 bg-violet-400/5 p-3 text-sm text-zinc-300">{preview || "Ouvindo... os trechos aparecerão após a transcrição."}</p>}
                </section>

                {!!selected.pendingChunks.length && (
                  <section className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-4">
                    <h2 className="text-sm font-semibold text-amber-200">Áudio aguardando transcrição</h2>
                    <p className="mt-1 text-xs text-amber-100/70">Trechos com falha ficam guardados localmente para reprocessamento. O áudio é removido após a transcrição.</p>
                    <div className="mt-3 space-y-2">
                      {selected.pendingChunks.map((chunk) => (
                        <div key={chunk.chunkId} className="flex items-center justify-between gap-2 text-xs text-zinc-300">
                          <span>{clock(chunk.startMs)}–{clock(chunk.endMs)} {chunk.error ? `· ${chunk.error}` : "· aguardando"}</span>
                          <button type="button" onClick={() => void retryChunk(chunk.chunkId)} className="flex shrink-0 items-center gap-1 rounded-md border border-white/15 px-2 py-1 hover:bg-white/5"><RotateCcw size={13} /> Reprocessar</button>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                  <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-white">Minhas anotações</h2><span className="text-xs text-zinc-500">{savingNotes ? "Salvando..." : "Salvo automaticamente"}</span></div>
                  <textarea aria-label="Anotações editáveis da reunião" value={notesDraft} onChange={(event) => { setNotesDraft(event.target.value); notesRef.current = event.target.value; }} onBlur={() => void saveNotesNow()} placeholder="Escreva observações, dúvidas e contexto que a transcrição não captou..." rows={5} maxLength={100000} className="w-full resize-y rounded-xl border border-white/10 bg-black/15 p-3 text-sm text-zinc-200 outline-none focus:border-violet-400" />
                </section>

                <section>
                  <div className="mb-3 flex items-center gap-2"><h2 className="text-base font-semibold text-white">Revisão da reunião</h2><span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-zinc-500">Rascunho verificável</span></div>
                  <p className="mb-4 text-xs text-zinc-500">Destaques e possíveis próximos passos são selecionados da transcrição. Confira o contexto antes de compartilhar. Responsáveis e prazos não são presumidos.</p>
                  <div className="grid gap-3 md:grid-cols-2">
                    <DigestSection title="Rascunho de destaques" items={digest?.summary || []} />
                    <DigestSection title="Decisões identificadas" items={digest?.decisions || []} />
                    <div className="md:col-span-2"><DigestSection title="Possíveis próximos passos" items={digest?.actions || []} /></div>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
                  <h2 className="mb-4 text-base font-semibold text-white">Transcrição</h2>
                  {selected.segments.length ? <div className="space-y-3">
                    {selected.segments.map((segment) => (
                      <article id={`segment-${segment.id}`} key={segment.id} className="scroll-mt-8 rounded-xl border border-white/10 bg-black/15 p-3">
                        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-xs text-violet-300">{clock(segment.startMs)}–{clock(segment.endMs)}</span>
                          <label className="flex items-center gap-2 text-xs text-zinc-500">Marcar como
                            <select aria-label={`Marcador do trecho ${clock(segment.startMs)}`} value={segment.tag} onChange={(event) => void updateSegment(segment.id, { tag: event.target.value as MeetingSegmentTag })} className="rounded-md border border-white/10 bg-[#171921] px-2 py-1 text-zinc-300">
                              <option value="none">Trecho</option><option value="highlight">Destaque</option><option value="decision">Decisão</option><option value="action">Próximo passo</option>
                            </select>
                          </label>
                        </div>
                        <textarea key={`${segment.id}-${segment.text}`} aria-label={`Texto do trecho ${clock(segment.startMs)}`} defaultValue={segment.text} onBlur={(event) => { if (event.target.value.trim() !== segment.text) void updateSegment(segment.id, { text: event.target.value }); }} rows={2} className="w-full resize-y bg-transparent text-sm leading-relaxed text-zinc-200 outline-none" />
                      </article>
                    ))}
                  </div> : <div className="flex items-center gap-2 text-sm text-zinc-500"><Circle size={10} /> A transcrição aparecerá aqui após o primeiro trecho.</div>}
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
