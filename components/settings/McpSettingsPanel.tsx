import { useEffect, useState } from "react";
import { Server, Plus, Play, Save, CheckCircle, AlertCircle, Loader2, Trash2 } from "lucide-react";
import type { McpSettings, McpServerConfig, McpServerStatus } from "@/services/mcp/mcp.types";

interface StatusMessage {
  text: string;
  type: "success" | "error" | "info";
}

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
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);

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

  const addServer = () => {
    const newServer: McpServerConfig = {
      id: crypto.randomUUID(),
      name: "Novo Servidor",
      enabled: true,
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-brave-search"],
      env: {}
    };
    setSettings({ ...settings, servers: [...settings.servers, newServer] });
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
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
          <Server size={14} className="text-zinc-400" />
          <span>Servidores MCP (Model Context Protocol)</span>
        </h2>
        
        <div className="flex gap-2">
          <button onClick={addServer} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white rounded-full text-[10px] font-bold transition-all">
            <Plus size={12} />
            Adicionar Servidor
          </button>
          <button onClick={() => handleSave(settings)} disabled={!!busyAction} className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-full text-[10px] font-bold transition-all disabled:opacity-50">
            {busyAction === "save" ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Salvar e Aplicar
          </button>
        </div>
      </div>

      <p className="text-[11px] text-zinc-500 leading-relaxed mb-6">
        Configure servidores MCP para expandir as ferramentas do agente em tempo real (ex: Busca na web, Integrações de Banco de Dados, APIs Externas).
      </p>

      {settings.servers.length === 0 && (
        <div className="p-8 border border-white/5 border-dashed rounded-xl flex flex-col items-center justify-center text-zinc-500">
          <Server size={32} className="mb-3 opacity-20" />
          <p className="text-[12px] font-bold uppercase tracking-widest">Nenhum servidor configurado</p>
        </div>
      )}

      <div className="space-y-3">
        {settings.servers.map(server => {
          const status = statuses.find(s => s.id === server.id);
          const isBusy = busyAction === `test-${server.id}`;

          return (
            <div key={server.id} className="border border-white/10 bg-black/20 rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(e) => updateServer(server.id, { enabled: e.target.checked })}
                    className="w-4 h-4 rounded bg-white/5 border-white/20 text-emerald-500"
                  />
                  <input
                    value={server.name}
                    onChange={(e) => updateServer(server.id, { name: e.target.value })}
                    className="bg-transparent border-none text-[13px] font-bold text-white outline-none w-48"
                  />
                  
                  {/* Status indicator */}
                  {status ? (
                    status.connected ? (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                        <CheckCircle size={10} /> Conectado ({status.tools?.length || 0} ferramentas)
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-400 text-[10px] font-bold">
                        <AlertCircle size={10} /> Falha ({status.error})
                      </span>
                    )
                  ) : (
                    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-zinc-400 text-[10px] font-bold">
                      Desconhecido
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => handleTest(server)} disabled={isBusy} className="flex items-center justify-center p-1.5 bg-white/5 hover:bg-white/10 text-zinc-300 rounded border border-white/10 transition-colors" title="Testar Conexão">
                    {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
                  </button>
                  <button onClick={() => removeServer(server.id)} className="flex items-center justify-center p-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 rounded border border-rose-500/20 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="space-y-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Transporte</span>
                  <select
                    value={server.transport}
                    onChange={(e) => updateServer(server.id, { transport: e.target.value as McpServerConfig["transport"] })}
                    className="w-full rounded-[8px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none"
                  >
                    <option value="stdio">stdio (Comando Local)</option>
                    <option value="sse">sse (API Remota)</option>
                  </select>
                </label>

                {server.transport === "stdio" ? (
                  <>
                    <label className="space-y-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Comando (Ex: npx)</span>
                      <input
                        value={server.command}
                        onChange={(e) => updateServer(server.id, { command: e.target.value })}
                        className="w-full rounded-[8px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none"
                      />
                    </label>
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Argumentos (Separados por espaço)</span>
                      <input
                        value={server.args?.join(" ")}
                        onChange={(e) => updateServer(server.id, { args: e.target.value.split(" ").filter(Boolean) })}
                        className="w-full rounded-[8px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none"
                      />
                    </label>
                    <label className="space-y-1.5 md:col-span-2">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Variaveis de ambiente (uma por linha)</span>
                      <textarea
                        value={formatEnv(server.env)}
                        onChange={(e) => updateServer(server.id, { env: parseEnv(e.target.value) })}
                        placeholder="PUPPETEER_EXECUTABLE_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
                        rows={3}
                        className="w-full resize-y rounded-[8px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none"
                      />
                    </label>
                  </>
                ) : (
                  <label className="space-y-1.5 md:col-span-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">URL SSE</span>
                    <input
                      value={server.url}
                      onChange={(e) => updateServer(server.id, { url: e.target.value })}
                      placeholder="http://localhost:3001/sse"
                      className="w-full rounded-[8px] border border-white/10 bg-black/40 px-3 py-2 text-[11px] font-mono text-zinc-200 outline-none"
                    />
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
