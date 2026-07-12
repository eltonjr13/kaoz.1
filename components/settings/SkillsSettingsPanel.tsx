"use client";

import { useEffect, useState } from "react";
import { Loader2, Plus, Save, Settings, ToggleLeft, ToggleRight, AlertCircle, CheckCircle } from "lucide-react";
import type { KaozSkill } from "@/services/skills/skill.types";

export function SkillsSettingsPanel() {
  const [skills, setSkills] = useState<KaozSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  
  const [editForm, setEditForm] = useState<Partial<KaozSkill> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{type: "success"|"error", text: string} | null>(null);

  const loadSkills = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/skills?full=true");
      if (!res.ok) throw new Error("Falha ao carregar skills");
      const data = await res.json();
      setSkills(data.skills || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSkills();
  }, []);

  const handleSelectSkill = (skill: KaozSkill) => {
    setSelectedSkillId(skill.id);
    setEditForm({ ...skill });
    setSaveMessage(null);
  };

  const handleCreateNew = () => {
    const newId = `custom.skill-${Date.now()}`;
    const newSkill: Partial<KaozSkill> = {
      id: newId,
      name: "Nova Skill",
      description: "Descrição da nova skill",
      instructions: "Escreva as instruções para a IA aqui...",
      version: "1.0.0",
      enabled: true,
      approvalMode: "plan",
    };
    setSelectedSkillId(newId);
    setEditForm(newSkill);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    if (!editForm || !editForm.id || !editForm.name) {
      setSaveMessage({ type: "error", text: "ID e Nome são obrigatórios." });
      return;
    }
    
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm),
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Falha ao salvar");
      
      setSaveMessage({ type: "success", text: "Skill salva com sucesso!" });
      await loadSkills();
      
      if (data.skill) {
          setEditForm(data.skill);
      }
    } catch (e: any) {
      setSaveMessage({ type: "error", text: e.message });
    } finally {
      setSaving(false);
    }
  };

  if (loading && skills.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-white/50">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Carregando skills...
      </div>
    );
  }

  if (error && skills.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-red-400">
        <AlertCircle className="mr-2 h-5 w-5" /> {error}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-160px)] min-h-[500px] w-full gap-4">
      {/* Lista lateral */}
      <div className="flex w-1/3 flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.02] p-3 overflow-y-auto">
        <div className="flex items-center justify-between px-2 mb-2">
          <h3 className="text-sm font-medium text-white/80">Skills Instanciadas</h3>
          <button 
            onClick={handleCreateNew}
            className="flex items-center gap-1 text-xs text-[#9D7CFF] hover:text-[#b59dff] transition-colors bg-[#9D7CFF]/10 hover:bg-[#9D7CFF]/20 px-2 py-1 rounded-md"
          >
            <Plus size={14} /> Nova
          </button>
        </div>
        
        {skills.length === 0 && (
          <p className="text-xs text-white/40 text-center py-4">Nenhuma skill encontrada.</p>
        )}
        
        {skills.map(s => (
          <button
            key={s.id}
            onClick={() => handleSelectSkill(s)}
            className={`flex flex-col items-start gap-1 rounded-xl px-3 py-2 text-left transition-colors ${selectedSkillId === s.id ? 'bg-white/10 border border-white/20' : 'hover:bg-white/5 border border-transparent'}`}
          >
            <div className="flex w-full items-center justify-between">
              <span className="text-sm font-medium text-white truncate pr-2">{s.name}</span>
              <span className={`flex-shrink-0 w-2 h-2 rounded-full ${s.enabled ? 'bg-green-500' : 'bg-white/20'}`} title={s.enabled ? 'Ativada' : 'Desativada'} />
            </div>
            <span className="text-[10px] text-white/40 truncate w-full">{s.id}</span>
          </button>
        ))}
      </div>

      {/* Área de Edição */}
      <div className="flex flex-1 flex-col rounded-2xl border border-white/10 bg-white/[0.02] p-5 overflow-hidden">
        {editForm ? (
          <div className="flex flex-col h-full gap-4 overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Settings className="text-[#9D7CFF]" size={20} />
                Editar Skill
              </h2>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setEditForm({ ...editForm, enabled: !editForm.enabled })}
                  className={`flex items-center gap-2 text-sm transition-colors ${editForm.enabled ? 'text-green-400' : 'text-white/40'}`}
                >
                  {editForm.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                  {editForm.enabled ? 'Ativada' : 'Desativada'}
                </button>
                
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[#9D7CFF] px-4 py-2 text-sm font-semibold text-black hover:bg-[#b59dff] disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Salvar
                </button>
              </div>
            </div>

            {saveMessage && (
              <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${saveMessage.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                {saveMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                {saveMessage.text}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-white/60">ID Único (ex: domain.action)</label>
                <input
                  type="text"
                  value={editForm.id || ""}
                  onChange={e => setEditForm({ ...editForm, id: e.target.value })}
                  disabled={skills.some(s => s.id === editForm.id) && selectedSkillId !== editForm.id} // Não pode sobrescrever outro
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-[#9D7CFF] focus:outline-none disabled:opacity-50"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-white/60">Nome de Exibição</label>
                <input
                  type="text"
                  value={editForm.name || ""}
                  onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                  className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-[#9D7CFF] focus:outline-none"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-white/60">Descrição Curta (Aparece no menu)</label>
              <input
                type="text"
                value={editForm.description || ""}
                onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                className="rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:border-[#9D7CFF] focus:outline-none"
              />
            </div>
            
            <div className="flex flex-col gap-1.5 flex-1 min-h-[250px]">
              <label className="text-xs text-white/60">Instruções de Prompt (Markdown)</label>
              <textarea
                value={editForm.instructions || ""}
                onChange={e => setEditForm({ ...editForm, instructions: e.target.value })}
                className="w-full flex-1 resize-none rounded-lg border border-white/10 bg-black/40 p-3 text-sm text-white font-mono focus:border-[#9D7CFF] focus:outline-none scrollbar-thin scrollbar-thumb-white/10"
                placeholder="Escreva aqui as instruções detalhadas de como o agente deve agir para cumprir esta skill..."
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-white/30 text-center gap-3">
            <Settings size={48} className="opacity-20" />
            <p className="max-w-[200px] text-sm">Selecione uma skill na lista lateral para editá-la ou crie uma nova.</p>
          </div>
        )}
      </div>
    </div>
  );
}
