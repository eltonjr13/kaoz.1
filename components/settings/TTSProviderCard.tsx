import { Play, Save, CheckCircle, Volume2, Settings2, MoreVertical, ChevronUp, Loader2 } from "lucide-react";
import type { TTSProviderName, TTSConfig } from "@/services/tts/tts.types";

export type TTSOption = {
  id: TTSProviderName;
  name: string;
  description: string;
  icon: React.ElementType;
};

type TTSProviderCardProps = {
  provider: TTSProviderName;
  option: TTSOption;
  config: TTSConfig | null;
  isSelected: boolean;
  isExpanded: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  
  // Fields props
  apiKey: string;
  voiceId: string;
  model: string;
  speed: string;
  emotion: string;
  availableVoices: any[];
  isLoadingVoices: boolean;
  
  onApiKeyChange: (value: string) => void;
  onVoiceIdChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onSpeedChange: (value: string) => void;
  onEmotionChange: (value: string) => void;

  // Actions props
  busyAction: string | null;
  onAction: (action: string, successText: string) => void;
};

export function TTSProviderCard({
  provider,
  option,
  config,
  isSelected,
  isExpanded,
  disabled,
  onSelect,
  onToggleExpand,
  apiKey,
  voiceId,
  model,
  speed,
  emotion,
  availableVoices,
  isLoadingVoices,
  onApiKeyChange,
  onVoiceIdChange,
  onModelChange,
  onSpeedChange,
  onEmotionChange,
  busyAction,
  onAction
}: TTSProviderCardProps) {
  const Icon = option.icon;
  const hasBusyAction = Boolean(busyAction);
  
  return (
    <div className={`relative flex flex-col rounded-2xl border transition-all overflow-hidden ${
      isSelected
        ? "border-emerald-500/40 bg-emerald-500/10 shadow-[0_0_15px_rgba(16,185,129,0.1)]"
        : "border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]"
    }`}>
      {isSelected && (
        <div className="absolute top-0 right-0 rounded-bl-xl bg-emerald-500/20 px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 border-b border-l border-emerald-500/30">
          Ativo
        </div>
      )}

      {/* Header / Main Card Area */}
      <div 
        className="flex items-start p-4 cursor-pointer"
        onClick={() => {
          if (!disabled) onSelect();
        }}
      >
        <div className={`mt-0.5 mr-4 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
          isSelected ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-300" : "border-white/10 bg-white/5 text-zinc-400"
        }`}>
          <Icon size={20} strokeWidth={1.5} />
        </div>
        
        <div className="flex-1 min-w-0 pr-8">
          <div className="flex items-center gap-2 mb-1">
            <h3 className={`text-sm font-bold ${isSelected ? "text-emerald-100" : "text-zinc-200"}`}>
              {option.name}
            </h3>
          </div>
          <p className="text-[11px] text-zinc-500 mb-3">{option.description}</p>
          
          <div className="flex flex-wrap gap-2">
            {(provider === "cartesia" && voiceId) && (
              <span className="inline-flex rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400">
                {availableVoices.find(v => v.id === voiceId)?.name || voiceId}
              </span>
            )}
            <span className={`inline-flex rounded border px-1.5 py-0.5 text-[9px] font-mono ${
              isSelected ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-white/5 border-white/10 text-zinc-400"
            }`}>
              {isSelected ? "Pronto" : "Parado"}
            </span>
          </div>
        </div>
      </div>

      {/* Menu / Expand Toggle */}
      {provider !== "browser" && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="absolute bottom-4 right-4 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          {isExpanded ? <ChevronUp size={14} /> : <MoreVertical size={14} />}
        </button>
      )}
      
      {/* Expanded Actions & Config */}
      {isExpanded && provider !== "browser" && (
        <div className="border-t border-white/5 bg-black/20 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="space-y-1.5 md:col-span-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex justify-between">
                API Key
                <a href="https://play.cartesia.ai/console" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">Obter Key</a>
              </span>
              <input
                type="password"
                value={apiKey}
                onChange={(event) => onApiKeyChange(event.target.value)}
                className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
                placeholder="sk_..."
              />
            </label>
            
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                Voz
                {isLoadingVoices && <Loader2 size={10} className="animate-spin text-zinc-400" />}
              </span>
              <select
                value={voiceId}
                onChange={(event) => onVoiceIdChange(event.target.value)}
                className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
                disabled={isLoadingVoices || availableVoices.length === 0}
              >
                <option value="" className="bg-zinc-900 text-zinc-200">Selecione uma voz</option>
                {availableVoices.map((v) => (
                  <option key={v.id} value={v.id} className="bg-zinc-900 text-zinc-200">{v.name}</option>
                ))}
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Modelo</span>
              <select
                value={model}
                onChange={(event) => onModelChange(event.target.value)}
                className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
              >
                <option value="sonic-3.5" className="bg-zinc-900 text-zinc-200">Sonic 3.5 (Flagship)</option>
                <option value="sonic-3" className="bg-zinc-900 text-zinc-200">Sonic 3 (Standard)</option>
                <option value="sonic-turbo" className="bg-zinc-900 text-zinc-200">Sonic Turbo (Ultra-low latency)</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Velocidade</span>
              <select
                value={speed}
                onChange={(event) => onSpeedChange(event.target.value)}
                className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
              >
                <option value="slowest" className="bg-zinc-900 text-zinc-200">Muito Lenta</option>
                <option value="slow" className="bg-zinc-900 text-zinc-200">Lenta</option>
                <option value="normal" className="bg-zinc-900 text-zinc-200">Normal</option>
                <option value="fast" className="bg-zinc-900 text-zinc-200">Rápida</option>
                <option value="fastest" className="bg-zinc-900 text-zinc-200">Muito Rápida</option>
              </select>
            </label>

            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Emoção</span>
              <select
                value={emotion}
                onChange={(event) => onEmotionChange(event.target.value)}
                className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
              >
                <option value="positivity" className="bg-zinc-900 text-zinc-200">Feliz (Positivity)</option>
                <option value="sadness" className="bg-zinc-900 text-zinc-200">Triste (Sadness)</option>
                <option value="anger" className="bg-zinc-900 text-zinc-200">Bravo (Anger)</option>
                <option value="curiosity" className="bg-zinc-900 text-zinc-200">Curioso (Curiosity)</option>
                <option value="surprise" className="bg-zinc-900 text-zinc-200">Surpresa (Surprise)</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button 
              onClick={() => onAction("test", "Voz testada com sucesso.")} 
              disabled={hasBusyAction || !apiKey || !voiceId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-white/5 border border-white/10 hover:bg-white/10 text-[11px] font-bold text-zinc-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busyAction === "test" ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Testar
            </button>
            <button 
              onClick={() => onAction("save", "Configuração salva.")} 
              disabled={hasBusyAction}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] bg-emerald-500/10 border border-emerald-500/20 hover:bg-emerald-500/20 text-[11px] font-bold text-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {busyAction === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
              Salvar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
