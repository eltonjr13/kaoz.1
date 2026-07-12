"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle, Loader2, Plus, Save, Settings, Sparkles, ToggleLeft, ToggleRight } from "lucide-react";
import type { KaozSkill } from "@/services/skills/skill.types";

type Message = { type: "success" | "error"; text: string };
type CreatorBrief = { name: string; purpose: string; triggers: string; workflow: string };
const emptyBrief: CreatorBrief = { name: "", purpose: "", triggers: "", workflow: "" };

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64);
}

function buildSkill(brief: CreatorBrief): Partial<KaozSkill> {
  const workflow = brief.workflow.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const steps = workflow.length ? workflow : ["Analise o pedido e confirme os dados necessários.", "Execute o trabalho usando as ferramentas disponíveis.", "Valide o resultado antes de entregar."];
  return {
    id: slugify(brief.name), name: brief.name.trim(),
    description: `${brief.purpose.trim()} Use quando: ${brief.triggers.trim()}`,
    instructions: `# ${brief.name.trim()}\n\n## Fluxo\n\n${steps.map((step, index) => `${index + 1}. ${step}`).join("\n")}\n\n## Regras\n\n- Trabalhe apenas dentro do escopo solicitado.\n- Não invente resultados, ferramentas ou dados.\n- Valide a entrega e informe limitações relevantes.`,
    version: "1.0.0", enabled: true, approvalMode: "plan", preferredTools: [], requiredCapabilities: [], tools: [],
  };
}

export function SkillsSettingsPanel() {
  const [skills, setSkills] = useState<KaozSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<KaozSkill> | null>(null);
  const [brief, setBrief] = useState<CreatorBrief>(emptyBrief);
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const loadSkills = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/skills?full=true");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao carregar skills.");
      setSkills(data.skills || []);
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao carregar skills." }); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadSkills(); }, []);
  const generatedId = useMemo(() => slugify(brief.name), [brief.name]);

  const selectSkill = (skill: KaozSkill) => {
    setSelectedSkillId(skill.id); setEditForm({ ...skill }); setCreatorOpen(false); setMessage(null);
  };
  const startCreator = () => { setBrief(emptyBrief); setEditForm(null); setSelectedSkillId(null); setCreatorOpen(true); setMessage(null); };
  const createDraft = () => {
    if (!brief.name.trim() || !brief.purpose.trim() || !brief.triggers.trim()) {
      setMessage({ type: "error", text: "Preencha nome, objetivo e quando a skill deve ser usada." }); return;
    }
    setEditForm(buildSkill(brief)); setSelectedSkillId(null); setCreatorOpen(false); setMessage(null);
  };
  const save = async () => {
    if (!editForm) return;
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editForm) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Falha ao salvar skill.");
      setEditForm(data.skill); setSelectedSkillId(data.skill.id); setMessage({ type: "success", text: "Skill criada e disponível para o agente." });
      await loadSkills();
    } catch (error) { setMessage({ type: "error", text: error instanceof Error ? error.message : "Falha ao salvar skill." }); }
    finally { setSaving(false); }
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

      {creatorOpen ? <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 overflow-y-auto py-3">
        <div className="flex gap-3"><div className="rounded-xl bg-[#9D7CFF]/15 p-3 text-[#b59dff]"><Sparkles size={22}/></div><div><h2 className="text-lg font-semibold">Criador de Skills</h2><p className="text-sm text-white/50">Descreva a capacidade. O rascunho segue o padrão atual e poderá ser revisado antes de salvar.</p></div></div>
        <Field label="Nome da skill" hint={`ID gerado: ${generatedId || "minha-skill"}`}><input value={brief.name} onChange={(e) => setBrief({...brief, name:e.target.value})} placeholder="Ex.: Analisar concorrentes" className="input-skill"/></Field>
        <Field label="O que ela deve fazer?"><textarea value={brief.purpose} onChange={(e) => setBrief({...brief, purpose:e.target.value})} placeholder="Explique o resultado que a skill deve produzir." className="input-skill min-h-20 resize-y"/></Field>
        <Field label="Quando deve ser usada?"><textarea value={brief.triggers} onChange={(e) => setBrief({...brief, triggers:e.target.value})} placeholder="Ex.: quando o usuário pedir análise de concorrentes, benchmark ou comparação de mercado." className="input-skill min-h-20 resize-y"/></Field>
        <Field label="Fluxo desejado" hint="Opcional — uma etapa por linha"><textarea value={brief.workflow} onChange={(e) => setBrief({...brief, workflow:e.target.value})} placeholder={'Coletar o contexto\nPesquisar fontes\nComparar resultados\nEntregar recomendações'} className="input-skill min-h-28 resize-y"/></Field>
        <div className="flex justify-end"><button onClick={createDraft} className="flex items-center gap-2 rounded-lg bg-[#9D7CFF] px-5 py-2.5 text-sm font-semibold text-black"><Sparkles size={16}/> Gerar rascunho</button></div>
      </div> : editForm ? <div className="flex h-full flex-col gap-4 overflow-y-auto pr-2">
        <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 text-lg font-semibold"><Settings className="text-[#9D7CFF]" size={20}/> {selectedSkillId ? "Editar skill" : "Revisar nova skill"}</h2><div className="flex items-center gap-3">
          <button onClick={() => setEditForm({...editForm, enabled:!editForm.enabled})} className={editForm.enabled ? "flex items-center gap-2 text-sm text-emerald-400" : "flex items-center gap-2 text-sm text-white/40"}>{editForm.enabled ? <ToggleRight size={24}/> : <ToggleLeft size={24}/>} {editForm.enabled ? "Ativada" : "Desativada"}</button>
          <button onClick={save} disabled={saving} className="flex items-center gap-2 rounded-lg bg-[#9D7CFF] px-4 py-2 text-sm font-semibold text-black disabled:opacity-50">{saving ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} Salvar</button></div></div>
        <div className="grid gap-4 md:grid-cols-2"><Field label="ID único"><input value={editForm.id || ""} disabled={Boolean(selectedSkillId)} onChange={(e)=>setEditForm({...editForm,id:e.target.value})} className="input-skill disabled:opacity-50"/></Field><Field label="Nome de exibição"><input value={editForm.name || ""} onChange={(e)=>setEditForm({...editForm,name:e.target.value})} className="input-skill"/></Field></div>
        <Field label="Descrição e gatilhos"><textarea value={editForm.description || ""} onChange={(e)=>setEditForm({...editForm,description:e.target.value})} className="input-skill min-h-20 resize-y"/></Field>
        <Field label="Instruções (Markdown)"><textarea value={editForm.instructions || ""} onChange={(e)=>setEditForm({...editForm,instructions:e.target.value})} className="input-skill min-h-64 flex-1 resize-y font-mono"/></Field>
      </div> : <div className="flex h-full flex-col items-center justify-center gap-4 text-center text-white/35"><Sparkles size={48} className="text-[#9D7CFF]/30"/><div><p className="font-medium text-white/60">Crie uma capacidade nova para o agente</p><p className="mt-1 max-w-sm text-sm">Use o criador guiado ou selecione uma skill existente para editar.</p></div><button onClick={startCreator} className="rounded-lg bg-[#9D7CFF] px-4 py-2 text-sm font-semibold text-black">Criar minha primeira skill</button></div>}
    </main>
    <style jsx global>{`.input-skill{width:100%;border-radius:.5rem;border:1px solid rgb(255 255 255/.1);background:rgb(0 0 0/.4);padding:.625rem .75rem;font-size:.875rem;color:white;outline:none}.input-skill:focus{border-color:#9D7CFF}`}</style>
  </div>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1.5"><span className="flex justify-between text-xs text-white/60"><span>{label}</span>{hint && <span className="text-white/30">{hint}</span>}</span>{children}</label>;
}
