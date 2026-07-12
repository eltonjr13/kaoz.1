"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Bot, CheckCircle, Loader2, Plus, Save, Send, Settings, Sparkles, ToggleLeft, ToggleRight, User } from "lucide-react";
import type { KaozSkill } from "@/services/skills/skill.types";

type Message = { type: "success" | "error"; text: string };
type ChatMessage = { role: "user" | "assistant"; content: string };

const welcome: ChatMessage = {
  role: "assistant",
  content: "Conte o que você quer que a nova skill faça. Pode escrever do seu jeito — eu faço as perguntas necessárias e preparo o rascunho.",
};

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
  const [message, setMessage] = useState<Message | null>(null);

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
        setEditForm({ ...data.skill, version: "1.0.0", enabled: true, approvalMode: "plan", preferredTools: [], requiredCapabilities: [], tools: [] });
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

  if (loading && skills.length === 0) return <div className="flex h-64 items-center justify-center text-white/50"><Loader2 className="mr-2 animate-spin" size={20}/>Carregando skills...</div>;

  return <div className="flex min-h-[560px] w-full gap-4 lg:h-[calc(100vh-160px)]">
    <aside className="flex w-72 shrink-0 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-3 flex items-center justify-between px-2"><div><h3 className="text-sm font-medium text-white/80">Skills</h3><p className="text-[10px] text-white/35">{skills.length} instaladas</p></div>
        <button onClick={startCreator} className="flex items-center gap-1 rounded-lg bg-[#9D7CFF]/15 px-2.5 py-1.5 text-xs text-[#b59dff] hover:bg-[#9D7CFF]/25"><Plus size={14}/> Criar skill</button></div>
      <div className="space-y-1 overflow-y-auto">{skills.map((skill) => <button key={skill.id} onClick={() => selectSkill(skill)} className={`w-full rounded-xl border px-3 py-2 text-left ${selectedSkillId === skill.id ? "border-white/20 bg-white/10" : "border-transparent hover:bg-white/5"}`}>
        <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{skill.name}</span><span className={`h-2 w-2 rounded-full ${skill.enabled ? "bg-emerald-500" : "bg-white/20"}`}/></div><p className="truncate text-[10px] text-white/40">{skill.id}</p></button>)}</div>
    </aside>

    <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/[0.02] p-5">
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
        <div className="flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Settings className="text-[#9D7CFF]" size={20}/> {selectedSkillId ? "Editar skill" : "Revisar skill gerada"}</h2>{!selectedSkillId && <p className="mt-1 text-xs text-white/40">Revise o trabalho do modelo. Nada será instalado até você salvar.</p>}</div><div className="flex items-center gap-3">
          <button onClick={() => setEditForm({...editForm, enabled:!editForm.enabled})} className={editForm.enabled ? "flex items-center gap-2 text-sm text-emerald-400" : "flex items-center gap-2 text-sm text-white/40"}>{editForm.enabled ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>} {editForm.enabled ? "Ativada" : "Desativada"}</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#9D7CFF] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Salvar</button></div></div>
        <div className="grid gap-4 md:grid-cols-2"><Field label="ID único"><input value={editForm.id || ""} disabled={Boolean(selectedSkillId)} onChange={(event)=>setEditForm({...editForm,id:event.target.value})} className="input-skill disabled:opacity-50"/></Field><Field label="Nome de exibição"><input value={editForm.name || ""} onChange={(event)=>setEditForm({...editForm,name:event.target.value})} className="input-skill"/></Field></div>
        <Field label="Descrição e gatilhos"><textarea value={editForm.description || ""} onChange={(event)=>setEditForm({...editForm,description:event.target.value})} className="input-skill min-h-20 resize-y"/></Field>
        <Field label="Instruções (Markdown)"><textarea value={editForm.instructions || ""} onChange={(event)=>setEditForm({...editForm,instructions:event.target.value})} className="input-skill min-h-64 flex-1 resize-y font-mono"/></Field>
        {!selectedSkillId && <button onClick={() => setCreatorOpen(true)} className="self-start text-xs text-[#b59dff] hover:underline">Voltar ao chat e pedir ajustes</button>}
      </div> : <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-white/35"><Sparkles size={48} className="text-[#9D7CFF]/30"/><div><p className="font-medium text-white/60">Crie uma capacidade conversando com a IA</p><p className="mt-1 max-w-sm text-sm">O modelo escolhido entende sua ideia, faz perguntas e escreve a skill para você revisar.</p></div><button onClick={startCreator} className="rounded-lg bg-[#9D7CFF] px-4 py-2 text-sm font-semibold text-black">Conversar com o criador</button></div>}
    </main>
    <style jsx global>{`.input-skill{width:100%;border-radius:.5rem;border:1px solid rgb(255 255 255/.1);background:rgb(0 0 0/.4);padding:.625rem .75rem;font-size:.875rem;color:white;outline:none}.input-skill:focus{border-color:#9D7CFF}`}</style>
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="text-xs text-white/60">{label}</span>{children}</label>;
}
