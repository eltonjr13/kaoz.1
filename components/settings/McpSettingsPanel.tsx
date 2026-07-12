import { useEffect, useState } from "react";
import { 
  Server, Plus, Play, Save, CheckCircle, AlertCircle, 
  Loader2, Trash2, ChevronDown, ChevronUp, Edit2, 
  Terminal, Globe, Cpu, Database, Info, Settings 
} from "lucide-react";
import type { McpSettings, McpServerConfig, McpServerStatus } from "@/services/mcp/mcp.types";

interface StatusMessage {
  text: string;
  type: "success" | "error" | "info";
}

interface McpPreset {
  name: string;
  description: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

const MCP_PRESETS: McpPreset[] = [
  {
    name: "Chrome Automator (Puppeteer)",
    description: "Navegação automatizada no Chrome para interações web com o Puppeteer.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-puppeteer"],
    env: {
      PUPPETEER_EXECUTABLE_PATH: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    }
  },
  {
    name: "Brave Search API",
    description: "Busca global na web usando a API oficial do Brave Search.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-brave-search"],
    env: {
      BRAVE_API_KEY: ""
    }
  },
  {
    name: "Fetch & Web Reader",
    description: "Extrai conteúdo de qualquer site e converte para Markdown limpo.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-fetch"],
    env: {}
  },
  {
    name: "GitHub API",
    description: "Gerencia repositórios, cria issues, PRs e edita arquivos via API do GitHub.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    env: {
      GITHUB_PERSONAL_ACCESS_TOKEN: ""
    }
  },
  {
    name: "Banco PostgreSQL",
    description: "Executa consultas e inspeciona esquemas de bancos de dados PostgreSQL.",
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost:5432/mydb"],
    env: {}
  },
  {
    name: "Spotify API",
    description: "Busca de faixas, playlists e controle de reprodução da sua conta Spotify.",
    transport: "stdio",
    command: "node",
    args: ["d:\\apps\\spotify-mcp\\build\\index.js"],
    env: {}
  },
  {
    name: "Customizado (Stdio Local)",
    description: "Configura um processo local executado via console padrão (stdio).",
    transport: "stdio",
    command: "npx",
    args: [],
    env: {}
  },
  {
    name: "Customizado (SSE API)",
    description: "Conecta-se a um servidor remoto via Server-Sent Events (HTTP).",
    transport: "sse",
    url: "http://localhost:3001/sse"
  }
];

function formatEnv(env?: Record<string, string>): string {
  return Object.entries(env || {}).map(([key, value]) => `${key}=${value}`).join("\n");
}

function parseEnv(text: string): Record<string, string> {
  return text.split("\n").reduce<Record<string, string>>((env, line) => {
    const trimmed = line.trim();
    const separatorIndex = trimmed.indexOf("=");
    if (!trimmed || separatorIndex <= 0) return env;
    env[trimmed.slice(0, separatorIndex).trim()] = trimmed.slice(separatorIndex + 1).trim();
    return env;
  }, {});
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function McpSettingsPanel({ onStatusMessage }: { onStatusMessage: (message: StatusMessage) => void }) {
  const [settings, setSettings] = useState<McpSettings>({ servers: [] });
  const [statuses, setStatuses] = useState<McpServerStatus[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  
  // UI states
  const [expandedServers, setExpandedServers] = useState<Record<string, boolean>>({});
  const [editingServers, setEditingServers] = useState<Record<string, boolean>>({});
  const [showTools, setShowTools] = useState<Record<string, boolean>>({});
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const res = await fetch("/api/mcp/config");
      const data = await res.json();
      if (data.settings) setSettings(data.settings);
      if (data.statuses) setStatuses(data.statuses);
    } catch {
      onStatusMessage({ text: "Erro ao carregar configurações MCP.", type: "error" });
    }
  }

  const handleSave = async (newSettings: McpSettings) => {
    setBusyAction("save");
    try {
      const res = await fetch("/api/mcp/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newSettings)
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      setSettings(newSettings);
      
      // Clear edit mode for all servers after saving
      setEditingServers({});
      
      onStatusMessage({ text: "Configurações MCP salvas e servidores reconectados.", type: "success" });
      setTimeout(loadSettings, 1000); // Reload statuses
    } catch (err: unknown) {
      onStatusMessage({ text: `Erro: ${getErrorMessage(err)}`, type: "error" });
    } finally {
      setBusyAction(null);
    }
  };

  const handleTest = async (server: McpServerConfig) => {
    setBusyAction(`test-${server.id}`);
    try {
      const res = await fetch("/api/mcp/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(server)
      });
      const data = await res.json() as McpServerStatus;
      
      // Update statuses list locally
      setStatuses(prev => {
        const index = prev.findIndex(s => s.id === server.id);
        if (index >= 0) {
          const updated = [...prev];
          updated[index] = data;
          return updated;
        } else {
          return [...prev, data];
        }
      });

      if (data.connected) {
        onStatusMessage({ text: `Conexão teste com ${server.name} foi bem sucedida. ${data.tools.length} ferramentas encontradas.`, type: "success" });
      } else {
        onStatusMessage({ text: `Falha na conexão teste: ${data.error}`, type: "error" });
      }
    } catch (err: unknown) {
      onStatusMessage({ text: `Erro de rede no teste: ${getErrorMessage(err)}`, type: "error" });
    } finally {
      setBusyAction(null);
    }
  };

  const addServerFromPreset = (preset: McpPreset) => {
    const newServer: McpServerConfig = {
      id: crypto.randomUUID(),
      name: preset.name,
      enabled: true,
      transport: preset.transport,
      command: preset.command || "",
      args: preset.args || [],
      env: preset.env || {},
      url: preset.url || ""
    };
    setSettings({ ...settings, servers: [...settings.servers, newServer] });
    setExpandedServers(prev => ({ ...prev, [newServer.id]: true }));
    setEditingServers(prev => ({ ...prev, [newServer.id]: true }));
    setShowPresets(false);
  };

  const updateServer = (id: string, updates: Partial<McpServerConfig>) => {
    setSettings({
      ...settings,
      servers: settings.servers.map(s => s.id === id ? { ...s, ...updates } : s)
    });
  };

  const removeServer = (id: string) => {
    setSettings({
      ...settings,
      servers: settings.servers.filter(s => s.id !== id)
    });
    setExpandedServers(prev => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
    setEditingServers(prev => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedServers(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleEdit = (id: string) => {
    setEditingServers(prev => {
      const isEditingNow = !prev[id];
      // Automatically expand card when turning on edit mode
      if (isEditingNow) {
        setExpandedServers(exp => ({ ...exp, [id]: true }));
      }
      return { ...prev, [id]: isEditingNow };
    });
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between border-b border-zinc-800/80 pb-4">
        <div className="space-y-1">
          <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
            <Server size={14} className="text-zinc-400" />
            <span>Servidores MCP (Model Context Protocol)</span>
          </h2>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-3xl font-medium">
            Configure servidores MCP para expandir as ferramentas do agente em tempo real (ex: Busca na web, Integrações de Banco de Dados, APIs Externas).
          </p>
        </div>
        
        <div className="flex gap-2 shrink-0">
          {/* Preset Adding Menu */}
          <div className="relative">
            <button 
              onClick={() => setShowPresets(!showPresets)} 
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded-lg text-[11px] font-semibold transition-all shadow-sm"
            >
              <Plus size={12} className="text-emerald-400" />
              Adicionar Servidor
            </button>
            
            {showPresets && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowPresets(false)} />
                <div className="absolute right-0 mt-2 w-80 bg-zinc-950 border border-zinc-800/90 rounded-xl shadow-2xl p-2 z-20 animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-md">
                  <div className="px-2.5 py-1.5 text-[9px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-900/60 mb-1">
                    Selecione um Preset ou Personalizado
                  </div>
                  <div className="max-h-[280px] overflow-y-auto space-y-0.5 pr-1 scrollbar-thin">
                    {MCP_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        onClick={() => addServerFromPreset(preset)}
                        className="w-full text-left p-2 rounded-lg hover:bg-zinc-900/60 flex flex-col gap-0.5 transition-colors group"
                      >
                        <span className="text-[11px] font-bold text-zinc-200 group-hover:text-emerald-400 transition-colors flex items-center gap-1 flex-row">
                          {preset.transport === "sse" ? <Globe size={10} className="text-zinc-500 shrink-0" /> : <Terminal size={10} className="text-zinc-500 shrink-0" />}
                          {preset.name}
                        </span>
                        <span className="text-[10px] text-zinc-500 leading-normal font-medium">
                          {preset.description}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <button 
            onClick={() => handleSave(settings)} 
            disabled={!!busyAction} 
            className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-lg text-[11px] font-bold transition-all disabled:opacity-50 shadow-sm"
          >
            {busyAction === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Salvar e Aplicar
          </button>
        </div>
      </div>

      {settings.servers.length === 0 && (
        <div className="p-12 border border-zinc-800 border-dashed rounded-xl flex flex-col items-center justify-center text-zinc-500 bg-zinc-900/10">
          <Server size={36} className="mb-3 opacity-20 text-zinc-400 animate-pulse" />
          <p className="text-[11px] font-bold uppercase tracking-widest text-zinc-400">Nenhum servidor configurado</p>
          <p className="text-[10px] text-zinc-500 mt-1 text-center max-w-xs leading-normal font-semibold">
            Adicione um servidor MCP a partir de um preset ou crie um do zero para começar.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {settings.servers.map(server => {
          const status = statuses.find(s => s.id === server.id);
          const isBusy = busyAction === `test-${server.id}`;
          const isExpanded = !!expandedServers[server.id];
          const isEditing = !!editingServers[server.id];

          return (
            <div 
              key={server.id} 
              className={`border border-zinc-900 rounded-xl transition-all duration-250 overflow-hidden backdrop-blur-sm shadow-md ${
                isExpanded 
                  ? "border-zinc-800 bg-zinc-950/20 shadow-black/20" 
                  : "hover:border-zinc-800 bg-zinc-900/10 hover:bg-zinc-900/20 shadow-black/5"
              }`}
            >
              {/* Header */}
              <div 
                onClick={() => toggleExpand(server.id)}
                className="flex items-center justify-between p-4 cursor-pointer select-none group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Chevron Toggle */}
                  <div className="text-zinc-500 group-hover:text-zinc-300 transition-colors">
                    {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </div>

                  {/* iOS Style Toggle Switch */}
                  <div onClick={(e) => e.stopPropagation()} className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={() => updateServer(server.id, { enabled: !server.enabled })}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full items-center transition-colors duration-200 ease-in-out outline-none ${
                        server.enabled ? "bg-emerald-500" : "bg-zinc-800"
                      }`}
                    >
                      <span
                        className="inline-block h-3.5 w-3.5 rounded-full bg-white shadow-md transition-transform duration-250 ease-in-out"
                        style={{ transform: server.enabled ? 'translateX(18px)' : 'translateX(2px)' }}
                      />
                    </button>
                  </div>

                  {/* Name (Input or Label) */}
                  <div className="flex items-center gap-1.5 min-w-0 group/name" onClick={(e) => e.stopPropagation()}>
                    {isEditing ? (
                      <input
                        value={server.name}
                        onChange={(e) => updateServer(server.id, { name: e.target.value })}
                        placeholder="Nome do Servidor"
                        className="bg-zinc-950 border border-zinc-800 focus:border-zinc-700 focus:ring-1 focus:ring-zinc-800 rounded px-2.5 py-1 text-xs font-bold text-zinc-100 outline-none w-44 md:w-56 transition-all"
                      />
                    ) : (
                      <span className="text-xs font-bold text-zinc-100 px-1 py-1 select-none truncate max-w-[160px] sm:max-w-[240px]">
                        {server.name}
                      </span>
                    )}
                  </div>
                  
                  {/* Status badge */}
                  <div className="shrink-0 hidden sm:block">
                    {status ? (
                      status.connected ? (
                        <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          Conectado ({status.tools?.length || 0} ferramentas)
                        </span>
                      ) : (
                        <span 
                          className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-semibold max-w-[180px] truncate" 
                          title={status.error || ""}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                          Falha na conexão
                        </span>
                      )
                    ) : (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-800/40 border border-zinc-800/60 text-zinc-500 text-[10px] font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                        {server.enabled ? "Pendente" : "Desativado"}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  {/* Test Connection Button */}
                  <button 
                    onClick={() => handleTest(server)} 
                    disabled={isBusy} 
                    className="flex items-center justify-center p-1.5 bg-zinc-900 border border-zinc-800/80 hover:border-zinc-700 text-zinc-400 hover:text-emerald-400 rounded-lg transition-all disabled:opacity-50" 
                    title="Testar Conexão"
                  >
                    {isBusy ? <Loader2 size={12} className="animate-spin text-emerald-400" /> : <Play size={12} />}
                  </button>

                  {/* Toggle Edit Mode Button */}
                  <button 
                    onClick={() => toggleEdit(server.id)} 
                    className={`flex items-center justify-center p-1.5 border rounded-lg transition-all ${
                      isEditing 
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20" 
                        : "bg-zinc-900 border-zinc-800/80 hover:border-zinc-700 text-zinc-400 hover:text-zinc-200"
                    }`}
                    title={isEditing ? "Concluir Edição" : "Editar Configuração"}
                  >
                    {isEditing ? <CheckCircle size={12} /> : <Edit2 size={12} />}
                  </button>

                  {/* Delete Button */}
                  <button 
                    onClick={() => removeServer(server.id)} 
                    className="flex items-center justify-center p-1.5 bg-zinc-900 border border-zinc-800/80 hover:border-rose-900/80 hover:bg-rose-950/20 text-zinc-450 hover:text-rose-400 rounded-lg transition-all"
                    title="Remover Servidor"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              {/* Body */}
              {isExpanded && (
                <div className="px-5 pb-5 border-t border-zinc-900 bg-zinc-950/25 space-y-4 animate-in fade-in duration-200">
                  
                  {/* Connection error panel */}
                  {status && !status.connected && status.error && (
                    <div className="p-3 rounded-lg bg-rose-500/5 border border-rose-500/20 text-rose-400 text-xs flex gap-2 items-start mt-4">
                      <AlertCircle size={14} className="shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="font-bold text-[10px] uppercase tracking-wide">Detalhes da Falha</p>
                        <p className="text-[10px] font-mono break-all leading-normal opacity-90">{status.error}</p>
                      </div>
                    </div>
                  )}

                  {isEditing ? (
                    /* EDIT MODE: Form Fields */
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 max-w-4xl">
                      {/* Transport */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                          <Settings size={10} />
                          Transporte
                        </label>
                        <select
                          value={server.transport}
                          onChange={(e) => updateServer(server.id, { transport: e.target.value as McpServerConfig["transport"] })}
                          className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-[11px] font-semibold text-zinc-300 focus:border-emerald-500/50 outline-none transition-all cursor-pointer"
                        >
                          <option value="stdio">stdio (Comando Local)</option>
                          <option value="sse">sse (API Remota)</option>
                        </select>
                      </div>

                      {server.transport === "stdio" ? (
                        <>
                          {/* Command */}
                          <div className="flex flex-col gap-1.5">
                            <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                              <Terminal size={10} />
                              Comando (ex: npx, node, python)
                            </label>
                            <input
                              value={server.command}
                              onChange={(e) => updateServer(server.id, { command: e.target.value })}
                              placeholder="npx"
                              className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-[11px] font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>

                          {/* Arguments */}
                          <div className="flex flex-col gap-1.5 md:col-span-2">
                            <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                              <Info size={10} />
                              Argumentos (Separados por espaço)
                            </label>
                            <input
                              value={server.args?.join(" ")}
                              onChange={(e) => updateServer(server.id, { args: e.target.value.split(" ").filter(Boolean) })}
                              placeholder="-y @modelcontextprotocol/server-brave-search"
                              className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-[11px] font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>

                          {/* Environment Variables */}
                          <div className="flex flex-col gap-1.5 md:col-span-2">
                            <div className="flex items-center justify-between">
                              <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                                <Database size={10} />
                                Variáveis de Ambiente (UMA POR LINHA)
                              </label>
                              <span className="text-[9px] text-zinc-600 font-mono">CHAVE=VALOR</span>
                            </div>
                            <textarea
                              value={formatEnv(server.env)}
                              onChange={(e) => updateServer(server.id, { env: parseEnv(e.target.value) })}
                              placeholder="PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
                              rows={3}
                              className="w-full resize-y rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-[11px] font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all"
                            />
                          </div>
                        </>
                      ) : (
                        /* URL SSE */
                        <div className="flex flex-col gap-1.5 md:col-span-2">
                          <label className="text-[9px] font-bold uppercase tracking-widest text-zinc-500 flex items-center gap-1.5">
                            <Globe size={10} />
                            URL SSE
                          </label>
                          <input
                            value={server.url}
                            onChange={(e) => updateServer(server.id, { url: e.target.value })}
                            placeholder="http://localhost:3001/sse"
                            className="w-full rounded-lg border border-zinc-850 bg-zinc-950 px-3 py-2 text-[11px] font-mono text-zinc-300 focus:border-emerald-500/50 outline-none transition-all"
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    /* READ-ONLY MODE: Sleek Dashboard Data Cards */
                    <div className="space-y-3 text-xs mt-4 max-w-4xl">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 border border-zinc-900/60 bg-zinc-950/40 p-4 rounded-xl">
                        <div>
                          <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-0.5">Transporte</span>
                          <span className="text-zinc-200 font-mono bg-zinc-900 px-2 py-0.5 rounded text-[11px] inline-block">{server.transport}</span>
                        </div>
                        {server.transport === "stdio" ? (
                          <>
                            <div>
                              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-0.5">Comando</span>
                              <span className="text-zinc-200 font-mono bg-zinc-900 px-2 py-0.5 rounded text-[11px] inline-block">{server.command || "npx"}</span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-0.5">Argumentos</span>
                              <div className="bg-zinc-950 border border-zinc-900 rounded-lg p-2.5 font-mono text-zinc-300 text-[11px] break-all leading-normal">
                                {server.args && server.args.length > 0 ? server.args.join(" ") : <span className="text-zinc-650 italic">(Nenhum argumento)</span>}
                              </div>
                            </div>
                            {server.env && Object.keys(server.env).length > 0 && (
                              <div className="sm:col-span-2">
                                <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-0.5">Variáveis de Ambiente</span>
                                <div className="bg-zinc-950 border border-zinc-900 rounded-lg p-2.5 font-mono text-[11px] space-y-1">
                                  {Object.entries(server.env).map(([key, val]) => (
                                    <div key={key} className="truncate">
                                      <span className="text-emerald-400 font-semibold">{key}</span>
                                      <span className="text-zinc-600 mx-1.5">=</span>
                                      <span className="text-zinc-350">{val}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="sm:col-span-2">
                            <span className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider block mb-0.5">URL SSE</span>
                            <div className="bg-zinc-950 border border-zinc-900 rounded-lg p-2.5 font-mono text-zinc-350 text-[11px] break-all">
                              {server.url || <span className="text-zinc-650 italic">(Não configurada)</span>}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Active Tools List (Collapsible) */}
                  {status && status.connected && status.tools && status.tools.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-zinc-900 space-y-2">
                      <button
                        type="button"
                        onClick={() => setShowTools(prev => ({ ...prev, [server.id]: !prev[server.id] }))}
                        className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-widest text-emerald-400 hover:text-emerald-300 transition-colors focus:outline-none"
                      >
                        {showTools[server.id] ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        <span>Ferramentas Disponíveis ({status.tools.length})</span>
                      </button>
                      
                      {showTools[server.id] && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 mt-2 max-h-60 overflow-y-auto pr-1 scrollbar-thin">
                          {status.tools.map(tool => (
                            <div key={tool.name} className="p-2.5 rounded-lg bg-zinc-950 border border-zinc-900/60 flex flex-col gap-1 hover:border-zinc-800/80 transition-colors group/tool">
                              <span className="text-[11px] font-mono font-bold text-emerald-400 flex items-center gap-1.5">
                                <Cpu size={10} className="text-zinc-500 group-hover/tool:text-emerald-400 transition-colors shrink-0" />
                                {tool.name}
                              </span>
                              {tool.description && (
                                <span className="text-[10px] text-zinc-400 leading-relaxed font-medium">
                                  {tool.description}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

