"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle, Loader2, Plus, Save, Send, Settings, Sparkles, ToggleLeft, ToggleRight, User, Search, Trash2 } from "lucide-react";
import type { KaozSkill, SkillResourceFile } from "@/services/skills/skill.types";

type Message = { type: "success" | "error"; text: string };
type ChatMessage = { role: "user" | "assistant"; content: string };

const welcome: ChatMessage = {
  role: "assistant",
  content: "Conte o que você quer que a nova skill faça. Pode escrever do seu jeito — eu faço as perguntas necessárias e preparo o rascunho.",
};

const builtInSkillIds = ["general.execute-goal", "research.web-research", "content.create-short-video", "build-skills"];

export function SkillsSettingsPanel() {
  const [skills, setSkills] = useState<KaozSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<KaozSkill> | null>(null);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([welcome]);
  const [chatInput, setChatInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState("");
  const [message, setMessage] = useState<Message | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const loadSkills = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/skills?full=true");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar skills.");
      setSkills(data.skills || []);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao carregar skills." });
    } finally { setLoading(false); }
  };

  useEffect(() => { void loadSkills(); }, []);

  const selectSkill = (skill: KaozSkill) => {
    setSelectedSkillId(skill.id); setEditForm({ ...skill }); setCreatorOpen(false); setMessage(null);
  };

  const startCreator = () => {
    setChat([welcome]); setChatInput(""); setEditForm(null); setSelectedSkillId(null); setCreatorOpen(true); setMessage(null);
  };

  const sendChat = async () => {
    const content = chatInput.trim();
    if (!content || thinking) return;
    const nextChat = [...chat, { role: "user", content } satisfies ChatMessage];
    setChat(nextChat); setChatInput(""); setThinking(true); setMessage(null);
    try {
      const response = await fetch("/api/skills/generate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: nextChat }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "O modelo não conseguiu responder.");
      setChat((current) => [...current, { role: "assistant", content: data.message }]);
      if (data.ready && data.skill) {
        setEditForm({
          ...data.skill,
          version: data.skill.version || "1.0.0",
          enabled: true,
          approvalMode: data.skill.approvalMode || "plan",
          preferredTools: data.skill.preferredTools || [],
          requiredCapabilities: data.skill.requiredCapabilities || [],
          tools: data.skill.tools || [],
          references: data.skill.references || [],
          scripts: data.skill.scripts || [],
        });
        setCreatorOpen(false);
      }
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao consultar o modelo." });
    } finally { setThinking(false); }
  };

  const save = async () => {
    if (!editForm) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao salvar skill.");
      setEditForm(data.skill); setSelectedSkillId(data.skill.id);
      setMessage({ type: "success", text: "Skill criada e disponível para o agente." });
      await loadSkills();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao salvar skill." });
    } finally { setSaving(false); }
  };

  const handleDeleteTrigger = () => {
    if (!selectedSkillId) return;
    setDeleteConfirmId("");
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (!selectedSkillId || deleteConfirmId !== selectedSkillId) return;
    setDeleting(true); setMessage(null);
    try {
      const response = await fetch(`/api/skills?id=${selectedSkillId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao excluir skill.");
      setMessage({ type: "success", text: "Skill excluída com sucesso." });
      setEditForm(null); setSelectedSkillId(null);
      setShowDeleteModal(false); setDeleteConfirmId("");
      await loadSkills();
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao excluir skill." });
    } finally { setDeleting(false); }
  };

  const isBuiltIn = (id: string) => builtInSkillIds.includes(id);

  const filteredSkills = skills.filter((skill) =>
    skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    skill.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading && skills.length === 0) return <div className="flex h-64 items-center justify-center text-white/50"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando skills...</div>;

  return <div className="flex min-h-[560px] w-full gap-4 lg:h-[calc(100vh-160px)]">
    <aside className="flex w-72 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-3 backdrop-blur-md">
      <div className="mb-3 flex items-center justify-between px-2">
        <div>
          <h3 className="text-sm font-medium text-white/80">Skills</h3>
          <p className="text-[10px] text-white/35">{skills.length} instaladas</p>
        </div>
        <button onClick={startCreator} className="flex items-center gap-1 rounded-lg bg-[#9D7CFF]/15 px-2.5 py-1.5 text-xs text-[#b59dff] hover:bg-[#9D7CFF]/25 cursor-pointer transition"><Plus size={14}/> Criar skill</button>
      </div>

      <div className="mb-3 px-1 relative">
        <Search size={14} className="absolute left-3 top-2.5 text-white/30" />
        <input 
          type="text" 
          placeholder="Buscar skills..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-white/10 bg-black/40 pl-8 pr-3 py-1.5 text-xs text-white outline-none focus:border-[#9D7CFF]"
        />
      </div>

      <div className="space-y-1 overflow-y-auto flex-1">
        {filteredSkills.map((skill) => (
          <button key={skill.id} onClick={() => selectSkill(skill)} className={`w-full rounded-xl border px-3 py-2 text-left transition ${selectedSkillId === skill.id ? "border-white/20 bg-white/10" : "border-transparent hover:bg-white/5"}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{skill.name}</span>
              <span className={`h-2 w-2 rounded-full ${skill.enabled ? "bg-emerald-500" : "bg-white/20"}`}/>
            </div>
            <div className="mt-1 flex items-center justify-between">
              <span className="truncate text-[10px] text-white/40">{skill.id}</span>
              {isBuiltIn(skill.id) ? (
                <span className="rounded bg-blue-500/10 px-1 py-0.2 text-[8px] font-semibold text-blue-400">Built-in</span>
              ) : (
                <span className="rounded bg-[#9D7CFF]/10 px-1 py-0.2 text-[8px] font-semibold text-[#b59dff]">Custom</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </aside>

    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-md">
      {message && <div className={`mb-4 flex items-center gap-2 rounded-lg border p-3 text-sm ${message.type === "success" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400" : "border-red-500/20 bg-red-500/10 text-red-400"}`}>{message.type === "success" ? <CheckCircle size={16}/> : <AlertCircle size={16}/>} {message.text}</div>}

      {creatorOpen ? <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden">
        <div className="mb-4 flex gap-3 border-b border-white/10 pb-4"><div className="rounded-xl bg-[#9D7CFF]/15 p-3 text-[#b59dff]"><Bot size={22}/></div><div><h2 className="text-lg font-semibold">Criador de Skills com IA</h2><p className="text-sm text-white/50">Usando o provedor e o modelo selecionados em Agente LLM.</p></div></div>
        <div className="flex-1 space-y-4 overflow-y-auto pr-2">{chat.map((item, index) => <div key={index} className={`flex gap-3 ${item.role === "user" ? "justify-end" : "justify-start"}`}>
          {item.role === "assistant" && <span className="mt-1 rounded-lg bg-[#9D7CFF]/15 p-2 text-[#b59dff]"><Bot size={15}/></span>}
          <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${item.role === "user" ? "bg-[#9D7CFF] text-black" : "border border-white/10 bg-white/[0.04] text-white/80"}`}>{item.content}</div>
          {item.role === "user" && <span className="mt-1 rounded-lg bg-white/10 p-2 text-white/60"><User size={15}/></span>}
        </div>)}{thinking && <div className="flex items-center gap-3 text-sm text-white/40"><span className="rounded-lg bg-[#9D7CFF]/15 p-2 text-[#b59dff]"><Loader2 className="animate-spin" size={15}/></span>Projetando a skill...</div>}</div>
        <div className="mt-4 flex gap-2 border-t border-white/10 pt-4"><textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChat(); } }} placeholder="Ex.: quero uma skill que analise canais do YouTube e encontre oportunidades..." className="input-skill min-h-12 flex-1 resize-none"/><button onClick={() => void sendChat()} disabled={!chatInput.trim() || thinking} className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#9D7CFF] text-black disabled:opacity-40"><Send size={18}/></button></div>
      </div> : editForm ? <div className="flex h-full flex-col gap-4 overflow-y-auto pr-2">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Settings className="text-[#9D7CFF]" size={20}/> 
              {selectedSkillId ? `Editar skill: ${editForm.name}` : "Revisar skill gerada"}
            </h2>
            <div className="flex flex-wrap items-center gap-2 text-xs text-white/40 mt-1">
              <span>ID: <span className="font-mono text-white/60">{editForm.id}</span></span>
              <span className="text-white/20">|</span>
              <span>Versão: <span className="font-mono text-white/60">{editForm.version || "1.0.0"}</span></span>
              <span className="text-white/20">|</span>
              {isBuiltIn(editForm.id || "") ? (
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-blue-400">Built-in</span>
              ) : (
                <span className="rounded bg-[#9D7CFF]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#b59dff]">Custom</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setEditForm({...editForm, enabled:!editForm.enabled})} className={editForm.enabled ? "flex items-center gap-2 text-sm text-emerald-400 cursor-pointer" : "flex items-center gap-2 text-sm text-white/40 cursor-pointer"}>{editForm.enabled ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>} {editForm.enabled ? "Ativada" : "Desativada"}</button>
            {selectedSkillId && !isBuiltIn(selectedSkillId) && (
              <button onClick={handleDeleteTrigger} disabled={deleting} className="flex items-center gap-2 rounded-lg bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm font-semibold text-red-200 disabled:opacity-50 cursor-pointer transition hover:bg-red-500/30 hover:border-red-500/50">{deleting ? <Loader2 className="animate-spin" size={16}/> : <Trash2 size={16}/>} Excluir</button>
            )}
            <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#9D7CFF] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50 cursor-pointer transition hover:brightness-110">{saving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Salvar</button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="ID único e Versão">
            <div className="flex gap-2">
              <input value={editForm.id || ""} disabled={Boolean(selectedSkillId)} onChange={(event)=>setEditForm({...editForm,id:event.target.value})} className="input-skill disabled:opacity-50 flex-1"/>
              <input value={editForm.version || "1.0.0"} onChange={(event)=>setEditForm({...editForm,version:event.target.value})} className="input-skill w-24" placeholder="Versão"/>
            </div>
          </Field>
          <Field label="Nome de exibição">
            <input value={editForm.name || ""} onChange={(event)=>setEditForm({...editForm,name:event.target.value})} className="input-skill"/>
          </Field>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Modo de aprovação (approvalMode)">
            <select 
              value={editForm.approvalMode || "plan"} 
              onChange={(event)=>setEditForm({...editForm, approvalMode: event.target.value as any})} 
              className="input-skill bg-black/40 text-white h-[42px] border border-white/10 rounded-lg outline-none cursor-pointer focus:border-[#9D7CFF]"
            >
              <option value="plan" className="bg-[#1c1c1c] text-white">Revisar plano de execução (plan)</option>
              <option value="step" className="bg-[#1c1c1c] text-white">Pedir aprovação por etapa (step)</option>
              <option value="never" className="bg-[#1c1c1c] text-white">Executar sem pedir aprovação (never)</option>
            </select>
          </Field>
          <Field label="Capacidades requeridas (requiredCapabilities)">
            <div className="flex gap-4 items-center h-[42px] px-2">
              {["web", "content", "system"].map((cap) => {
                const caps = editForm.requiredCapabilities || [];
                const checked = caps.includes(cap);
                return (
                  <label key={cap} className="flex items-center gap-2 cursor-pointer text-xs text-white/80 select-none">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const nextCaps = e.target.checked
                          ? [...caps, cap]
                          : caps.filter((c) => c !== cap);
                        setEditForm({ ...editForm, requiredCapabilities: nextCaps });
                      }}
                      className="rounded border-white/15 bg-black/40 text-[#9D7CFF] focus:ring-0 focus:ring-offset-0 h-4 w-4"
                    />
                    <span className="capitalize">{cap}</span>
                  </label>
                );
              })}
            </div>
          </Field>
        </div>

        <Field label="Descrição e gatilhos">
          <textarea value={editForm.description || ""} onChange={(event)=>setEditForm({...editForm,description:event.target.value})} className="input-skill min-h-20 resize-y"/>
        </Field>

        <Field label="Instruções (Markdown)">
          <textarea value={editForm.instructions || ""} onChange={(event)=>setEditForm({...editForm,instructions:event.target.value})} className="input-skill min-h-64 flex-1 resize-y font-mono"/>
        </Field>

        <ResourceFilesEditor
          label="Arquivos de referência"
          emptyText="Nenhuma referência adicional."
          files={editForm.references || []}
          onChange={(references) => setEditForm({ ...editForm, references })}
          newFileName="reference.md"
        />

        <ResourceFilesEditor
          label="Scripts auxiliares"
          emptyText="Nenhum script auxiliar."
          files={editForm.scripts || []}
          onChange={(scripts) => setEditForm({ ...editForm, scripts })}
          newFileName="script.ts"
        />

        <div className="border-t border-white/10 pt-4">
          <h3 className="text-xs font-semibold text-white/60 mb-2 uppercase tracking-wider">Ferramentas Associadas (custom tools)</h3>
          {editForm.tools && editForm.tools.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {editForm.tools.map((tool) => (
                <div key={tool.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 backdrop-blur-md">
                  <div className="flex justify-between items-start gap-2 mb-2">
                    <span className="font-mono text-xs font-bold text-[#b59dff] truncate max-w-[200px]" title={tool.id}>{tool.id}</span>
                    <span className="bg-white/5 border border-white/10 rounded px-1.5 py-0.5 text-[9px] font-mono text-white/40 truncate max-w-[200px]" title={tool.script}>{tool.script}</span>
                  </div>
                  <p className="text-xs text-white/60 line-clamp-2">{tool.description}</p>
                  {tool.inputSchema && (
                    <details className="mt-2 group">
                      <summary className="text-[10px] text-white/30 cursor-pointer select-none group-open:text-[#b59dff] hover:text-white/60">Ver inputSchema</summary>
                      <pre className="mt-1 p-2 rounded bg-black/40 border border-white/5 font-mono text-[9px] text-white/50 overflow-x-auto max-h-32">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-white/30 italic">Nenhum script associado a esta skill.</p>
          )}
        </div>

        {!selectedSkillId && <button onClick={() => setCreatorOpen(true)} className="self-start text-xs text-[#b59dff] hover:underline cursor-pointer">Voltar ao chat e pedir ajustes</button>}
      </div> : <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-white/35"><Sparkles size={48} className="text-[#9D7CFF]/30"/><div><p className="font-medium text-white/60">Crie uma capacidade conversando com a IA</p><p className="mt-1 max-w-sm text-sm">O modelo escolhido entende sua ideia, faz perguntas e escreve a skill para você revisar.</p></div><button onClick={startCreator} className="rounded-lg bg-[#9D7CFF] px-4 py-2 text-sm font-semibold text-black cursor-pointer">Conversar com o criador</button></div>}
    </main>
    {showDeleteModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
        <div className="w-full max-w-md rounded-2xl border border-red-500/20 bg-zinc-950 p-6 shadow-2xl animate-in scale-in duration-200">
          <div className="mb-4 flex items-center gap-3 text-red-400">
            <AlertCircle size={24} />
            <h3 className="text-base font-bold text-white">Excluir Skill Permanentemente</h3>
          </div>
          <p className="text-xs leading-relaxed text-zinc-400 mb-4">
            Esta ação é irreversível. A skill <span className="font-mono text-red-300">/{selectedSkillId}</span> e todos os seus arquivos, referências e scripts serão excluídos permanentemente.
          </p>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 font-bold">
            Digite o ID da skill para confirmar: <span className="font-mono text-zinc-300">{selectedSkillId}</span>
          </p>
          <input
            type="text"
            value={deleteConfirmId}
            onChange={(e) => setDeleteConfirmId(e.target.value)}
            placeholder={selectedSkillId || ""}
            className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs font-mono text-white outline-none focus:border-red-500 mb-6"
          />
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => { setShowDeleteModal(false); setDeleteConfirmId(""); }}
              className="rounded-lg border border-white/10 px-4 py-2 text-xs text-zinc-300 hover:bg-white/5 transition cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDelete}
              disabled={deleteConfirmId !== selectedSkillId || deleting}
              className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-30 disabled:hover:bg-red-600 transition cursor-pointer"
            >
              {deleting ? <Loader2 className="animate-spin" size={14}/> : <Trash2 size={14}/>} Confirmar Exclusão
            </button>
          </div>
        </div>
      </div>
    )}
    <style jsx global>{`.input-skill{width:100%;border-radius:.5rem;border:1px solid rgb(255 255 255/.1);background:rgb(0 0 0/.4);padding:.625rem .75rem;font-size:.875rem;color:white;outline:none}.input-skill:focus{border-color:#9D7CFF}`}</style>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs text-white/60">{label}</span>{children}</label>;
}
