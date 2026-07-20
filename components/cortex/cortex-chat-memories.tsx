"use client";

import { useEffect, useState } from "react";
import type { ChatMemoryRecord } from "@/lib/cognitive-memory/types/memory";

const SCOPE_LABELS: Record<ChatMemoryRecord["scope"], string> = {
  user: "Usuário",
  global: "Global (legada)",
  avatar: "Avatar",
  project: "Projeto",
  session: "Conversa"
};

const STATUS_STYLES: Record<ChatMemoryRecord["status"], string> = {
  active: "bg-green-900 text-green-300",
  pending_review: "bg-yellow-900 text-yellow-300",
  superseded: "bg-slate-700 text-slate-300",
  rejected: "bg-red-950 text-red-300"
};

export function CortexChatMemories() {
  const [memories, setMemories] = useState<ChatMemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [error, setError] = useState("");

  const fetchMemories = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/cortex/chat-memories");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao carregar memórias.");
      setMemories(data.memories || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMemories();
  }, []);

  const forgetMemory = async (memoryId: string) => {
    setError("");
    const previous = memories;
    setMemories((current) => current.filter((memory) => memory.id !== memoryId));
    try {
      const res = await fetch("/api/cortex/chat-memories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "forget", memoryId })
      });
      if (!res.ok) throw new Error((await res.json()).error || "Falha ao esquecer memória.");
    } catch (err) {
      setMemories(previous);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const saveEdit = async () => {
    if (!editingId || !editingContent.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/cortex/chat-memories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "edit", memoryId: editingId, content: editingContent.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao editar memória.");
      setEditingId(null);
      setEditingContent("");
      await fetchMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (loading) return <div className="p-4 border border-dashed border-gray-600 rounded-md">Carregando memórias...</div>;

  return (
    <div className="mt-8 p-4 border border-gray-700 bg-gray-900 rounded-lg">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <h2 className="text-xl font-semibold">Memórias persistentes</h2>
          <p className="text-sm text-gray-400 mt-1">Preferências pessoais atravessam conversas e avatares. Memórias contextuais permanecem isoladas.</p>
        </div>
        <button onClick={() => void fetchMemories()} className="text-sm px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700">Atualizar</button>
      </div>

      {error && <div className="mb-3 rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-300">{error}</div>}
      {memories.length === 0 ? (
        <div className="p-4 border border-dashed border-gray-600 rounded-md">Nenhuma memória registrada ainda.</div>
      ) : (
        <ul className="space-y-3">
          {memories.map((memory) => (
            <li key={memory.id} className={`bg-gray-800 p-3 rounded border ${memory.status === "superseded" ? "border-gray-700 opacity-70" : "border-gray-700"}`}>
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-medium text-xs text-blue-400">{memory.kind}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-indigo-950 text-indigo-300">{SCOPE_LABELS[memory.scope]}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[memory.status]}`}>{memory.status}</span>
                    {memory.explicit && <span className="text-xs text-gray-400">explícita</span>}
                  </div>

                  {editingId === memory.id ? (
                    <div className="space-y-2">
                      <textarea value={editingContent} onChange={(event) => setEditingContent(event.target.value)} className="w-full min-h-20 rounded bg-gray-950 border border-gray-600 p-2 text-sm" />
                      <div className="flex gap-2">
                        <button onClick={() => void saveEdit()} className="text-sm px-3 py-1 rounded bg-blue-700 hover:bg-blue-600">Salvar correção</button>
                        <button onClick={() => setEditingId(null)} className="text-sm px-3 py-1 rounded bg-gray-700 hover:bg-gray-600">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-200 break-words">{memory.content}</p>
                  )}

                  <div className="mt-2 text-xs text-gray-500 flex flex-wrap gap-x-3 gap-y-1">
                    <span>Origem: {memory.source}</span>
                    <span>Confiança: {Math.round(memory.confidenceScore * 100)}%</span>
                    <span>Atualizada: {new Date(memory.updatedAt).toLocaleString("pt-BR")}</span>
                    {memory.sessionId && <span>Conversa: {memory.sessionId.slice(0, 8)}</span>}
                  </div>
                </div>

                {memory.status !== "superseded" && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => { setEditingId(memory.id); setEditingContent(memory.content); }} className="text-sm text-blue-300 hover:text-blue-200">Editar</button>
                    <button onClick={() => void forgetMemory(memory.id)} className="text-sm text-red-400 hover:text-red-300">Esquecer</button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
