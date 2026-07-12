"use client";

import { useEffect, useState } from "react";
import { ChatMemoryRecord } from "@/lib/cognitive-memory/types/memory";

export function CortexChatMemories() {
  const [memories, setMemories] = useState<ChatMemoryRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMemories();
  }, []);

  const fetchMemories = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/cortex/chat-memories");
      const data = await res.json();
      if (data.success && data.memories) {
        setMemories(data.memories);
      }
    } catch (err) {
      console.error("Falha ao carregar memórias", err);
    } finally {
      setLoading(false);
    }
  };

  const rejectMemory = async (memoryId: string) => {
    try {
      setMemories(memories.filter((m) => m.id !== memoryId));
      await fetch("/api/cortex/chat-memories", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", memoryId }),
      });
    } catch (err) {
      console.error("Falha ao rejeitar memória", err);
      fetchMemories();
    }
  };

  if (loading) {
    return <div className="p-4 border border-dashed border-gray-600 rounded-md">Carregando aprendizados da personalidade...</div>;
  }

  if (memories.length === 0) {
    return <div className="p-4 border border-dashed border-gray-600 rounded-md">Nenhum aprendizado ou memória de chat registrado ainda.</div>;
  }

  return (
    <div className="mt-8 p-4 border border-gray-700 bg-gray-900 rounded-lg">
      <h2 className="text-xl font-semibold mb-4">Memórias do Chat / Personalidade Aprendida</h2>
      <ul className="space-y-3">
        {memories.map((mem) => (
          <li key={mem.id} className="flex justify-between items-start bg-gray-800 p-3 rounded shadow-sm border border-gray-700">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-sm text-blue-400">[{mem.kind}]</span>
                <span className={`text-xs px-2 py-0.5 rounded ${mem.status === 'active' ? 'bg-green-900 text-green-300' : 'bg-yellow-900 text-yellow-300'}`}>
                  {mem.status}
                </span>
                <span className="text-xs text-gray-500">Confiança: {Math.round((mem.confidenceScore || 0) * 100)}%</span>
              </div>
              <p className="text-sm text-gray-200">{mem.content}</p>
            </div>
            <button
              onClick={() => rejectMemory(mem.id)}
              className="ml-4 text-red-400 hover:text-red-300 text-sm font-semibold p-1 bg-red-900/30 rounded hover:bg-red-900/50"
              title="Rejeitar e esquecer"
            >
              Remover
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
