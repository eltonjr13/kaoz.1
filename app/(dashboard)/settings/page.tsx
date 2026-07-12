"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Settings,
  Cpu,
  Bot,
  Key,
  Globe,
  Sparkles,
  Loader2,
  CheckCircle,
  AlertCircle,
  Play,
  XCircle,
  RefreshCw,
  Box,
  Mic,
  Volume2,
  Save,
  Terminal,
  Zap,
  MoreVertical,
  ChevronDown,
  ChevronUp,
  Compass,
  Rocket,
  Activity,
  Server
} from "lucide-react";
import { TTSProviderCard, type TTSOption } from "@/components/settings/TTSProviderCard";
import type { TTSConfig, TTSProviderName } from "@/services/tts/tts.types";
import { fetchCartesiaVoices, playCartesiaVoiceWebSocket } from "@/lib/cartesia";
import { McpSettingsPanel } from "@/components/settings/McpSettingsPanel";
import { SkillsSettingsPanel } from "@/components/settings/SkillsSettingsPanel";

interface PortalConfig {
  id: "google" | "gemini" | "chatgpt" | "claude" | "deepseek" | "hunyuan3d";
  name: string;
  url: string;
  description: string;
  icon: typeof Globe | typeof Sparkles | typeof Cpu | typeof Settings | typeof Bot | typeof Box;
  color: string;
}

interface ExtensionStatus {
  enabled: boolean;
  configured: boolean;
  connected: boolean;
  lastHeartbeatAt: number | null;
  pendingTasks: number;
}

type SpeechProviderName = "webspeech" | "whisper" | "whisper-speed";

interface SpeechConfig {
  provider: SpeechProviderName;
  chunkMs: number;
}

type AgentLLMProvider = "browser" | "codex-cli" | "grok-cli" | "antigravity-cli" | "cerebras" | "zenmux-grok" | "iamhc";

interface AgentLLMCommandStatus {
  command: string;
  available: boolean;
  resolvedPath: string | null;
  error: string | null;
  authenticated: boolean | null;
  authMessage: string | null;
  activeModel: string | null;
  models: string[];
}

interface AgentLLMConfig {
  provider: AgentLLMProvider;
  codexCommand: string;
  codexModel: string;
  grokCommand: string;
  grokModel: string;
  antigravityCommand: string;
  antigravityModel: string;
  iamhcModel: string;
  timeoutMs: number;
  status: {
    codex: AgentLLMCommandStatus;
    grok: AgentLLMCommandStatus;
    antigravity: AgentLLMCommandStatus;
  } | null;
}

type OmniVoiceServerStatus = "idle" | "starting" | "waiting_for_login" | "running" | "captured" | "error";

interface OmniVoiceConfig {
  notebookUrl: string;
  apiUrl: string;
  effectiveApiUrl: string | null;
  source: "settings" | "env" | "none";
  status: OmniVoiceServerStatus;
  lastError: string | null;
  lastCaptureAt: string | null;
  runStartedAt: string | null;
  defaultRefAudio: string | null;
}

type StatusMessage = { text: string; type: "success" | "error" | "info" };

type ApiProviderId = "gemini" | "openai" | "deepseek" | "anthropic" | "cerebras" | "zenmux" | "iamhc";
type ApiProviderConfig = { id: ApiProviderId; configured: boolean; source: "settings" | "env" | "none"; baseUrl: string; model: string };

const API_PROVIDER_LABELS: Record<ApiProviderId, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  deepseek: "DeepSeek",
  anthropic: "Anthropic Claude",
  cerebras: "Cerebras",
  zenmux: "ZenMux",
  iamhc: "IAMHC",
};

const TTS_OPTIONS: TTSOption[] = [
  {
    id: "cartesia",
    name: "Cartesia (Sonic)",
    description: "Vozes ultrarrealistas e de baixíssima latência.",
    icon: Zap,
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "Sintetização de voz líder de mercado (Breve).",
    icon: Volume2,
  },
  {
    id: "omnivoice",
    name: "OmniVoice",
    description: "Geração de voz via Notebook/Gradio do OmniVoice.",
    icon: Cpu,
  },
  {
    id: "fish-audio",
    name: "Fish Audio S2.1 Pro",
    description: "TTS via API Fish Audio usando o modelo gratuito s2.1-pro-free.",
    icon: Volume2,
  },
  {
    id: "browser",
    name: "Navegador",
    description: "Voz nativa do navegador (Baixa qualidade).",
    icon: Globe,
  }
];

const SPEECH_OPTIONS: Array<{
  id: SpeechProviderName;
  name: string;
  description: string;
}> = [
  {
    id: "webspeech",
    name: "Web",
    description: "Usa a transcricao nativa do navegador."
  },
  {
    id: "whisper",
    name: "Whisper",
    description: "Faster-Whisper local com mais estabilidade."
  },
  {
    id: "whisper-speed",
    name: "Whisper Speed",
    description: "Faster-Whisper local priorizando baixa latencia."
  }
];

const AGENT_LLM_OPTIONS: Array<{
  id: AgentLLMProvider;
  name: string;
  description: string;
  category: "api" | "cli" | "browser";
  icon: any;
}> = [
  {
    id: "browser",
    name: "Navegador",
    description: "Automação web simulando humano.",
    category: "browser",
    icon: Compass
  },
  {
    id: "codex-cli",
    name: "Codex CLI",
    description: "Usa codex exec com modelo rapido.",
    category: "cli",
    icon: Terminal
  },
  {
    id: "grok-cli",
    name: "Grok CLI",
    description: "Usa grok headless com modelo fast.",
    category: "cli",
    icon: Terminal
  },
  {
    id: "antigravity-cli",
    name: "Antigravity CLI",
    description: "Usa agy --print com permissões.",
    category: "cli",
    icon: Rocket
  },
  {
    id: "cerebras",
    name: "Cerebras API",
    description: "API direta e ultra-veloz do Cerebras.",
    category: "api",
    icon: Zap
  },
  {
    id: "zenmux-grok",
    name: "ZenMux Grok API",
    description: "Integração via ZenMux AI usando Grok 4.5 Free.",
    category: "api",
    icon: Zap
  },
  {
    id: "iamhc",
    name: "IAMHC API",
    description: "API OpenAI-compatível com catálogo de modelos chineses por chave.",
    category: "api",
    icon: Zap
  }
];

const ANTIGRAVITY_FALLBACK_MODELS = [
  "gemini-3.5-pro",
  "gemini-3.5-flash",
  "gemini-3.1-pro",
  "gemini-2.0-flash",
  "gemini-2.0-flash-thinking",
  "claude-3-7-sonnet"
];

const CODEX_FALLBACK_MODELS = [
  "gpt-5.6",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.5",
  "gpt-5.3-codex-spark",
  "gpt-5.4",
  "gpt-5.4-mini"
];

const PORTALS: PortalConfig[] = [
  {
    id: "google",
    name: "Google Flow",
    url: "https://labs.google/fx/pt/tools/flow/",
    description: "Automação do estúdio criativo ImageFX e VideoFX.",
    icon: Globe,
    color: "text-blue-400 bg-blue-500/5 border-blue-500/10"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    url: "https://gemini.google.com",
    description: "Refinamento e otimização avançada de prompts via Gemini.",
    icon: Sparkles,
    color: "text-indigo-400 bg-indigo-500/5 border-indigo-500/10"
  },
  {
    id: "chatgpt",
    name: "OpenAI ChatGPT",
    url: "https://chatgpt.com",
    description: "Otimização e detalhamento de conceitos via ChatGPT.",
    icon: Cpu,
    color: "text-emerald-400 bg-emerald-500/5 border-emerald-500/10"
  },
  {
    id: "claude",
    name: "Anthropic Claude",
    url: "https://claude.ai",
    description: "Expansão linguística e detalhamento fotográfico via Claude.",
    icon: Settings,
    color: "text-amber-400 bg-amber-500/5 border-amber-500/10"
  },
  {
    id: "deepseek",
    name: "DeepSeek Chat",
    url: "https://chat.deepseek.com",
    description: "Refinamento rápido e inteligência contextual via DeepSeek.",
    icon: Bot,
    color: "text-sky-400 bg-sky-500/5 border-sky-500/10"
  },
  {
    id: "hunyuan3d",
    name: "Tencent Hunyuan 3D",
    url: "https://3d.hunyuan.tencent.com/",
    description: "Geração de malhas 3D (.glb) a partir de turnaround.",
    icon: Box,
    color: "text-[#9D7CFF] bg-[#9D7CFF]/5 border-[#9D7CFF]/10"
  }
];

function parseSpeechConfig(data: Record<string, unknown>): SpeechConfig {
  return {
    provider: data.provider === "webspeech" || data.provider === "whisper" || data.provider === "whisper-speed"
      ? data.provider
      : "whisper-speed",
    chunkMs: typeof data.chunkMs === "number" ? data.chunkMs : 0,
  };
}

function parseAgentLLMProvider(value: unknown): AgentLLMProvider {
  return value === "codex-cli" || value === "grok-cli" || value === "antigravity-cli" || value === "browser" || value === "cerebras" || value === "zenmux-grok" || value === "iamhc"
    ? value
    : "browser";
}

function parseCommandStatus(value: unknown): AgentLLMCommandStatus {
  const status = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const models = Array.isArray(status.models)
    ? status.models.filter((model): model is string => typeof model === "string")
    : [];
  return {
    command: stringOrEmpty(status.command),
    available: status.available === true,
    resolvedPath: stringOrNull(status.resolvedPath),
    error: stringOrNull(status.error),
    authenticated: typeof status.authenticated === "boolean" ? status.authenticated : null,
    authMessage: stringOrNull(status.authMessage),
    activeModel: stringOrNull(status.activeModel),
    models
  };
}

function parseAgentLLMConfig(data: Record<string, unknown>): AgentLLMConfig {
  const status = data.status && typeof data.status === "object" ? data.status as Record<string, unknown> : null;
  return {
    provider: parseAgentLLMProvider(data.provider),
    codexCommand: stringOrEmpty(data.codexCommand) || "codex",
    codexModel: stringOrEmpty(data.codexModel) || "gpt-5.6",
    grokCommand: stringOrEmpty(data.grokCommand) || "grok",
    grokModel: stringOrEmpty(data.grokModel) || "grok-composer-2.5-fast",
    antigravityCommand: stringOrEmpty(data.antigravityCommand) || "agy",
    antigravityModel: stringOrEmpty(data.antigravityModel) || "gemini-3.5-pro",
    iamhcModel: stringOrEmpty(data.iamhcModel) || "DeepSeek-V4-Flash",
    timeoutMs: typeof data.timeoutMs === "number" ? data.timeoutMs : 45000,
    status: status
      ? {
        codex: parseCommandStatus(status.codex),
        grok: parseCommandStatus(status.grok),
        antigravity: parseCommandStatus(status.antigravity)
      }
      : null
  };
}

function normalizeOmniVoiceStatus(value: unknown): OmniVoiceServerStatus {
  const statuses: OmniVoiceServerStatus[] = ["starting", "waiting_for_login", "running", "captured", "error"];
  return statuses.includes(value as OmniVoiceServerStatus) ? value as OmniVoiceServerStatus : "idle";
}

function normalizeOmniVoiceSource(value: unknown): OmniVoiceConfig["source"] {
  return value === "settings" || value === "env" ? value : "none";
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseOmniVoiceConfig(data: Record<string, unknown>): OmniVoiceConfig {
  return {
    notebookUrl: stringOrEmpty(data.notebookUrl),
    apiUrl: stringOrEmpty(data.apiUrl),
    effectiveApiUrl: stringOrNull(data.effectiveApiUrl),
    source: normalizeOmniVoiceSource(data.source),
    status: normalizeOmniVoiceStatus(data.status),
    lastError: stringOrNull(data.lastError),
    lastCaptureAt: stringOrNull(data.lastCaptureAt),
    runStartedAt: stringOrNull(data.runStartedAt),
    defaultRefAudio: stringOrNull(data.defaultRefAudio)
  };
}

function getSpeechOptionName(provider: SpeechProviderName): string {
  return SPEECH_OPTIONS.find((option) => option.id === provider)?.name || provider;
}

function getAgentLLMOptionName(provider: AgentLLMProvider): string {
  return AGENT_LLM_OPTIONS.find((option) => option.id === provider)?.name || provider;
}

function getProviderStatus(config: AgentLLMConfig | null, provider: AgentLLMProvider): AgentLLMCommandStatus | null {
  if (!config?.status || provider === "browser" || provider === "cerebras" || provider === "zenmux-grok" || provider === "iamhc") return null;
  if (provider === "antigravity-cli") return config.status.antigravity;
  return provider === "codex-cli" ? config.status.codex : config.status.grok;
}

function getAgentLLMStatusText(status: AgentLLMCommandStatus | null, provider?: AgentLLMProvider): string {
  if (provider === "cerebras" || provider === "zenmux-grok" || provider === "iamhc") return "Conexão Direta (API)";
  if (!status) return "Usando navegador";
  if (!status.available) return "Comando ausente";
  if (status.authenticated === true) return "Conectado";
  if (status.authenticated === false) return "Nao conectado";
  return "Instalado";
}

function getAgentLLMStatusClass(status: AgentLLMCommandStatus | null, provider?: AgentLLMProvider): string {
  if (provider === "cerebras" || provider === "zenmux-grok" || provider === "iamhc") return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
  if (!status) return "border-white/10 bg-white/5 text-zinc-400";
  if (!status.available || status.authenticated === false) return "border-rose-500/20 bg-rose-500/10 text-rose-400";
  if (status.authenticated === true) return "border-emerald-500/20 bg-emerald-500/10 text-emerald-400";
  return "border-amber-500/20 bg-amber-500/10 text-amber-300";
}

function AgentLLMStatusBadge({ status, provider }: { status: AgentLLMCommandStatus | null; provider?: AgentLLMProvider }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[9px] font-bold ${getAgentLLMStatusClass(status, provider)}`}>
      {getAgentLLMStatusText(status, provider)}
    </span>
  );
}

type AgentLLMActionButtonProps = {
  label: string;
  action: string;
  busyAction: string | null;
  disabled?: boolean;
  icon: typeof Save;
  onClick: () => void;
};

function AgentLLMActionButton({ label, action, busyAction, disabled = false, icon: Icon, onClick }: AgentLLMActionButtonProps) {
  const busy = busyAction === action;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] font-bold text-zinc-200 transition-all hover:bg-white/[0.06] disabled:opacity-50"
    >
      {busy ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
      <span>{label}</span>
    </button>
  );
}


type AgentLLMCardProps = {
  provider: AgentLLMProvider;
  option: typeof AGENT_LLM_OPTIONS[0];
  config: AgentLLMConfig | null;
  isSelected: boolean;
  isExpanded: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  
  // Fields props
  command: string;
  model: string;
  models: string[];
  onCommandChange: (value: string) => void;
  onModelChange: (value: string) => void;

  // Actions props
  busyAction: string | null;
  onAction: (action: string, successText: string) => void;
};

function AgentLLMCard({
  provider,
  option,
  config,
  isSelected,
  isExpanded,
  disabled,
  onSelect,
  onToggleExpand,
  command,
  model,
  models,
  onCommandChange,
  onModelChange,
  busyAction,
  onAction
}: AgentLLMCardProps) {
  const status = getProviderStatus(config, provider);
  const Icon = option.icon;
  const hasBusyAction = Boolean(busyAction);
  const isApiProvider = provider === "cerebras" || provider === "zenmux-grok" || provider === "iamhc";
  
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
            {isApiProvider && (
              <span className="rounded-full bg-[#ff4f00]/10 border border-[#ff4f00]/20 px-2 py-0.5 text-[9px] font-bold text-[#ff4f00] uppercase tracking-wider">
                Recomendado
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-500 mb-3">{option.description}</p>
          
          <div className="flex flex-wrap gap-2">
            <span className="inline-flex rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400">
              {option.category === "api" ? "API Direta" : option.category === "cli" ? "CLI Local" : "Navegador"}
            </span>
            <AgentLLMStatusBadge status={status} provider={provider} />
            {(model && !isApiProvider && provider !== "browser") && (
              <span className="inline-flex rounded border border-white/10 bg-black/30 px-1.5 py-0.5 text-[9px] font-mono text-zinc-400">
                {model}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Menu / Expand Toggle */}
      {provider !== "browser" && !isApiProvider && (
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
      {isExpanded && provider !== "browser" && !isApiProvider && (
        <div className="border-t border-white/5 bg-black/20 p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Comando</span>
              <input
                value={command}
                onChange={(event) => onCommandChange(event.target.value)}
                className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Modelo</span>
              {models.length > 0 ? (
                <select
                  value={model}
                  onChange={(event) => onModelChange(event.target.value)}
                  className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
                >
                  {models.map((modelOption) => (
                    <option key={modelOption} value={modelOption} className="bg-zinc-900 text-zinc-200">{modelOption}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(event) => onModelChange(event.target.value)}
                  className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
                />
              )}
            </label>
          </div>
          
          {status?.authMessage && (
            <p className="mb-4 text-[10px] leading-relaxed text-zinc-500 bg-white/5 p-2 rounded-lg border border-white/5">{status.authMessage}</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <AgentLLMActionButton label="Conectar" action="connect" busyAction={busyAction} disabled={hasBusyAction} icon={Play} onClick={() => onAction("connect", "Janela de conexao aberta.")} />
            <AgentLLMActionButton label="Testar" action="test" busyAction={busyAction} disabled={hasBusyAction} icon={CheckCircle} onClick={() => onAction("test", "CLI testada com sucesso.")} />
            <AgentLLMActionButton label="Salvar" action="save" busyAction={busyAction} disabled={hasBusyAction} icon={Save} onClick={() => onAction("save", "Configuração salva com sucesso.")} />
            <div className="flex-1" />
            <AgentLLMActionButton label="Atualizar" action="status" busyAction={busyAction} disabled={hasBusyAction} icon={RefreshCw} onClick={() => onAction("status", "Status atualizado.")} />
          </div>
        </div>
      )}

      {isSelected && isApiProvider && (
        <div className="border-t border-white/5 bg-black/20 p-4 flex items-center gap-2">
          <AgentLLMActionButton label="Testar conexão" action="test" busyAction={busyAction} disabled={hasBusyAction} icon={CheckCircle} onClick={() => onAction("test", "API respondeu com sucesso.")} />
          <span className="text-[10px] text-zinc-500">Configure o token e o modelo em “Tokens das APIs”.</span>
        </div>
      )}
    </div>
  );
}

function ApiProviderSettingsPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [providers, setProviders] = useState<ApiProviderConfig[]>([]);
  const [drafts, setDrafts] = useState<Record<string, { apiKey: string; baseUrl: string; model: string }>>({});
  const [saving, setSaving] = useState<ApiProviderId | null>(null);
  const [expandedProvider, setExpandedProvider] = useState<ApiProviderId | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/api-providers/config", { cache: "no-store" });
      const data = await response.json() as { providers?: ApiProviderConfig[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar as APIs.");
      const next = data.providers || [];
      setProviders(next);
      setDrafts(Object.fromEntries(next.map((provider) => [provider.id, { apiKey: "", baseUrl: provider.baseUrl, model: provider.model }])));
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    }
  }, [onStatusMessage]);

  useEffect(() => { void load(); }, [load]);

  const updateDraft = (id: ApiProviderId, field: "apiKey" | "baseUrl" | "model", value: string) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], [field]: value } }));
  };

  const save = async (provider: ApiProviderConfig) => {
    const draft = drafts[provider.id];
    setSaving(provider.id);
    try {
      const response = await fetch("/api/api-providers/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, ...(draft.apiKey ? { apiKey: draft.apiKey } : {}), baseUrl: draft.baseUrl, model: draft.model }),
      });
      const data = await response.json() as { provider?: ApiProviderConfig; error?: string };
      if (!response.ok || !data.provider) throw new Error(data.error || "Não foi possível salvar a API.");
      setProviders((current) => current.map((item) => item.id === provider.id ? data.provider! : item));
      setDrafts((current) => ({ ...current, [provider.id]: { apiKey: "", baseUrl: data.provider!.baseUrl, model: data.provider!.model } }));
      onStatusMessage({ text: `${API_PROVIDER_LABELS[provider.id]} salva. O token não será exibido novamente.`, type: "success" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally { setSaving(null); }
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#0d0d0f]">
      <div className="flex flex-col gap-4 border-b border-white/[0.07] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-500/20 bg-violet-500/10 text-violet-300"><Key size={15} /></div>
          <div><h3 className="text-sm font-bold text-zinc-100">Credenciais de API</h3><p className="mt-0.5 text-[10px] text-zinc-500">Tokens privados, modelos e endpoints</p></div>
        </div>
        <div className="flex items-center gap-2 text-[10px]"><span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 font-bold text-emerald-300">{providers.filter((item) => item.configured).length} prontas</span><span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-zinc-500">{providers.length} provedores</span></div>
      </div>
      <div className="grid grid-cols-1 gap-px bg-white/[0.06] md:grid-cols-2">
        {providers.map((provider) => {
          const draft = drafts[provider.id] || { apiKey: "", baseUrl: provider.baseUrl, model: provider.model };
          const isExpanded = expandedProvider === provider.id;
          return <div key={provider.id} className={`bg-[#101012] transition-colors ${isExpanded ? "md:col-span-2" : "hover:bg-[#131316]"}`}>
            <button type="button" onClick={() => setExpandedProvider(isExpanded ? null : provider.id)} className="flex w-full items-center gap-3 p-4 text-left">
              <span className={`h-2 w-2 shrink-0 rounded-full ${provider.configured ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,.5)]" : "bg-zinc-700"}`} />
              <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-zinc-200">{API_PROVIDER_LABELS[provider.id]}</span><span className="mt-0.5 block truncate text-[10px] font-mono text-zinc-600">{provider.model}</span></span>
              <span className={`hidden rounded-full border px-2 py-0.5 text-[9px] font-bold sm:inline-flex ${provider.configured ? "border-emerald-500/15 bg-emerald-500/[0.07] text-emerald-400" : "border-white/10 bg-white/[0.03] text-zinc-500"}`}>{provider.configured ? "Configurada" : "Configurar"}</span>
              {isExpanded ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-600" />}
            </button>
            {isExpanded && <div className="border-t border-white/[0.06] bg-black/20 p-4 sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-4"><p className="max-w-xl text-[10px] leading-relaxed text-zinc-500">O token fica salvo apenas no servidor local e nunca é exibido novamente. Deixe o campo vazio para manter o token atual.</p>{provider.configured && <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-emerald-400">Origem: {provider.source === "settings" ? "Configurações" : ".env"}</span>}</div>
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <label className="space-y-1.5 lg:col-span-2"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Token da API</span><input type="password" value={draft.apiKey} onChange={(event) => updateDraft(provider.id, "apiKey", event.target.value)} placeholder={provider.configured ? "••••••••••••  Token já salvo" : "Cole o token da API"} className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[11px] font-mono text-zinc-200 outline-none transition focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10" /></label>
                <label className="space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Modelo</span><input value={draft.model} onChange={(event) => updateDraft(provider.id, "model", event.target.value)} placeholder="Modelo" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[11px] font-mono text-zinc-200 outline-none transition focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10" /></label>
                <label className="space-y-1.5"><span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Endpoint</span><input value={draft.baseUrl} onChange={(event) => updateDraft(provider.id, "baseUrl", event.target.value)} placeholder="URL base padrão" className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-[11px] font-mono text-zinc-200 outline-none transition focus:border-violet-500/50 focus:ring-2 focus:ring-violet-500/10" /></label>
              </div>
              <div className="mt-4 flex items-center justify-end gap-2"><button type="button" onClick={() => setExpandedProvider(null)} className="rounded-full px-3 py-2 text-[10px] font-bold text-zinc-500 hover:text-zinc-300">Cancelar</button><button type="button" onClick={() => void save(provider)} disabled={saving !== null} className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[10px] font-bold text-black transition hover:bg-zinc-200 disabled:opacity-50">{saving === provider.id ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />} Salvar configuração</button></div>
            </div>}
          </div>;
        })}
      </div>
    </section>
  );
}

function AgentLLMSettingsPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [config, setConfig] = useState<AgentLLMConfig | null>(null);
  const [provider, setProvider] = useState<AgentLLMProvider>("browser");
  const [codexCommand, setCodexCommand] = useState("codex");
  const [codexModel, setCodexModel] = useState("gpt-5.6");
  const [grokCommand, setGrokCommand] = useState("grok");
  const [grokModel, setGrokModel] = useState("grok-composer-2.5-fast");
  const [antigravityCommand, setAntigravityCommand] = useState("agy");
  const [antigravityModel, setAntigravityModel] = useState("gemini-3.5-pro");
  const [iamhcModel, setIamhcModel] = useState("DeepSeek-V4-Flash");
  const [iamhcModels, setIamhcModels] = useState<Array<{ id: string; ownedBy: string }>>([]);
  const [iamhcModelsError, setIamhcModelsError] = useState<string | null>(null);
  const [isLoadingIamhcModels, setIsLoadingIamhcModels] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const selectedStatus = getProviderStatus(config, provider);
  const selectedCommand = provider === "codex-cli" ? codexCommand : provider === "antigravity-cli" ? antigravityCommand : grokCommand;
  const selectedModel = provider === "codex-cli" ? codexModel : provider === "antigravity-cli" ? antigravityModel : grokModel;
  
  const fallbackModels = provider === "antigravity-cli" 
    ? ANTIGRAVITY_FALLBACK_MODELS 
    : provider === "codex-cli" 
      ? CODEX_FALLBACK_MODELS 
      : [];
      
  const selectedModels = provider === "browser"
    ? []
    : Array.from(new Set([selectedModel, ...fallbackModels, ...(selectedStatus?.models || [])].filter(Boolean)));
  const hasBusyAction = Boolean(busyAction);

  const applyConfig = useCallback((nextConfig: AgentLLMConfig) => {
    setConfig(nextConfig);
    setProvider(nextConfig.provider);
    setCodexCommand(nextConfig.codexCommand);
    setCodexModel(nextConfig.codexModel);
    setGrokCommand(nextConfig.grokCommand);
    setGrokModel(nextConfig.grokModel);
    setAntigravityCommand(nextConfig.antigravityCommand);
    setAntigravityModel(nextConfig.antigravityModel);
    setIamhcModel(nextConfig.iamhcModel);
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadAgentLLMConfig() {
      try {
        const res = await fetch("/api/agent-llm/config", { cache: "no-store" });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nao foi possivel carregar a CLI do agente.");
        }
        if (isMounted) applyConfig(parseAgentLLMConfig(data));
      } catch (err) {
        console.error("Erro ao carregar configuracao de CLI do agente:", err);
      }
    }

    void loadAgentLLMConfig();
    return () => {
      isMounted = false;
    };
  }, [applyConfig]);

  useEffect(() => {
    if (provider !== "iamhc") return;
    let isMounted = true;
    setIsLoadingIamhcModels(true);
    setIamhcModelsError(null);
    void fetch("/api/agent-llm/models", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { models?: Array<{ id?: unknown; ownedBy?: unknown }>; error?: unknown };
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Falha ao listar modelos IAMHC.");
        return (data.models || [])
          .filter((item): item is { id: string; ownedBy: string } => typeof item.id === "string" && typeof item.ownedBy === "string");
      })
      .then((models) => { if (isMounted) setIamhcModels(models); })
      .catch((error) => { if (isMounted) setIamhcModelsError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (isMounted) setIsLoadingIamhcModels(false); });
    return () => { isMounted = false; };
  }, [provider]);

  const buildPayload = (action: string) => ({
    action,
    provider,
    codexCommand,
    codexModel,
    grokCommand,
    grokModel,
    antigravityCommand,
    antigravityModel,
    iamhcModel,
    timeoutMs: config?.timeoutMs || 45000
  });

  const updateSelectedModel = (model: string) => {
    if (provider === "codex-cli") {
      setCodexModel(model);
    } else if (provider === "antigravity-cli") {
      setAntigravityModel(model);
    } else {
      setGrokModel(model);
    }
  };

  const runAction = async (action: string, successText: string) => {
    setBusyAction(action);
    try {
      const res = await fetch("/api/agent-llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(action))
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Falha na CLI do agente.");
      }
      applyConfig(parseAgentLLMConfig(data));
      onStatusMessage({ text: typeof data.message === "string" ? data.message : successText, type: "success" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onStatusMessage({ text: `Erro na CLI do agente: ${errMsg}`, type: "error" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSelectProvider = async (newProvider: AgentLLMProvider) => {
    if (newProvider === provider) return;
    setProvider(newProvider);
    setExpandedCard(null); // auto collapse when switching
    setBusyAction("select_" + newProvider);
    try {
      const payload = buildPayload("save");
      payload.provider = newProvider;
      const res = await fetch("/api/agent-llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Falha na CLI do agente.");
      }
      applyConfig(parseAgentLLMConfig(data));
      onStatusMessage({ text: `Agente alterado para ${getAgentLLMOptionName(newProvider)}.`, type: "success" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onStatusMessage({ text: `Erro ao alterar agente: ${errMsg}`, type: "error" });
      if (config) setProvider(config.provider);
    } finally {
      setBusyAction(null);
    }
  };

  const renderCard = (option: typeof AGENT_LLM_OPTIONS[0]) => {
    const isSelected = provider === option.id;
    // We only pass the fields props if this card's option is selected.
    // If not selected, it shouldn't show active config editing anyway.
    return (
      <AgentLLMCard
        key={option.id}
        provider={option.id}
        option={option}
        config={config}
        isSelected={isSelected}
        isExpanded={expandedCard === option.id}
        disabled={hasBusyAction}
        onSelect={() => handleSelectProvider(option.id)}
        onToggleExpand={() => setExpandedCard(prev => prev === option.id ? null : option.id)}
        command={isSelected ? selectedCommand : (option.id === "codex-cli" ? codexCommand : option.id === "antigravity-cli" ? antigravityCommand : grokCommand)}
        model={isSelected ? selectedModel : (option.id === "codex-cli" ? codexModel : option.id === "antigravity-cli" ? antigravityModel : grokModel)}
        models={isSelected ? selectedModels : []}
        onCommandChange={option.id === "codex-cli" ? setCodexCommand : option.id === "antigravity-cli" ? setAntigravityCommand : setGrokCommand}
        onModelChange={updateSelectedModel}
        busyAction={busyAction}
        onAction={runAction}
      />
    );
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5 mb-2">
        <Terminal size={14} className="text-zinc-400" />
        <span>Resposta do agente</span>
      </h2>
      
      <div className="space-y-6">
        <ApiProviderSettingsPanel onStatusMessage={onStatusMessage} />
        {/* API Diretas */}
        <section className="space-y-3">
          <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">API Diretas</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {AGENT_LLM_OPTIONS.filter(o => o.category === "api").map(renderCard)}
          </div>
          {provider === "iamhc" && (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-3">
              <div>
                <h3 className="text-xs font-bold text-emerald-100">Modelo LLM IAMHC</h3>
                <p className="mt-1 text-[11px] text-zinc-400">Catálogo liberado pela sua chave. Qwen, GLM, Kimi e DeepSeek aparecem primeiro quando disponíveis.</p>
              </div>
              <select
                value={iamhcModel}
                onChange={(event) => setIamhcModel(event.target.value)}
                disabled={isLoadingIamhcModels || iamhcModels.length === 0}
                className="w-full rounded-[10px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none focus:border-emerald-500/40 disabled:opacity-50"
              >
                <option value={iamhcModel}>{iamhcModel}</option>
                {iamhcModels.filter((model) => model.id !== iamhcModel).map((model) => (
                  <option key={model.id} value={model.id} className="bg-zinc-900 text-zinc-200">{model.id}{model.ownedBy ? ` · ${model.ownedBy}` : ""}</option>
                ))}
              </select>
              {iamhcModelsError ? <p className="text-[10px] text-rose-300">{iamhcModelsError}</p> : null}
              <div className="flex items-center gap-2">
                <AgentLLMActionButton label="Salvar modelo" action="save" busyAction={busyAction} disabled={hasBusyAction} icon={Save} onClick={() => runAction("save", "Modelo IAMHC salvo.")} />
                <AgentLLMActionButton label="Testar" action="test" busyAction={busyAction} disabled={hasBusyAction} icon={CheckCircle} onClick={() => runAction("test", "Modelo IAMHC respondeu.")} />
                {isLoadingIamhcModels ? <Loader2 size={13} className="animate-spin text-emerald-300" /> : null}
              </div>
            </div>
          )}
        </section>

        {/* Ferramentas CLI */}
        <section className="space-y-3">
          <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Ferramentas CLI</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {AGENT_LLM_OPTIONS.filter(o => o.category === "cli").map(renderCard)}
          </div>
        </section>

        {/* Navegador */}
        <section className="space-y-3">
          <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest px-1">Navegador</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {AGENT_LLM_OPTIONS.filter(o => o.category === "browser").map(renderCard)}
          </div>
        </section>
      </div>
    </div>
  );
}

function STTPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [speechConfig, setSpeechConfig] = useState<SpeechConfig | null>(null);
  const [savingSpeechProvider, setSavingSpeechProvider] = useState<SpeechProviderName | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadSpeechConfig() {
      try {
        const res = await fetch("/api/speech/config", { cache: "no-store" });
        const data = await res.json() as Record<string, unknown>;
        if (isMounted && res.ok) {
          setSpeechConfig(parseSpeechConfig(data));
        }
      } catch (err) {
        console.error("Erro ao carregar configuracao de transcricao:", err);
      }
    }

    void loadSpeechConfig();
    return () => {
      isMounted = false;
    };
  }, []);

  const updateSpeechProvider = async (provider: SpeechProviderName) => {
    setSavingSpeechProvider(provider);
    try {
      const res = await fetch("/api/speech/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Nao foi possivel salvar a transcricao.");
      }
      const config = parseSpeechConfig(data);
      setSpeechConfig(config);
      onStatusMessage({
        text: `Transcricao alterada para ${getSpeechOptionName(config.provider)}.`,
        type: "success"
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onStatusMessage({
        text: `Erro ao salvar transcricao: ${errMsg}`,
        type: "error"
      });
    } finally {
      setSavingSpeechProvider(null);
    }
  };

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
        <Mic size={14} className="text-zinc-400" />
        <span>Transcricao de voz</span>
      </h2>
      <div className="border border-white/5 rounded-[12px] bg-[#111114] p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {SPEECH_OPTIONS.map((option) => {
            const selected = speechConfig?.provider === option.id;
            const saving = savingSpeechProvider === option.id;

            return (
              <button
                key={option.id}
                type="button"
                onClick={() => updateSpeechProvider(option.id)}
                disabled={!!savingSpeechProvider}
                className={`text-left rounded-[10px] border p-4 transition-all disabled:opacity-60 ${
                  selected
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                    : "border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20 hover:bg-white/[0.06]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[12px] font-bold uppercase tracking-widest">{option.name}</span>
                  {saving ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : selected ? (
                    <CheckCircle size={12} className="text-emerald-400" />
                  ) : null}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-500">
                  {option.description}
                </p>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] text-zinc-600">
          O servidor Faster-Whisper local e iniciado automaticamente quando Whisper ou Whisper Speed estiver ativo.
        </p>
      </div>
    </div>
  );
}

function TTSSettingsPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [config, setConfig] = useState<TTSConfig | null>(null);
  const [provider, setProvider] = useState<TTSProviderName>("omnivoice");
  
  const [cartesiaApiKey, setCartesiaApiKey] = useState("");
  const [cartesiaVoiceId, setCartesiaVoiceId] = useState("");
  const [cartesiaModel, setCartesiaModel] = useState("sonic-3.5");
  const [cartesiaSpeed, setCartesiaSpeed] = useState("auto");
  const [cartesiaEmotion, setCartesiaEmotion] = useState("auto");
  const [fishAudioApiKey, setFishAudioApiKey] = useState("");
  const [fishAudioReferenceId, setFishAudioReferenceId] = useState("");
  const [fishAudioModel, setFishAudioModel] = useState("s2.1-pro-free");
  
  const [availableVoices, setAvailableVoices] = useState<any[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [expandedCard, setExpandedCard] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const hasBusyAction = Boolean(busyAction);

  const applyConfig = useCallback((nextConfig: TTSConfig) => {
    setConfig(nextConfig);
    setProvider(nextConfig.provider);
    setCartesiaApiKey(nextConfig.cartesiaApiKey || "");
    setCartesiaVoiceId(nextConfig.cartesiaVoiceId || "");
    let model = nextConfig.cartesiaModel || "sonic-3.5";
    if (model === "sonic") model = "sonic-3.5";
    if (model === "sonic-multilingual") model = "sonic-3";
    setCartesiaModel(model);
    setCartesiaSpeed(nextConfig.cartesiaSpeed || "auto");
    setFishAudioApiKey(nextConfig.fishAudioApiKey || "");
    setFishAudioReferenceId(nextConfig.fishAudioReferenceId || "");
    setFishAudioModel(nextConfig.fishAudioModel || "s2.1-pro-free");
    
    let emotion = nextConfig.cartesiaEmotion || "auto";
    if (emotion === "happy") emotion = "positivity";
    if (emotion === "sad") emotion = "sadness";
    if (emotion === "fear") emotion = "curiosity";
    setCartesiaEmotion(emotion);
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function loadConfig() {
      try {
        const res = await fetch("/api/tts/config", { cache: "no-store" });
        if (res.ok && isMounted) {
          applyConfig(await res.json());
        }
      } catch (err) {
        console.error("Erro ao carregar configuracao de TTS:", err);
      }
    }
    void loadConfig();
    return () => { isMounted = false; };
  }, [applyConfig]);

  useEffect(() => {
    if (provider === "cartesia" && cartesiaApiKey) {
      let isMounted = true;
      setIsLoadingVoices(true);
      fetchCartesiaVoices(cartesiaApiKey)
        .then(voices => {
          if (isMounted) setAvailableVoices(voices);
        })
        .catch(() => {
          if (isMounted) setAvailableVoices([]);
        })
        .finally(() => {
          if (isMounted) setIsLoadingVoices(false);
        });
      return () => { isMounted = false; };
    }
  }, [provider, cartesiaApiKey]);

  const handleSelectProvider = async (newProvider: TTSProviderName) => {
    if (newProvider === provider) return;
    setProvider(newProvider);
    setExpandedCard(null);
    setBusyAction("select_" + newProvider);
    try {
      const res = await fetch("/api/tts/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: newProvider })
      });
      if (!res.ok) throw new Error("Falha ao selecionar.");
      applyConfig(await res.json());
      onStatusMessage({ text: `Provedor de voz alterado.`, type: "success" });
    } catch (err) {
      onStatusMessage({ text: `Erro ao alterar provedor de voz.`, type: "error" });
      if (config) setProvider(config.provider);
    } finally {
      setBusyAction(null);
    }
  };

  const handleAction = async (actionProvider: TTSProviderName, action: string, successText: string) => {
    setBusyAction(action);
    try {
      if (action === "test") {
        if (actionProvider === "cartesia") {
          const testAudio = playCartesiaVoiceWebSocket(cartesiaApiKey, cartesiaVoiceId, "Olá! Esta é uma mensagem de teste do sistema MrChicken.", cartesiaModel, cartesiaSpeed, cartesiaEmotion);
          await testAudio.promise;
          onStatusMessage({ text: "Teste de voz finalizado.", type: "success" });
        } else if (actionProvider === "fish-audio") {
          const res = await fetch("/api/fish-audio/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text: "Ola! Esta e uma mensagem de teste do sistema MrChicken.",
              apiKey: fishAudioApiKey,
              referenceId: fishAudioReferenceId,
              model: fishAudioModel,
            }),
          });
          const data = await res.json() as { audioPath?: string; error?: string };
          if (!res.ok || !data.audioPath) {
            throw new Error(data.error || "Nao foi possivel gerar a voz Fish Audio.");
          }
          const audio = new Audio(data.audioPath);
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error("Nao foi possivel tocar o audio gerado."));
            void audio.play().catch(reject);
          });
          onStatusMessage({ text: "Teste de voz finalizado.", type: "success" });
        }
      } else if (action === "save") {
        const payload: Partial<TTSConfig> = { provider: actionProvider };
        if (actionProvider === "cartesia") {
          payload.cartesiaApiKey = cartesiaApiKey;
          payload.cartesiaVoiceId = cartesiaVoiceId;
          payload.cartesiaModel = cartesiaModel;
          payload.cartesiaSpeed = cartesiaSpeed;
          payload.cartesiaEmotion = cartesiaEmotion;
        }
        if (actionProvider === "fish-audio") {
          payload.fishAudioApiKey = fishAudioApiKey;
          payload.fishAudioReferenceId = fishAudioReferenceId;
          payload.fishAudioModel = fishAudioModel;
        }
        
        const res = await fetch("/api/tts/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error("Falha ao salvar.");
        applyConfig(await res.json());
        onStatusMessage({ text: successText, type: "success" });
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onStatusMessage({ text: `Erro: ${errMsg}`, type: "error" });
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div className="space-y-3 mb-8">
      <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
        <Volume2 size={14} className="text-zinc-400" />
        <span>Provedores de Voz (TTS)</span>
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {TTS_OPTIONS.map((option) => (
          <TTSProviderCard
            key={option.id}
            provider={option.id}
            option={option}
            config={config}
            isSelected={provider === option.id}
            isExpanded={expandedCard === option.id}
            disabled={hasBusyAction}
            onSelect={() => handleSelectProvider(option.id)}
            onToggleExpand={() => setExpandedCard(prev => prev === option.id ? null : option.id)}
            apiKey={option.id === "fish-audio" ? fishAudioApiKey : cartesiaApiKey}
            voiceId={option.id === "fish-audio" ? fishAudioReferenceId : cartesiaVoiceId}
            model={option.id === "fish-audio" ? fishAudioModel : cartesiaModel}
            speed={cartesiaSpeed}
            emotion={cartesiaEmotion}
            availableVoices={availableVoices}
            isLoadingVoices={isLoadingVoices}
            onApiKeyChange={option.id === "fish-audio" ? setFishAudioApiKey : setCartesiaApiKey}
            onVoiceIdChange={option.id === "fish-audio" ? setFishAudioReferenceId : setCartesiaVoiceId}
            onModelChange={option.id === "fish-audio" ? setFishAudioModel : setCartesiaModel}
            onSpeedChange={setCartesiaSpeed}
            onEmotionChange={setCartesiaEmotion}
            busyAction={busyAction}
            onAction={(action, successText) => handleAction(option.id, action, successText)}
          />
        ))}
      </div>
    </div>
  );
}

function VoiceAndTranscriptionPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  return (
    <div className="space-y-8">
      <TTSSettingsPanel onStatusMessage={onStatusMessage} />
      <STTPanel onStatusMessage={onStatusMessage} />
    </div>
  );
}

function isActiveOmniVoiceStatus(status: OmniVoiceServerStatus | undefined): boolean {
  return status === "starting" || status === "waiting_for_login" || status === "running";
}

function getOmniVoiceStatusLabel(config: OmniVoiceConfig | null): string {
  if (config?.status === "captured") return "URL capturada";
  if (config?.status === "error") return "Erro";
  if (isActiveOmniVoiceStatus(config?.status)) return "Aguardando URL";
  return "Parado";
}

function getOmniVoiceStatusClass(config: OmniVoiceConfig | null): string {
  if (config?.status === "captured") return "bg-emerald-500/10 border-emerald-500/20 text-emerald-400";
  if (config?.status === "error") return "bg-rose-500/10 border-rose-500/20 text-rose-400";
  return "bg-white/5 border-white/10 text-zinc-400";
}

function OmniVoiceStatusSummary({ config }: { config: OmniVoiceConfig | null }) {
  return (
    <div className="space-y-1 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-widest ${getOmniVoiceStatusClass(config)}`}>
          {getOmniVoiceStatusLabel(config)}
        </span>
        {config?.source !== "none" && (
          <span className="text-[10px] text-zinc-600">
            Fonte: {config?.source === "settings" ? "configuracoes" : ".env.local"}
          </span>
        )}
      </div>
      {config?.lastError && (
        <p className="text-[10px] leading-relaxed text-rose-300">{config.lastError}</p>
      )}
      {config?.effectiveApiUrl && (
        <p className="truncate text-[10px] font-mono text-zinc-500">{config.effectiveApiUrl}</p>
      )}
    </div>
  );
}

type OmniVoiceActionButtonProps = {
  label: string;
  action: string;
  busyAction: string | null;
  disabled?: boolean;
  icon: typeof Save;
  variant?: "default" | "primary" | "success";
  onClick: () => void;
};

function getActionButtonClass(variant: OmniVoiceActionButtonProps["variant"]): string {
  if (variant === "primary") {
    return "bg-white text-black hover:bg-zinc-200";
  }
  if (variant === "success") {
    return "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15";
  }
  return "border border-white/10 bg-white/[0.03] text-zinc-200 hover:bg-white/[0.06]";
}

function OmniVoiceActionButton({
  label,
  action,
  busyAction,
  disabled = false,
  icon: Icon,
  variant = "default",
  onClick
}: OmniVoiceActionButtonProps) {
  const busy = busyAction === action;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[10px] font-bold transition-all disabled:opacity-50 ${getActionButtonClass(variant)}`}
    >
      {busy ? <Loader2 size={10} className="animate-spin" /> : <Icon size={10} />}
      <span>{label}</span>
    </button>
  );
}

type OmniVoiceActionBarProps = {
  busyAction: string | null;
  canTest: boolean;
  isNotebookRunning: boolean;
  onSave: () => void;
  onStart: () => void;
  onCapture: () => void;
  onTest: () => void;
};

function OmniVoiceActionBar({
  busyAction,
  canTest,
  isNotebookRunning,
  onSave,
  onStart,
  onCapture,
  onTest
}: OmniVoiceActionBarProps) {
  const hasBusyAction = Boolean(busyAction);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <OmniVoiceActionButton label="Salvar" action="save" busyAction={busyAction} disabled={hasBusyAction} icon={Save} onClick={onSave} />
      <OmniVoiceActionButton label="Abrir no navegador" action="start-notebook" busyAction={busyAction} disabled={hasBusyAction || isNotebookRunning} icon={Play} variant="primary" onClick={onStart} />
      <OmniVoiceActionButton label="Capturar" action="capture-url" busyAction={busyAction} disabled={hasBusyAction} icon={RefreshCw} onClick={onCapture} />
      <OmniVoiceActionButton label="Testar" action="test" busyAction={busyAction} disabled={hasBusyAction || !canTest} icon={CheckCircle} variant="success" onClick={onTest} />
    </div>
  );
}

function OmniVoiceSettingsPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [config, setConfig] = useState<OmniVoiceConfig | null>(null);
  const [notebookUrl, setNotebookUrl] = useState("");
  const [apiUrl, setApiUrl] = useState("");
  const [outputText, setOutputText] = useState("");
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const applyConfig = useCallback((nextConfig: OmniVoiceConfig) => {
    setConfig(nextConfig);
    setNotebookUrl(nextConfig.notebookUrl);
    setApiUrl(nextConfig.apiUrl || nextConfig.effectiveApiUrl || "");
  }, []);

  const loadConfig = useCallback(async () => {
    const res = await fetch("/api/omnivoice/config", { cache: "no-store" });
    const data = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(typeof data.error === "string" ? data.error : "Nao foi possivel carregar o OmniVoice.");
    }
    applyConfig(parseOmniVoiceConfig(data));
  }, [applyConfig]);

  useEffect(() => {
    let isMounted = true;

    async function loadInitialConfig() {
      try {
        const res = await fetch("/api/omnivoice/config", { cache: "no-store" });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Nao foi possivel carregar o OmniVoice.");
        }
        if (isMounted) {
          applyConfig(parseOmniVoiceConfig(data));
        }
      } catch (err) {
        console.error("Erro ao carregar configuracao do OmniVoice:", err);
      }
    }

    void loadInitialConfig();
    return () => {
      isMounted = false;
    };
  }, [applyConfig]);

  useEffect(() => {
    if (!config || !["starting", "waiting_for_login", "running"].includes(config.status)) return;
    const timer = window.setInterval(() => {
      loadConfig().catch((err) => {
        console.error("Erro ao atualizar status do OmniVoice:", err);
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [config, loadConfig]);

  const runAction = async (action: string, successText: string) => {
    setBusyAction(action);
    try {
      const res = await fetch("/api/omnivoice/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, notebookUrl, apiUrl, outputText })
      });
      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Falha na configuracao do OmniVoice.");
      }
      const nextConfig = parseOmniVoiceConfig(data);
      applyConfig(nextConfig);
      onStatusMessage({ text: typeof data.message === "string" ? data.message : successText, type: "success" });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      onStatusMessage({ text: `Erro no OmniVoice: ${errMsg}`, type: "error" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleAudioUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusyAction("upload-audio");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result as string;
        const res = await fetch("/api/omnivoice/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "upload-audio", refAudioBase64: base64 })
        });
        const data = await res.json() as Record<string, unknown>;
        if (!res.ok) {
          throw new Error(typeof data.error === "string" ? data.error : "Falha ao enviar áudio.");
        }
        applyConfig(parseOmniVoiceConfig(data));
        onStatusMessage({ text: "Áudio de referência salvo com sucesso.", type: "success" });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        onStatusMessage({ text: `Erro no upload: ${errMsg}`, type: "error" });
      } finally {
        setBusyAction(null);
      }
    };
    reader.readAsDataURL(file);
  };

  const canTest = Boolean(apiUrl.trim() || config?.effectiveApiUrl);
  const isNotebookRunning = isActiveOmniVoiceStatus(config?.status);

  return (
    <div className="space-y-3">
      <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
        <Volume2 size={14} className="text-zinc-400" />
        <span>OmniVoice</span>
      </h2>
      <div className="border border-white/5 rounded-[12px] bg-[#111114] p-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Notebook Kaggle</span>
            <div className="w-full truncate rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-[11px] font-mono text-zinc-400">
              {notebookUrl || "OMNIVOICE_NOTEBOOK_URL"}
            </div>
          </div>
          <label className="space-y-1.5">
            <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">URL OmniVoice</span>
            <input
              value={apiUrl}
              onChange={(event) => setApiUrl(event.target.value)}
              placeholder="https://...gradio.live"
              className="w-full rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-zinc-200 outline-none focus:border-white/25"
            />
            </label>
        </div>

        <div className="space-y-1.5 border-t border-white/[0.04] pt-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Voz Padrão (Clonagem)</span>
          <p className="text-[10px] leading-relaxed text-zinc-500">Selecione um áudio base para padronizar a voz de todas as gerações.</p>
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <input 
              type="file" 
              accept="audio/*" 
              onChange={handleAudioUpload} 
              disabled={Boolean(busyAction)}
              className="text-[11px] text-zinc-400 file:mr-4 file:py-1.5 file:px-3 file:rounded-full file:border-0 file:text-[10px] file:font-bold file:bg-white/10 file:text-zinc-200 hover:file:bg-white/20 transition-all disabled:opacity-50"
            />
            {config?.defaultRefAudio && (
              <audio src={config.defaultRefAudio} controls className="h-8 w-full md:w-64" />
            )}
          </div>
        </div>

        <label className="block space-y-1.5 border-t border-white/[0.04] pt-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Saida do notebook</span>
          <textarea
            value={outputText}
            onChange={(event) => setOutputText(event.target.value)}
            placeholder="Opcional: cole aqui a linha com a URL publica caso a captura automatica nao encontre."
            className="min-h-20 w-full resize-y rounded-[10px] border border-white/10 bg-black/30 px-3 py-2 text-[11px] text-zinc-200 outline-none focus:border-white/25"
          />
        </label>

        <div className="flex flex-col gap-3 border-t border-white/[0.04] pt-4 md:flex-row md:items-center md:justify-between">
          <OmniVoiceStatusSummary config={config} />
          <OmniVoiceActionBar
            busyAction={busyAction}
            canTest={canTest}
            isNotebookRunning={isNotebookRunning}
            onSave={() => runAction("save", "Configuracao do OmniVoice salva.")}
            onStart={() => runAction("start-notebook", "Notebook OmniVoice aberto no navegador.")}
            onCapture={() => runAction("capture-url", "URL do OmniVoice capturada.")}
            onTest={() => runAction("test", "Conexao com OmniVoice confirmada.")}
          />
        </div>
      </div>
    </div>
  );
}

type TabId = "geral" | "agente" | "voz" | "omnivoice" | "mcp" | "skills";

// eslint-disable-next-line complexity
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>("geral");
  const [loadingPortal, setLoadingPortal] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<StatusMessage | null>(null);
  const [isCheckingAll, setIsCheckingAll] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState<ExtensionStatus | null>(null);

  const [portalStatuses, setPortalStatuses] = useState<Record<string, 'connected' | 'disconnected' | 'checking'>>({
    google: 'disconnected',
    gemini: 'disconnected',
    chatgpt: 'disconnected',
    claude: 'disconnected',
    deepseek: 'disconnected',
    hunyuan3d: 'disconnected'
  });

  const checkAllStatuses = async () => {
    setIsCheckingAll(true);
    setPortalStatuses({
      google: 'checking',
      gemini: 'checking',
      chatgpt: 'checking',
      claude: 'checking',
      deepseek: 'checking',
      hunyuan3d: 'checking'
    });

    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-status" })
      });
      const data = await res.json();
      if (data.extension) {
        setExtensionStatus(data.extension);
      }
      if (data.success && data.statuses) {
        const updated: Record<string, 'connected' | 'disconnected' | 'checking'> = {};
        for (const [key, val] of Object.entries(data.statuses)) {
          updated[key] = val ? 'connected' : 'disconnected';
        }
        setPortalStatuses(updated);
      } else {
        setStatusMessage({
          text: data.error || "Nao foi possivel verificar os status agora.",
          type: "error"
        });
        setPortalStatuses({
          google: 'disconnected',
          gemini: 'disconnected',
          chatgpt: 'disconnected',
          claude: 'disconnected',
          deepseek: 'disconnected',
          hunyuan3d: 'disconnected'
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        text: `Erro ao verificar status: ${errMsg}`,
        type: "error"
      });
      setPortalStatuses({
        google: 'disconnected',
        gemini: 'disconnected',
        chatgpt: 'disconnected',
        claude: 'disconnected',
        deepseek: 'disconnected',
        hunyuan3d: 'disconnected'
      });
    } finally {
      setIsCheckingAll(false);
    }
  };

  // Trigger headful manual login session for a specific portal
  // eslint-disable-next-line complexity
  const handleOpenLogin = async (portal: PortalConfig) => {
    setLoadingPortal(portal.id);
    setStatusMessage({
      text: `Solicitando abertura de aba para ${portal.name}. Faca o login ou resolva a verificacao manual e depois use Verificar Status.`,
      type: "info"
    });

    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login-session", portal: portal.id })
      });

      const data = await res.json();
      if (data.extension) {
        setExtensionStatus(data.extension);
      }
      if (data.success && data.started) {
        setStatusMessage({
          text: data.message || `Janela de login para ${portal.name} aberta. Conclua o login e depois use Verificar Status.`,
          type: "info"
        });
        return;
      }

      if (data.success && data.result?.authenticated) {
        setStatusMessage({
          text: data.message || `Sessão de login para ${portal.name} concluída e salva com sucesso!`,
          type: "success"
        });
        setPortalStatuses(prev => ({ ...prev, [portal.id]: 'connected' }));
      } else {
        setStatusMessage({
          text: `Login não confirmado para ${portal.name}: ${data.error || "autenticação não detectada"}`,
          type: "error"
        });
        setPortalStatuses(prev => ({ ...prev, [portal.id]: 'disconnected' }));
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        text: `Erro de conexão ao abrir sessão: ${errMsg}`,
        type: "error"
      });
    } finally {
      setLoadingPortal(null);
    }
  };

  // Close all browser contexts helper
  const handleForceCloseAll = async () => {
    setStatusMessage({ text: "Encerrando todas as sessões do navegador...", type: "info" });
    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close" })
      });
      const data = await res.json();
      if (data.success) {
        setStatusMessage({ text: "Todas as sessões abertas foram encerradas.", type: "success" });
        setPortalStatuses({
          google: 'disconnected',
          gemini: 'disconnected',
          chatgpt: 'disconnected',
          claude: 'disconnected',
          deepseek: 'disconnected',
          hunyuan3d: 'disconnected'
        });
      } else {
        setStatusMessage({ text: `Falha ao fechar sessões: ${data.error}`, type: "error" });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ text: `Erro de rede: ${errMsg}`, type: "error" });
    }
  };

  return (
    <div className="flex-1 w-full min-h-full flex flex-col justify-start px-4 py-6 pb-20 sm:px-6 lg:px-8 lg:py-8 select-none overflow-y-auto" style={{ backgroundColor: '#0a0a0a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.07] pb-6 mb-6 gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
            <Settings size={20} className="text-zinc-400" />
            <span className="uppercase tracking-widest text-[13px]">Configurações do Sistema</span>
          </h1>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-xl">Centralize contas, APIs, modelos, voz e integrações usadas pelo agente.</p>
        </div>

        {activeTab === "geral" && <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={checkAllStatuses}
            disabled={isCheckingAll || !!loadingPortal}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-white text-black hover:bg-zinc-200 rounded-full text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer shadow-md"
          >
            {isCheckingAll ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            <span>Verificar Status</span>
          </button>
          
          <button
            onClick={handleForceCloseAll}
            disabled={!!loadingPortal || isCheckingAll}
            className="flex items-center justify-center gap-1.5 px-4 py-2 border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-rose-500 rounded-full text-[11px] font-bold transition-all disabled:opacity-50 cursor-pointer"
          >
            <XCircle size={12} />
            <span>Encerrar Navegadores</span>
          </button>
        </div>}
      </div>

      {/* Tabs Navigation */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 flex items-center gap-1 overflow-x-auto border-y border-white/[0.06] bg-[#0a0a0a]/95 px-4 backdrop-blur-xl sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <button
          onClick={() => setActiveTab("geral")}
          className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === "geral"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/20"
          }`}
        >
          Contas de IA
        </button>
        <button
          onClick={() => setActiveTab("agente")}
          className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === "agente"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/20"
          }`}
        >
          Agente LLM
        </button>
        <button
          onClick={() => setActiveTab("voz")}
          className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === "voz"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/20"
          }`}
        >
          Voz & Transcrição
        </button>
        <button
          onClick={() => setActiveTab("omnivoice")}
          className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest transition-all border-b-2 ${
            activeTab === "omnivoice"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/20"
          }`}
        >
          OmniVoice
        </button>
        <button
          onClick={() => setActiveTab("mcp")}
          className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest transition-all border-b-2 flex items-center gap-1.5 ${
            activeTab === "mcp"
              ? "border-emerald-500 text-emerald-400"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/20"
          }`}
        >
          <Server size={14} className={activeTab === "mcp" ? "text-emerald-400" : "text-zinc-500"} />
          MCP
        </button>
        <button
          onClick={() => setActiveTab("skills")}
          className={`px-4 py-3 text-[11px] font-bold uppercase tracking-widest transition-all border-b-2 flex items-center gap-1.5 ${
            activeTab === "skills"
              ? "border-[#9D7CFF] text-[#9D7CFF]"
              : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-white/20"
          }`}
        >
          <Sparkles size={14} className={activeTab === "skills" ? "text-[#9D7CFF]" : "text-zinc-500"} />
          Skills
        </button>
      </div>

      {/* Info Status Board */}
      {statusMessage && (
        <div
          className={`p-4 rounded-[12px] border flex items-start gap-3 text-[11px] leading-relaxed transition-all mb-6 ${
            statusMessage.type === "success"
              ? "bg-emerald-500/5 border-emerald-500/20 text-emerald-300"
              : statusMessage.type === "error"
              ? "bg-rose-500/5 border-rose-500/20 text-rose-300"
              : "bg-blue-500/5 border-blue-500/20 text-blue-300"
          }`}
        >
          {statusMessage.type === "success" && <CheckCircle size={14} className="shrink-0 text-emerald-500 mt-0.5" />}
          {statusMessage.type === "error" && <AlertCircle size={14} className="shrink-0 text-rose-500 mt-0.5" />}
          {statusMessage.type === "info" && <Loader2 size={14} className="shrink-0 text-blue-500 animate-spin mt-0.5" />}
          
          <div className="flex-1">
            <span className="font-bold block mb-0.5">
              {statusMessage.type === "success" && "Sucesso!"}
              {statusMessage.type === "error" && "Erro no Processo!"}
              {statusMessage.type === "info" && "Ação Requerida (Sessão Ativa)"}
            </span>
            <span>{statusMessage.text}</span>
          </div>
        </div>
      )}

      {/* Tab Content Areas */}
      <div className="space-y-6">
        
        {/* TAB: Skills */}
        {activeTab === "skills" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <SkillsSettingsPanel />
          </div>
        )}

        {/* TAB: Agente LLM */}
        {activeTab === "agente" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <AgentLLMSettingsPanel onStatusMessage={setStatusMessage} />
          </div>
        )}

        {/* TAB: Voz */}
        {activeTab === "voz" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <VoiceAndTranscriptionPanel onStatusMessage={setStatusMessage} />
          </div>
        )}

        {/* TAB: OmniVoice */}
        {activeTab === "omnivoice" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <OmniVoiceSettingsPanel onStatusMessage={setStatusMessage} />
          </div>
        )}

        {/* TAB: MCP */}
        {activeTab === "mcp" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <McpSettingsPanel onStatusMessage={setStatusMessage} />
          </div>
        )}

        {/* TAB: Geral (Contas de IA) */}
        {activeTab === "geral" && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300 space-y-6">
            <div className="space-y-1">
              <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
                <Key size={14} className="text-zinc-400" />
                <span>Contas & Login das IAs (Perfis do Playwright)</span>
              </h2>
              <p className="text-[11px] text-zinc-500 leading-relaxed max-w-3xl">
                Como os agentes rodam via automação de navegador em segundo plano, você só precisa fazer o login nas suas contas uma vez. O Playwright guardará a sua sessão de cookies permanentemente. Ao clicar em <strong>Fazer Login</strong>, uma janela de navegador visível será aberta para você logar na respectiva conta. O MrChicken fechará a janela automaticamente após detectar o sucesso da conexão.
              </p>
            </div>

            {extensionStatus && (
              <div className="border border-white/5 rounded-[12px] bg-[#111114] p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-300">
                    Extensão Chrome
                  </span>
                  <p className="text-[11px] text-zinc-500 leading-relaxed">
                    {extensionStatus.enabled
                      ? "Driver de extensão ativo para abrir e controlar abas reais do Chrome."
                      : "Driver Playwright ativo. Defina FLOW_BROWSER_DRIVER=extension para usar a extensão."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-bold ${
                    extensionStatus.configured
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                  }`}>
                    {extensionStatus.configured ? "Token configurado" : "Token ausente"}
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-bold ${
                    extensionStatus.connected
                      ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                      : "bg-white/5 border-white/10 text-zinc-400"
                  }`}>
                    {extensionStatus.connected ? "Extensão conectada" : "Sem heartbeat"}
                  </span>
                  {extensionStatus.pendingTasks > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full border bg-blue-500/10 border-blue-500/20 text-blue-400 text-[9px] font-bold">
                      {extensionStatus.pendingTasks} tarefa(s)
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Portals Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PORTALS.map((portal) => {
                const Icon = portal.icon;
                const isLoading = loadingPortal === portal.id;
                const status = portalStatuses[portal.id];
                
                return (
                  <div
                    key={portal.id}
                    className="border border-white/5 rounded-[16px] p-5 bg-[#111114] flex flex-col justify-between hover:border-white/10 hover:shadow-xl transition-all duration-200"
                  >
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-[12px] border border-white/5 shrink-0 ${portal.color}`}>
                        <Icon size={18} />
                      </div>

                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13px] font-bold text-white block truncate">
                            {portal.name}
                          </span>
                          
                          {/* Status Badge */}
                          {status === 'connected' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-bold">
                              <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse"></span>
                              <span>Conectado</span>
                            </span>
                          ) : status === 'checking' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-[9px] font-bold">
                              <Loader2 size={8} className="animate-spin text-blue-400" />
                              <span>Checando...</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-400 text-[9px] font-bold">
                              <span>Requer Login</span>
                            </span>
                          )}
                        </div>
                        
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          {portal.description}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between border-t border-white/[0.04] pt-4 mt-5">
                      <span className="text-[9px] font-mono text-zinc-600">
                        {portal.id}.profile
                      </span>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleOpenLogin(portal)}
                          disabled={!!loadingPortal || status === 'checking'}
                          className="flex items-center gap-1 px-4 py-1.5 rounded-full bg-white text-black text-[10px] font-bold hover:bg-zinc-200 disabled:opacity-50 transition-all cursor-pointer shadow-md"
                        >
                          {isLoading ? (
                            <>
                              <Loader2 size={10} className="animate-spin" />
                              <span>Processando...</span>
                            </>
                          ) : (
                            <>
                              <Play size={10} />
                              <span>Fazer Login</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
