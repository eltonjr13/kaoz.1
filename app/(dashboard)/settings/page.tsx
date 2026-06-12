"use client";

import { useState } from "react";
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
  MessageSquare
} from "lucide-react";

interface PortalConfig {
  id: "google" | "gemini" | "chatgpt" | "claude" | "deepseek";
  name: string;
  url: string;
  description: string;
  icon: typeof MessageSquare | typeof Globe | typeof Bot;
  color: string;
}

const PORTALS: PortalConfig[] = [
  {
    id: "google",
    name: "Google Flow",
    url: "https://labs.google/fx/pt/tools/flow/",
    description: "Automação do estúdio criativo ImageFX e VideoFX.",
    icon: Globe,
    color: "text-blue-500 bg-blue-500/10 border-blue-500/20"
  },
  {
    id: "gemini",
    name: "Google Gemini",
    url: "https://gemini.google.com",
    description: "Refinamento e otimização avançada de prompts via Gemini.",
    icon: Sparkles,
    color: "text-indigo-500 bg-indigo-500/10 border-indigo-500/20"
  },
  {
    id: "chatgpt",
    name: "OpenAI ChatGPT",
    url: "https://chatgpt.com",
    description: "Otimização e detalhamento de conceitos via ChatGPT.",
    icon: Cpu,
    color: "text-emerald-500 bg-emerald-500/10 border-emerald-500/20"
  },
  {
    id: "claude",
    name: "Anthropic Claude",
    url: "https://claude.ai",
    description: "Expansão linguística e detalhamento fotográfico via Claude.",
    icon: Settings,
    color: "text-amber-500 bg-amber-500/10 border-amber-500/20"
  },
  {
    id: "deepseek",
    name: "DeepSeek Chat",
    url: "https://chat.deepseek.com",
    description: "Refinamento rápido e inteligência contextual via DeepSeek.",
    icon: Bot,
    color: "text-sky-500 bg-sky-500/10 border-sky-500/20"
  }
];

export default function SettingsPage() {
  const [loadingPortal, setLoadingPortal] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: "success" | "error" | "info" } | null>(null);

  // Trigger headful manual login session for a specific portal
  const handleOpenLogin = async (portal: PortalConfig) => {
    setLoadingPortal(portal.id);
    setStatusMessage({
      text: `Navegador aberto para ${portal.name}. Faça o login na janela visível e feche-a para concluir.`,
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
      } else {
        setStatusMessage({ text: `Falha ao fechar sessões: ${data.error}`, type: "error" });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      setStatusMessage({ text: `Erro de rede: ${errMsg}`, type: "error" });
    }
  };

  return (
    <div className="flex-1 w-full p-6 space-y-6 overflow-y-auto bg-[var(--bg)]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-zinc-100 dark:border-zinc-900 pb-5 gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
            <Settings size={24} className="text-zinc-500" />
            <span>Configurações do Sistema</span>
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
            Gerencie credenciais, cookies de login das IAs e parametrizações dos agentes de automação.
          </p>
        </div>

        <button
          onClick={handleForceCloseAll}
          className="flex items-center justify-center gap-2 px-4 py-2 border border-rose-200 dark:border-rose-900/50 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-rose-500 rounded-lg text-xs font-bold transition-all cursor-pointer"
        >
          <XCircle size={14} />
          <span>Encerrar Navegadores</span>
        </button>
      </div>

      {/* Info Status Board */}
      {statusMessage && (
        <div
          className={`p-4 rounded-xl border flex items-start gap-3 text-xs leading-relaxed transition-all ${
            statusMessage.type === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-300"
              : statusMessage.type === "error"
              ? "bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30 text-rose-800 dark:text-rose-300"
              : "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/30 text-blue-800 dark:text-blue-300"
          }`}
        >
          {statusMessage.type === "success" && <CheckCircle size={16} className="shrink-0 text-emerald-500 mt-0.5" />}
          {statusMessage.type === "error" && <AlertCircle size={16} className="shrink-0 text-rose-500 mt-0.5" />}
          {statusMessage.type === "info" && <Loader2 size={16} className="shrink-0 text-blue-500 animate-spin mt-0.5" />}
          
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

      {/* Main Settings Card */}
      <div className="bg-white dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-6">
        <div>
          <h2 className="text-base font-bold flex items-center gap-2 border-b border-zinc-100 dark:border-zinc-900 pb-2">
            <Key size={18} className="text-indigo-500" />
            <span>Contas & Login das IAs (Playwright Session)</span>
          </h2>
          <p className="text-xs text-zinc-400 dark:text-zinc-500 mt-1">
            Como os agentes rodam via emulação de navegador, você precisa fazer o login nas suas contas uma vez. O Playwright irá guardar a sua sessão permanentemente. Clique no botão de login para abrir uma janela de navegador visível, faça login na sua conta normalmente e, quando concluir, feche a janela.
          </p>
        </div>

        {/* Portals Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {PORTALS.map((portal) => {
            const Icon = portal.icon;
            const isLoading = loadingPortal === portal.id;
            
            return (
              <div
                key={portal.id}
                className="border border-zinc-150 dark:border-zinc-850 rounded-xl p-4 bg-zinc-50/50 dark:bg-zinc-900/30 flex items-start gap-4 hover:border-zinc-300 dark:hover:border-zinc-750 transition-colors"
              >
                <div className={`p-3 rounded-lg border shrink-0 ${portal.color}`}>
                  <Icon size={20} />
                </div>

                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200 block truncate">
                      {portal.name}
                    </span>
                    <span className="text-[10px] font-mono text-zinc-400 dark:text-zinc-500">
                      {portal.id}.profile
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                    {portal.description}
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => handleOpenLogin(portal)}
                      disabled={!!loadingPortal}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-zinc-950 dark:bg-white text-white dark:text-zinc-950 text-[10px] font-bold hover:opacity-90 disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {isLoading ? (
                        <>
                          <Loader2 size={10} className="animate-spin" />
                          <span>Esperando fechar...</span>
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
