"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Sparkles,
  Activity,
  Brain,
  Video,
  Settings,
  PlusCircle,
  MessageSquare,
  Scissors,
  Play,
  HelpCircle,
  CornerDownLeft,
  X,
} from "lucide-react";
import { useShortcuts } from "@/lib/shortcuts/ShortcutContext";
import { KbdBadge } from "./KbdBadge";

interface CommandItem {
  id: string;
  label: string;
  description: string;
  category: "Navegação" | "Chat & Criação" | "Edição de Vídeo" | "Ajuda";
  icon: React.ElementType;
  displayKey?: string;
  keywords?: string;
  action: () => void;
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { isCommandPaletteOpen, closeCommandPalette, openCheatsheet, triggerAction } = useShortcuts();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input on open
  useEffect(() => {
    if (isCommandPaletteOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isCommandPaletteOpen]);

  const commands: CommandItem[] = useMemo(() => {
    return [
      // Navigation
      {
        id: "nav-flow",
        label: "Kaoz.1 (Flow)",
        description: "Abrir o ambiente principal de criação, chat e agentes",
        category: "Navegação",
        icon: Sparkles,
        displayKey: "Alt + 1",
        keywords: "chat conversa inicio flow ia inteligencia",
        action: () => {
          closeCommandPalette();
          router.push("/flow");
        },
      },
      {
        id: "nav-supervision",
        label: "Supervisor de Agentes",
        description: "Acompanhar orquestração de tarefas e status de produção",
        category: "Navegação",
        icon: Activity,
        displayKey: "Alt + 2",
        keywords: "supervisao tarefas monitor agentes",
        action: () => {
          closeCommandPalette();
          router.push("/supervision");
        },
      },
      {
        id: "nav-cortex",
        label: "Córtex & Memória",
        description: "Explorar memórias cognitivas, identidades e grafos",
        category: "Navegação",
        icon: Brain,
        displayKey: "Alt + 3",
        keywords: "cortex memoria neural conhecimento identidades",
        action: () => {
          closeCommandPalette();
          router.push("/cortex");
        },
      },
      {
        id: "nav-video",
        label: "Edição de Vídeo",
        description: "Acessar o estúdio de corte, render e DaVinci Resolve",
        category: "Navegação",
        icon: Video,
        displayKey: "Alt + 4",
        keywords: "video davinci timeline corte edicao render",
        action: () => {
          closeCommandPalette();
          router.push("/video");
        },
      },
      {
        id: "nav-settings",
        label: "Configurações",
        description: "Modelos de IA, integrações MCP, voz e comportamento",
        category: "Navegação",
        icon: Settings,
        displayKey: "Alt + 5",
        keywords: "configuracoes settings api chaves mcp voz update",
        action: () => {
          closeCommandPalette();
          router.push("/settings");
        },
      },

      // Chat & Flow Actions
      {
        id: "chat-new",
        label: "Novo Chat",
        description: "Iniciar uma nova conversa do zero",
        category: "Chat & Criação",
        icon: PlusCircle,
        displayKey: "Ctrl + N",
        keywords: "novo chat conversa limpar criar",
        action: () => {
          closeCommandPalette();
          if (pathname.startsWith("/flow")) {
            triggerAction("chat.newChat");
          } else {
            router.push("/flow");
          }
        },
      },
      {
        id: "chat-focus-prompt",
        label: "Focar Caixa de Mensagem",
        description: "Ir diretamente para o campo de digitação do prompt",
        category: "Chat & Criação",
        icon: MessageSquare,
        displayKey: "Ctrl + J",
        keywords: "focar prompt digitar mensagem input",
        action: () => {
          closeCommandPalette();
          if (pathname.startsWith("/flow")) {
            triggerAction("chat.focusPrompt");
          } else {
            router.push("/flow");
          }
        },
      },

      // Video Actions
      {
        id: "video-play-pause",
        label: "Reproduzir / Pausar Vídeo",
        description: "Alternar o player da timeline de vídeo",
        category: "Edição de Vídeo",
        icon: Play,
        displayKey: "Espaço",
        keywords: "play pause reproduzir video player",
        action: () => {
          closeCommandPalette();
          triggerAction("video.playPause");
        },
      },
      {
        id: "video-split",
        label: "Cortar / Dividir Clipe",
        description: "Dividir o clipe na agulha da timeline de vídeo",
        category: "Edição de Vídeo",
        icon: Scissors,
        displayKey: "S",
        keywords: "cortar split dividir clipe tesoura",
        action: () => {
          closeCommandPalette();
          triggerAction("video.splitClip");
        },
      },

      // Help
      {
        id: "help-cheatsheet",
        label: "Guia de Atalhos de Teclado",
        description: "Ver todos os atalhos disponíveis no Kaoz.1",
        category: "Ajuda",
        icon: HelpCircle,
        displayKey: "?",
        keywords: "ajuda atalhos teclas cheatsheet help",
        action: () => {
          closeCommandPalette();
          setTimeout(() => {
            openCheatsheet();
          }, 100);
        },
      },
    ];
  }, [router, pathname, closeCommandPalette, openCheatsheet, triggerAction]);

  // Filter commands by search term
  const filteredCommands = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return commands;
    return commands.filter((cmd) => {
      const matchLabel = cmd.label.toLowerCase().includes(term);
      const matchDesc = cmd.description.toLowerCase().includes(term);
      const matchCat = cmd.category.toLowerCase().includes(term);
      const matchKey = cmd.keywords?.toLowerCase().includes(term) ?? false;
      return matchLabel || matchDesc || matchCat || matchKey;
    });
  }, [commands, query]);

  // Reset selected index when filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filteredCommands]);

  // Handle arrow navigation & enter in input
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filteredCommands.length > 0 && filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeCommandPalette();
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-active="true"]`) as HTMLElement | null;
    if (activeEl) {
      activeEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  return (
    <AnimatePresence>
      {isCommandPaletteOpen && (
        <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-md"
            onClick={closeCommandPalette}
          />

          {/* Palette Dialog */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-white/10 bg-[#12141A] shadow-2xl"
            style={{
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.08)",
            }}
          >
            {/* Search Header */}
            <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3.5">
              <Search className="h-5 w-5 text-[#8B92A1] shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Pesquisar telas, ações ou atalhos..."
                className="w-full bg-transparent text-sm text-white placeholder-[#8B92A1] outline-none border-none ring-0 focus:outline-none focus:ring-0"
              />
              <button
                type="button"
                onClick={closeCommandPalette}
                className="rounded-lg p-1 text-[#8B92A1] transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Results List */}
            <div
              ref={listRef}
              className="max-h-[380px] overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-white/10 hover:scrollbar-thumb-white/20"
            >
              {filteredCommands.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#8B92A1]">
                  Nenhum comando encontrado para &quot;{query}&quot;.
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredCommands.map((command, idx) => {
                    const Icon = command.icon;
                    const isSelected = idx === selectedIndex;
                    return (
                      <button
                        key={command.id}
                        type="button"
                        data-active={isSelected}
                        onClick={command.action}
                        onMouseEnter={() => setSelectedIndex(idx)}
                        className={`w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${
                          isSelected
                            ? "bg-[#7C6CF2]/20 text-white border border-[#7C6CF2]/30"
                            : "text-[#D5D8E0] hover:bg-white/[0.04] border border-transparent"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div
                            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                              isSelected
                                ? "bg-[#7C6CF2] text-white"
                                : "bg-white/[0.06] text-[#8B92A1]"
                            }`}
                          >
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-semibold tracking-wide text-white truncate">
                              {command.label}
                            </div>
                            <div className="text-[11px] text-[#8B92A1] truncate mt-0.5">
                              {command.description}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {command.displayKey && (
                            <KbdBadge keys={command.displayKey} size="sm" />
                          )}
                          {isSelected && (
                            <CornerDownLeft className="h-3.5 w-3.5 text-[#7C6CF2]" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer Hints */}
            <div className="flex items-center justify-between border-t border-white/10 bg-white/[0.02] px-4 py-2 text-[11px] text-[#8B92A1]">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <KbdBadge keys="↑" size="sm" />
                  <KbdBadge keys="↓" size="sm" />
                  <span>Navegar</span>
                </span>
                <span className="flex items-center gap-1">
                  <KbdBadge keys="Enter" size="sm" />
                  <span>Executar</span>
                </span>
              </div>
              <div className="flex items-center gap-1">
                <KbdBadge keys="Esc" size="sm" />
                <span>Fechar</span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
