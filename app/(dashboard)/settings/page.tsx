"use client";

import { useState, useEffect } from "react";
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
  RefreshCw
} from "lucide-react";

interface PortalConfig {
  id: "google" | "gemini" | "chatgpt" | "claude" | "deepseek";
  name: string;
  url: string;
  description: string;
  icon: typeof Globe | typeof Sparkles | typeof Cpu | typeof Settings | typeof Bot;
  color: string;
}

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
  }
];

export default function SettingsPage() {
  const [loadingPortal, setLoadingPortal] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);
  const [isCheckingAll, setIsCheckingAll] = useState(false);

  const [portalStatuses, setPortalStatuses] = useState<Record<string, 'connected' | 'disconnected' | 'checking'>>({
    google: 'disconnected',
    gemini: 'disconnected',
    chatgpt: 'disconnected',
    claude: 'disconnected',
    deepseek: 'disconnected'
  });

  const checkAllStatuses = async () => {
    setIsCheckingAll(true);
    setPortalStatuses({
      google: 'checking',
      gemini: 'checking',
      chatgpt: 'checking',
      claude: 'checking',
      deepseek: 'checking'
    });

    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check-status" })
      });
      const data = await res.json();
      if (data.success && data.statuses) {
        const updated: Record<string, 'connected' | 'disconnected' | 'checking'> = {};
        for (const [key, val] of Object.entries(data.statuses)) {
          updated[key] = val ? 'connected' : 'disconnected';
        }
        setPortalStatuses(updated);
      } else {
        setPortalStatuses({
          google: 'disconnected',
          gemini: 'disconnected',
          chatgpt: 'disconnected',
          claude: 'disconnected',
          deepseek: 'disconnected'
        });
      }
    } catch {
      setPortalStatuses({
        google: 'disconnected',
        gemini: 'disconnected',
        chatgpt: 'disconnected',
        claude: 'disconnected',
        deepseek: 'disconnected'
      });
    } finally {
      setIsCheckingAll(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      checkAllStatuses();
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Trigger headful manual login session for a specific portal
  const handleOpenLogin = async (portal: PortalConfig) => {
    setLoadingPortal(portal.id);
    setStatusMessage({
      text: `Navegador aberto para ${portal.name}. Faça o login na janela visível. O MrChicken fechará a janela automaticamente assim que o login for detectado.`,
      type: "info"
    });

    try {
      const res = await fetch("/api/flow/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login-session", portal: portal.id })
      });

      const data = await res.json();
      if (data.success) {
        setStatusMessage({
          text: `Sessão de login para ${portal.name} concluída e salva com sucesso!`,
          type: "success"
        });
        // Set individual portal status to connected
        setPortalStatuses(prev => ({ ...prev, [portal.id]: 'connected' }));
      } else {
        setStatusMessage({
          text: `Erro ao concluir sessão de login: ${data.error || "Erro desconhecido"}`,
          type: "error"
        });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage({
        text: `Erro de conexão ao abrir sessão: ${errMsg}`,
        type: "error"
      });
    } finally {
      setLoadingPortal(null);
      // Run status check again to ensure status is up to date
      checkAllStatuses();
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
        checkAllStatuses();
      } else {
        setStatusMessage({ text: `Falha ao fechar sessões: ${data.error}`, type: "error" });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ text: `Erro de rede: ${errMsg}`, type: "error" });
    }
  };

  return (
    <div className="flex-1 w-full min-h-full flex flex-col justify-start px-8 py-10 pb-20 select-none overflow-y-auto" style={{ backgroundColor: '#0a0a0a', fontFamily: 'Inter, system-ui, sans-serif' }}>
      
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-white/[0.07] pb-6 mb-8 gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-black tracking-tight text-white flex items-center gap-2">
            <Settings size={20} className="text-zinc-400" />
            <span className="uppercase tracking-widest text-[13px]">Configurações do Sistema</span>
          </h1>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-xl">
            Gerencie perfis de cookies, logins persistentes das IAs no Playwright e sessões ativas dos agentes de automação.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={checkAllStatuses}
            disabled={isCheckingAll}
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
            className="flex items-center justify-center gap-1.5 px-4 py-2 border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] text-rose-500 rounded-full text-[11px] font-bold transition-all cursor-pointer"
          >
            <XCircle size={12} />
            <span>Encerrar Navegadores</span>
          </button>
        </div>
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

      {/* Contas & Logins das IAs */}
      <div className="space-y-6">
        <div className="space-y-1">
          <h2 className="text-xs font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-1.5">
            <Key size={14} className="text-zinc-400" />
            <span>Contas & Login das IAs (Perfis do Playwright)</span>
          </h2>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-3xl">
            Como os agentes rodam via automação de navegador em segundo plano, você só precisa fazer o login nas suas contas uma vez. O Playwright guardará a sua sessão de cookies permanentemente. Ao clicar em <strong>Fazer Login</strong>, uma janela de navegador visível será aberta para você logar na respectiva conta. O MrChicken fechará a janela automaticamente após detectar o sucesso da conexão.
          </p>
        </div>

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
    </div>
  );
}
