"use client";

import { ArrowUp, FileText, MessageCircle, Minimize2, Plus, StickyNote, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { detectQuickIntent, noteTitle } from "@/lib/quick-assistant/intent";
import styles from "./quick-assistant.module.css";

type Tab = "chat" | "notes" | "open";
type QuickMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  pending?: boolean;
  actionFlow?: string;
};
type QuickConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: QuickMessage[];
};
type Note = { id: string; title: string; content: string; createdAt: string; updatedAt: string };
type Target = { id: string; label: string; description: string };
type FlowEvent = { event: string; data: { text?: string; message?: string; error?: string; action?: { flow?: string } | null } };

const STORAGE_KEY = "kaoz1:quick-assistant:conversation";
const FLOW_CONVERSATIONS_KEY = "kaoz1:flow:chat_conversations";
const FLOW_ACTIVE_KEY = "kaoz1:flow:active_chat";
const MODEL_KEY = "kaoz1:flow:agent_model";
const MEMORY_KEY = "kaoz1:flow:use_cortex_memory";

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function newConversation(): QuickConversation {
  const now = new Date().toISOString();
  return { id: newId("chat"), title: "Conversa rápida", createdAt: now, updatedAt: now, messages: [] };
}

function readConversation(): QuickConversation {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as QuickConversation | null;
    if (!parsed || !/^chat-[a-z0-9-]+$/i.test(parsed.id) || !Array.isArray(parsed.messages)) return newConversation();
    const messages = parsed.messages.filter((item) => item && (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
      .map((item) => item.pending ? { ...item, pending: false, content: item.content || "Resposta interrompida." } : item);
    return { ...parsed, messages };
  } catch {
    return newConversation();
  }
}

function saveConversation(conversation: QuickConversation): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversation));
  } catch { /* The visible conversation remains usable if storage is full. */ }
}

function mirrorToFlow(conversation: QuickConversation): void {
  try {
    const parsed = JSON.parse(localStorage.getItem(FLOW_CONVERSATIONS_KEY) || "[]") as unknown;
    const previous = Array.isArray(parsed) ? parsed : [];
    const mirrored = {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.filter((item) => !item.pending && item.content.trim()),
    };
    localStorage.setItem(FLOW_CONVERSATIONS_KEY, JSON.stringify([mirrored, ...previous.filter((item) => item?.id !== conversation.id)]));
  } catch { /* Local panel history is still available. */ }
}

function appendMessages(conversation: QuickConversation, messages: QuickMessage[]): QuickConversation {
  const next = [...conversation.messages, ...messages];
  const firstRequest = next.find((item) => item.role === "user")?.content.split(/\r?\n/)[0].trim();
  return {
    ...conversation,
    title: firstRequest ? noteTitle(firstRequest) : conversation.title,
    updatedAt: new Date().toISOString(),
    messages: next,
  };
}

function parseFlowEvent(block: string): FlowEvent | null {
  const lines = block.split(/\r?\n/);
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const rawData = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  if (!rawData) return null;
  try { return { event, data: JSON.parse(rawData) }; } catch { return null; }
}

function emitFlowEvent(block: string, onEvent: (event: FlowEvent) => void): void {
  const parsed = parseFlowEvent(block);
  if (parsed) onEvent(parsed);
}

async function consumeFlowStream(response: Response, onEvent: (event: FlowEvent) => void): Promise<void> {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    onEvent({ event: "final", data: await response.json() });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";
    for (const block of blocks) emitFlowEvent(block, onEvent);
    if (done) break;
  }
  if (buffer.trim()) emitFlowEvent(buffer, onEvent);
}

async function parseApiError(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  return body?.error || body?.message || `${fallback} (HTTP ${response.status}).`;
}

// This component coordinates three compact views and their shared conversation state.
// eslint-disable-next-line complexity
export default function QuickAssistantPage() {
  const [conversation, setConversation] = useState<QuickConversation | null>(null);
  const conversationRef = useRef<QuickConversation | null>(null);
  const [tab, setTab] = useState<Tab>("chat");
  const [draft, setDraft] = useState("");
  const [pastedContext, setPastedContext] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [notes, setNotes] = useState<Note[]>([]);
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [noteTitleDraft, setNoteTitleDraft] = useState("");
  const [noteContentDraft, setNoteContentDraft] = useState("");
  const [projectTitleDraft, setProjectTitleDraft] = useState("");
  const [projectIdeaDraft, setProjectIdeaDraft] = useState("");
  const [openProjectInCode, setOpenProjectInCode] = useState(false);
  const [notice, setNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setConversation(readConversation());
    void loadNotes();
    void loadTargets();
  }, []);

  useEffect(() => {
    conversationRef.current = conversation;
    if (!conversation) return;
    const timer = setTimeout(() => saveConversation(conversation), 180);
    return () => clearTimeout(timer);
  }, [conversation]);

  useEffect(() => {
    const saveOnExit = () => { if (conversationRef.current) saveConversation(conversationRef.current); };
    window.addEventListener("pagehide", saveOnExit);
    return () => window.removeEventListener("pagehide", saveOnExit);
  }, []);

  useEffect(() => {
    if (tab === "chat") scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversation?.messages, tab]);

  async function loadNotes() {
    try {
      const response = await fetch("/api/assistant/notes", { cache: "no-store" });
      if (!response.ok) throw new Error(await parseApiError(response, "Falha ao carregar notas"));
      const data = await response.json() as { notes?: Note[] };
      setNotes(data.notes || []);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao carregar notas."); }
  }

  async function loadTargets(): Promise<Target[]> {
    try {
      const response = await fetch("/api/assistant/targets", { cache: "no-store" });
      if (!response.ok) throw new Error(await parseApiError(response, "Falha ao carregar aplicativos"));
      const data = await response.json() as { targets?: Target[] };
      const next = data.targets || [];
      setTargets(next);
      return next;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Falha ao carregar aplicativos.");
      return [];
    }
  }

  function addPendingUser(content: string): { current: QuickConversation; assistantId: string; userId: string } | null {
    const current = conversationRef.current;
    if (!current) return null;
    const now = new Date().toISOString();
    const userId = newId("msg");
    const assistantId = newId("msg");
    const next = appendMessages(current, [
      { id: userId, role: "user", content, timestamp: now },
      { id: assistantId, role: "assistant", content: "", timestamp: now, pending: true },
    ]);
    conversationRef.current = next;
    setConversation(next);
    saveConversation(next);
    return { current: next, assistantId, userId };
  }

  function finishAssistant(id: string, content: string, actionFlow?: string) {
    setConversation((previous) => {
      if (!previous) return previous;
      const next = {
        ...previous,
        updatedAt: new Date().toISOString(),
        messages: previous.messages.map((item) => item.id === id ? { ...item, content, pending: false, actionFlow } : item),
      };
      conversationRef.current = next;
      saveConversation(next);
      return next;
    });
  }

  async function createNote(title: string, content: string): Promise<Note> {
    const response = await fetch("/api/assistant/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    if (!response.ok) throw new Error(await parseApiError(response, "Falha ao salvar nota"));
    const data = await response.json() as { note?: Note };
    if (!data.note) throw new Error("A nota não foi confirmada pelo servidor.");
    setNotes((previous) => [data.note!, ...previous]);
    return data.note;
  }

  async function updateNote(id: string, title: string, content: string): Promise<Note> {
    const response = await fetch(`/api/assistant/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, content }),
    });
    if (!response.ok) throw new Error(await parseApiError(response, "Falha ao atualizar nota"));
    const data = await response.json() as { note?: Note };
    if (!data.note) throw new Error("A atualização não foi confirmada pelo servidor.");
    setNotes((previous) => previous.map((item) => item.id === id ? data.note! : item));
    return data.note;
  }

  async function openTarget(targetId: string): Promise<string> {
    const available = await loadTargets();
    const target = available.find((item) => item.id === targetId);
    if (!target) throw new Error("Este aplicativo não está disponível nas ações da Kaoz.1.");
    const response = await fetch("/api/assistant/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetId }),
    });
    if (!response.ok) throw new Error(await parseApiError(response, "Não foi possível abrir o aplicativo"));
    const data = await response.json() as { success?: boolean; message?: string };
    if (!data.success) throw new Error(data.message || "A abertura não foi confirmada.");
    return data.message || `${target.label} foi aberto.`;
  }

  async function createProject(title: string, idea: string, openInCode: boolean): Promise<string> {
    const response = await fetch("/api/assistant/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, idea, openInCode }),
    });
    if (!response.ok) throw new Error(await parseApiError(response, "Falha ao criar projeto"));
    const data = await response.json() as { success?: boolean; project?: { title: string; openedInCode: boolean }; message?: string };
    if (!data.success || !data.project) throw new Error(data.message || "A criação do projeto não foi confirmada.");
    if (openInCode && !data.project.openedInCode) return `Projeto “${data.project.title}” criado com um brief inicial. VS Code não foi encontrado para abertura automática.`;
    return data.message || `Projeto “${data.project.title}” criado com um brief inicial.`;
  }

  async function runLocalAction(content: string, action: () => Promise<string>): Promise<boolean> {
    const pending = addPendingUser(content);
    if (!pending) return false;
    setBusy(true);
    setStatus("Executando ação local...");
    try { finishAssistant(pending.assistantId, await action()); return true; }
    catch (error) { finishAssistant(pending.assistantId, error instanceof Error ? error.message : "A ação não foi concluída."); return false; }
    finally { setBusy(false); setStatus(""); }
  }

  async function sendToFlow(content: string) {
    const pending = addPendingUser(content);
    if (!pending) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setStatus("Kaoz.1 está preparando a resposta...");
    const memory = localStorage.getItem(MEMORY_KEY) !== "false";
    const model = localStorage.getItem(MODEL_KEY) || "gemini";
    let streamedText = "";
    let finalText = "";
    let actionFlow: string | undefined;
    try {
      const history = pending.current.messages.filter((item) => item.id !== pending.assistantId && item.content.trim()).slice(-12);
      const response = await fetch("/api/flow/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history.map((item) => ({ role: item.role === "user" ? "user" : "model", parts: [{ text: item.content }] })),
          model,
          stream: true,
          useCortexMemory: memory,
          sessionId: pending.current.id,
          taskId: pending.current.id,
          archiveContext: {
            conversationId: pending.current.id,
            userMessageId: pending.userId,
            assistantMessageId: pending.assistantId,
            title: pending.current.title,
          },
        }),
      });
      if (!response.ok) throw new Error(await parseApiError(response, "Falha na conversa"));
      await consumeFlowStream(response, ({ event, data }) => {
        if (event === "status") setStatus(data.text || "Kaoz.1 está trabalhando...");
        if (event === "chunk" && data.text) {
          streamedText += data.text;
          finishAssistant(pending.assistantId, streamedText);
        }
        if (event === "final") {
          finalText = data.message || streamedText;
          actionFlow = data.action?.flow;
        }
        if (event === "error") throw new Error(data.error || "Falha no stream da conversa.");
      });
      finishAssistant(pending.assistantId, finalText || streamedText || "Não recebi uma resposta.", actionFlow);
    } catch (error) {
      finishAssistant(pending.assistantId, controller.signal.aborted ? "Resposta interrompida." : error instanceof Error ? error.message : "Falha na conversa.");
    } finally {
      abortRef.current = null;
      setBusy(false);
      setStatus("");
    }
  }

  async function submitChat() {
    const message = draft.trim();
    if (!message || busy || !conversation) return;
    const context = pastedContext.trim();
    const content = context ? `${message}\n\n[Contexto colado pelo usuário]\n${context}` : message;
    setDraft("");
    setPastedContext("");
    const intent = detectQuickIntent(message);
    if (intent.kind === "note") {
      await runLocalAction(content, async () => {
        const body = context ? `${intent.content}\n\n${context}` : intent.content;
        const note = await createNote(noteTitle(intent.content), body);
        return `Nota “${note.title}” salva.`;
      });
      return;
    }
    if (intent.kind === "open") {
      await runLocalAction(content, () => openTarget(intent.targetId));
      return;
    }
    if (intent.kind === "project") {
      await runLocalAction(content, () => createProject(noteTitle(intent.idea), intent.idea, intent.openInCode));
      return;
    }
    if (intent.kind === "unsupported-local-action") {
      const pending = addPendingUser(content);
      if (pending) finishAssistant(pending.assistantId, "Ainda não tenho essa ação local cadastrada. Abra a seção ‘Abrir’ para ver os aplicativos disponíveis.");
      return;
    }
    await sendToFlow(content);
  }

  async function pasteContext() {
    try {
      const text = window.kaoz1QuickAssistant
        ? await window.kaoz1QuickAssistant.readClipboardText()
        : await navigator.clipboard.readText();
      if (!text?.trim()) { setNotice("A área de transferência não contém texto."); return; }
      setPastedContext(text.slice(0, 6000));
      setNotice("");
    } catch { setNotice("Não foi possível ler a área de transferência."); }
  }

  async function openMain(route: string) {
    try {
      if (conversation && route.startsWith("/flow")) {
        mirrorToFlow(conversation);
        localStorage.setItem(FLOW_ACTIVE_KEY, conversation.id);
      }
      if (window.kaoz1QuickAssistant) {
        const opened = await window.kaoz1QuickAssistant.openMain(route);
        if (!opened) setNotice("Não foi possível abrir esta área no aplicativo.");
      } else window.location.assign(route);
    } catch {
      setNotice("Não foi possível abrir o aplicativo.");
    }
  }

  async function submitNote() {
    const title = noteTitleDraft.trim();
    if (!title) return;
    setBusy(true);
    try {
      const note = selectedNoteId
        ? await updateNote(selectedNoteId, title, noteContentDraft.trim())
        : await createNote(title, noteContentDraft.trim());
      setSelectedNoteId(null);
      setNoteTitleDraft("");
      setNoteContentDraft("");
      setNotice(`Nota “${note.title}” salva.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Falha ao salvar nota."); }
    finally { setBusy(false); }
  }

  async function submitProject() {
    const title = projectTitleDraft.trim();
    const idea = projectIdeaDraft.trim();
    if (!title || !idea || busy) return;
    setTab("chat");
    const created = await runLocalAction(`Crie um projeto “${title}” para ${idea}${openProjectInCode ? " e abra no VS Code" : ""}`, () => createProject(title, idea, openProjectInCode));
    if (!created) return;
    setProjectTitleDraft("");
    setProjectIdeaDraft("");
    setOpenProjectInCode(false);
  }

  return (
    <main className={styles.panel} aria-label="Painel rápido da Kaoz.1">
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.brandMark}>K</span><div><strong>Kaoz.1</strong><small>Assistente rápida</small></div></div>
        <div className={styles.headerActions}>
          <button type="button" title="Abrir aplicativo completo" aria-label="Abrir aplicativo completo" onClick={() => void openMain(conversation ? `/flow/${conversation.id}` : "/flow")}><Minimize2 size={17} /></button>
          <button type="button" title="Ocultar painel" aria-label="Ocultar painel" onClick={() => { if (window.kaoz1QuickAssistant) void window.kaoz1QuickAssistant.hide(); else window.location.assign("/flow"); }}><X size={18} /></button>
        </div>
      </header>

      <nav className={styles.tabs} aria-label="Áreas do painel rápido">
        <button type="button" className={tab === "chat" ? styles.activeTab : ""} onClick={() => setTab("chat")}><MessageCircle size={15} /> Conversar</button>
        <button type="button" className={tab === "notes" ? styles.activeTab : ""} onClick={() => setTab("notes")}><StickyNote size={15} /> Notas</button>
        <button type="button" className={tab === "open" ? styles.activeTab : ""} onClick={() => setTab("open")}><ArrowUp size={15} /> Abrir</button>
      </nav>

      {tab === "chat" && <>
        <div className={styles.chatToolbar}><span>Conversa rápida</span><button type="button" disabled={busy} onClick={() => { const next = newConversation(); conversationRef.current = next; setConversation(next); saveConversation(next); }}><Plus size={14} /> Nova</button></div>
        <div ref={scrollRef} className={styles.messages} aria-live="polite">
          {!conversation?.messages.length && <div className={styles.empty}><strong>O que vamos fazer?</strong><p>Peça uma ideia, diga “anote minha ideia: ...”, “abra o bloco de notas” ou “inicie um projeto para ...”.</p></div>}
          {conversation?.messages.map((message) => <div key={message.id} className={`${styles.message} ${message.role === "user" ? styles.userMessage : styles.assistantMessage}`}>
            <span className={styles.messageRole}>{message.role === "user" ? "Você" : "Kaoz.1"}</span>
            <p>{message.content || "Aguardando resposta..."}</p>
            {message.actionFlow && <button type="button" className={styles.inlineAction} onClick={() => void openMain(`/flow/${conversation.id}`)}>Continuar {message.actionFlow} no aplicativo</button>}
          </div>)}
        </div>
        <div className={styles.composer}>
          {pastedContext && <div className={styles.contextChip}><span>Contexto colado: {pastedContext.length} caracteres</span><button type="button" aria-label="Remover contexto" onClick={() => setPastedContext("")}><X size={14} /></button></div>}
          <textarea aria-label="Mensagem para Kaoz.1" placeholder="Converse ou peça uma ação..." value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submitChat(); } }} rows={2} />
          <div className={styles.composerActions}><button type="button" onClick={() => void pasteContext()}>Colar contexto</button><div>{busy ? <button type="button" onClick={() => abortRef.current?.abort()} disabled={!abortRef.current}>Interromper</button> : <button type="button" className={styles.sendButton} onClick={() => void submitChat()} disabled={!draft.trim() || !conversation}><ArrowUp size={16} /> Enviar</button>}</div></div>
          {status && <small className={styles.status}>{status}</small>}
        </div>
      </>}

      {tab === "notes" && <div className={styles.section}>
        <div className={styles.noteHeading}><h2>{selectedNoteId ? "Editar nota" : "Nova nota"}</h2>{selectedNoteId && <button type="button" onClick={() => { setSelectedNoteId(null); setNoteTitleDraft(""); setNoteContentDraft(""); }}>Nova nota</button>}</div>
        <input aria-label="Título da nota" placeholder="Título" value={noteTitleDraft} onChange={(event) => setNoteTitleDraft(event.target.value)} />
        <textarea aria-label="Conteúdo da nota" placeholder="Escreva sua ideia..." rows={4} value={noteContentDraft} onChange={(event) => setNoteContentDraft(event.target.value)} />
        <button type="button" className={styles.primaryButton} disabled={!noteTitleDraft.trim() || busy} onClick={() => void submitNote()}>{selectedNoteId ? "Atualizar nota" : "Salvar nota"}</button>
        <h2>Notas recentes</h2>
        <div className={styles.itemList}>{notes.length ? notes.slice(0, 8).map((note) => <button type="button" key={note.id} onClick={() => { setSelectedNoteId(note.id); setNoteTitleDraft(note.title); setNoteContentDraft(note.content); }}><strong>{note.title}</strong><small>{note.content || "Sem conteúdo"}</small></button>) : <p className={styles.muted}>Nenhuma nota ainda.</p>}</div>
      </div>}

      {tab === "open" && <div className={styles.section}>
        <h2>Abrir aplicativo</h2><p className={styles.muted}>Ações disponíveis neste computador.</p>
        <div className={styles.itemList}>{targets.length ? targets.map((target) => <button type="button" key={target.id} disabled={busy} onClick={() => { setTab("chat"); void runLocalAction(`Abra ${target.label}`, () => openTarget(target.id)); }}><strong>{target.label}</strong><small>{target.description}</small></button>) : <p className={styles.muted}>Nenhuma ação disponível no momento.</p>}</div>
        <h2>Começar projeto</h2>
        <input aria-label="Nome do projeto" placeholder="Nome do projeto" value={projectTitleDraft} onChange={(event) => setProjectTitleDraft(event.target.value)} />
        <textarea aria-label="Ideia do projeto" placeholder="O que você quer desenvolver?" rows={3} value={projectIdeaDraft} onChange={(event) => setProjectIdeaDraft(event.target.value)} />
        <label className={styles.checkbox}><input type="checkbox" checked={openProjectInCode} onChange={(event) => setOpenProjectInCode(event.target.checked)} /> Abrir no VS Code, se estiver instalado</label>
        <button type="button" className={styles.primaryButton} disabled={!projectTitleDraft.trim() || !projectIdeaDraft.trim() || busy} onClick={() => void submitProject()}>Criar projeto e brief</button>
      </div>}

      {notice && <div className={styles.notice} role="status">{notice}<button type="button" aria-label="Fechar aviso" onClick={() => setNotice("")}><X size={13} /></button></div>}
      <footer className={styles.footer}><button type="button" onClick={() => void openMain("/meeting-notes")}><FileText size={14} /> Anotações de reunião</button><span>Ctrl+Alt+K</span></footer>
    </main>
  );
}
