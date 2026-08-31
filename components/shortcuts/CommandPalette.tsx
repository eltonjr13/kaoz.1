"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  Sparkles,
  Activity,
  Brain,
  UserCheck,
  Video,
  Settings,
  PlusCircle,
  MessageSquare,
  Scissors,
  Play,
  HelpCircle,
  CornerDownLeft,
  X,
  FastForward,
  Rewind,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Volume2,
  RotateCcw,
  WandSparkles,
  Bookmark,
  ChevronsLeft,
  ChevronsRight,
  Trash2,
  Maximize,
  Radio,
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
      {
        id: "nav-model-p",
        label: "Model P (Modelo Pessoal)",
        description: "Visualizar o que o agente compreende sobre você e suas preferências",
        category: "Navegação",
        icon: UserCheck,
        displayKey: "Alt + 6",
        keywords: "model p modelo pessoal preferencias fatos perfil identidade",
        action: () => {
          closeCommandPalette();
          router.push("/model-p");
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

      // Video Actions - Playback & Navigation
      {
        id: "video-play-pause",
        label: "Reproduzir / Pausar Vídeo",
        description: "Alternar reprodução do vídeo na timeline",
        category: "Edição de Vídeo",
        icon: Play,
        displayKey: "Espaço",
        keywords: "play pause reproduzir video player espaco tocar parar",
        action: () => {
          closeCommandPalette();
          triggerAction("video.playPause");
        },
      },
      {
        id: "video-shuttle-fwd",
        label: "Shuttle: Avançar / Acelerar",
        description: "Avançar ou acelerar a velocidade de reprodução (L)",
        category: "Edição de Vídeo",
        icon: FastForward,
        displayKey: "L",
        keywords: "shuttle avancar acelerar velocidade forward",
        action: () => {
          closeCommandPalette();
          triggerAction("video.shuttleForward");
        },
      },
      {
        id: "video-shuttle-rev",
        label: "Shuttle: Voltar / Reduzir",
        description: "Retroceder ou reduzir a velocidade de reprodução (J)",
        category: "Edição de Vídeo",
        icon: Rewind,
        displayKey: "J",
        keywords: "shuttle voltar retroceder reverse rewind velocidade",
        action: () => {
          closeCommandPalette();
          triggerAction("video.shuttleReverse");
        },
      },
      {
        id: "video-step-fwd",
        label: "Avançar 1 Frame",
        description: "Avançar exatamente 1 quadro na agulha da timeline",
        category: "Edição de Vídeo",
        icon: FastForward,
        displayKey: "→",
        keywords: "frame quadro avancar proximo frame step forward seta direita",
        action: () => {
          closeCommandPalette();
          triggerAction("video.stepForward");
        },
      },
      {
        id: "video-step-back",
        label: "Voltar 1 Frame",
        description: "Recuar exatamente 1 quadro na agulha da timeline",
        category: "Edição de Vídeo",
        icon: Rewind,
        displayKey: "←",
        keywords: "frame quadro voltar recuar anterior frame step backward seta esquerda",
        action: () => {
          closeCommandPalette();
          triggerAction("video.stepBackward");
        },
      },
      {
        id: "video-jump-start",
        label: "Ir para Início da Timeline",
        description: "Mover a agulha para o início absoluto do vídeo",
        category: "Edição de Vídeo",
        icon: ChevronsLeft,
        displayKey: "Home / ↑",
        keywords: "inicio comeco timeline primeiro frame home",
        action: () => {
          closeCommandPalette();
          triggerAction("video.jumpStart");
        },
      },
      {
        id: "video-jump-end",
        label: "Ir para Fim da Timeline",
        description: "Mover a agulha para o fim absoluto do vídeo",
        category: "Edição de Vídeo",
        icon: ChevronsRight,
        displayKey: "End / ↓",
        keywords: "fim final timeline ultimo frame end",
        action: () => {
          closeCommandPalette();
          triggerAction("video.jumpEnd");
        },
      },
      {
        id: "video-prev-cut",
        label: "Corte / Clipe Anterior",
        description: "Pular para o ponto de corte ou limite anterior",
        category: "Edição de Vídeo",
        icon: ChevronsLeft,
        displayKey: "[ / A",
        keywords: "pular corte anterior clipe transicao esquerda voltar corte",
        action: () => {
          closeCommandPalette();
          triggerAction("video.prevCut");
        },
      },
      {
        id: "video-next-cut",
        label: "Próximo Corte / Clipe",
        description: "Pular para o próximo ponto de corte ou limite",
        category: "Edição de Vídeo",
        icon: ChevronsRight,
        displayKey: "] / D",
        keywords: "pular corte proximo clipe transicao avancar corte",
        action: () => {
          closeCommandPalette();
          triggerAction("video.nextCut");
        },
      },

      // Video Actions - Cutting & Editing
      {
        id: "video-split",
        label: "Cortar / Dividir Clipe (Razor)",
        description: "Dividir o clipe ativo na posição atual da agulha",
        category: "Edição de Vídeo",
        icon: Scissors,
        displayKey: "S / C",
        keywords: "cortar split dividir clipe tesoura razor fatiar c s",
        action: () => {
          closeCommandPalette();
          triggerAction("video.splitClip");
        },
      },
      {
        id: "video-mark-in",
        label: "Marcar Ponto de Entrada [In]",
        description: "Definir início da área selecionada na timeline",
        category: "Edição de Vídeo",
        icon: Bookmark,
        displayKey: "I",
        keywords: "marcar in entrada ponto inicio selecao",
        action: () => {
          closeCommandPalette();
          triggerAction("video.markIn");
        },
      },
      {
        id: "video-mark-out",
        label: "Marcar Ponto de Saída [Out]",
        description: "Definir fim da área selecionada na timeline",
        category: "Edição de Vídeo",
        icon: Bookmark,
        displayKey: "O",
        keywords: "marcar out saida ponto fim selecao",
        action: () => {
          closeCommandPalette();
          triggerAction("video.markOut");
        },
      },
      {
        id: "video-clear-in-out",
        label: "Limpar Pontos In / Out",
        description: "Remover os marcadores de entrada e saída",
        category: "Edição de Vídeo",
        icon: X,
        displayKey: "Alt + X / X",
        keywords: "limpar in out desselecionar desmarcar pontos",
        action: () => {
          closeCommandPalette();
          triggerAction("video.clearInOut");
        },
      },
      {
        id: "video-trim-start",
        label: "Ripple Trim: Início até Agulha",
        description: "Aparar e remover do início do clipe até a agulha (Q)",
        category: "Edição de Vídeo",
        icon: Scissors,
        displayKey: "Q",
        keywords: "trim aparar inicio corte ripple q",
        action: () => {
          closeCommandPalette();
          triggerAction("video.trimStart");
        },
      },
      {
        id: "video-trim-end",
        label: "Ripple Trim: Agulha até Fim",
        description: "Aparar e remover da agulha até o fim do clipe (W)",
        category: "Edição de Vídeo",
        icon: Scissors,
        displayKey: "W",
        keywords: "trim aparar fim corte ripple w",
        action: () => {
          closeCommandPalette();
          triggerAction("video.trimEnd");
        },
      },
      {
        id: "video-delete-selected",
        label: "Excluir Intervalo / Clipe Selecionado",
        description: "Remover trecho In/Out ou o clipe atualmente selecionado",
        category: "Edição de Vídeo",
        icon: Trash2,
        displayKey: "Del / Backspace",
        keywords: "excluir deletar remover clipe selecao in out lixeira",
        action: () => {
          closeCommandPalette();
          triggerAction("video.deleteSelected");
        },
      },
      {
        id: "video-undo-cut",
        label: "Desfazer Último Corte",
        description: "Restaurar o último trecho cortado na timeline",
        category: "Edição de Vídeo",
        icon: RotateCcw,
        displayKey: "Ctrl + Z",
        keywords: "desfazer corte restaurar undo reverter ctrl z",
        action: () => {
          closeCommandPalette();
          triggerAction("video.undoCut");
        },
      },
      {
        id: "video-autocut-silences",
        label: "Auto-Corte de Silêncios por IA",
        description: "Abrir o detector inteligente de silêncios e pausas",
        category: "Edição de Vídeo",
        icon: WandSparkles,
        displayKey: "Ctrl + Shift + S",
        keywords: "silencio silêncios auto corte remover pausas voz ia transcricao",
        action: () => {
          closeCommandPalette();
          triggerAction("video.autoCutSilences");
        },
      },
      {
        id: "video-add-event",
        label: "Adicionar Evento / Marcador",
        description: "Inserir evento de edição ou zoom no ponto atual da agulha",
        category: "Edição de Vídeo",
        icon: Bookmark,
        displayKey: "E / N",
        keywords: "adicionar evento marcador zoom texto transicao efeito",
        action: () => {
          closeCommandPalette();
          triggerAction("video.addEvent");
        },
      },

      // Video Actions - Timeline, Audio & View
      {
        id: "video-zoom-in",
        label: "Aumentar Zoom da Timeline",
        description: "Ampliar a escala de visualização das trilhas",
        category: "Edição de Vídeo",
        icon: ZoomIn,
        displayKey: "+",
        keywords: "zoom in aproximar ampliar escala timeline mais",
        action: () => {
          closeCommandPalette();
          triggerAction("video.zoomIn");
        },
      },
      {
        id: "video-zoom-out",
        label: "Diminuir Zoom da Timeline",
        description: "Reduzir a escala de visualização das trilhas",
        category: "Edição de Vídeo",
        icon: ZoomOut,
        displayKey: "-",
        keywords: "zoom out afastar reduzir escala timeline menos",
        action: () => {
          closeCommandPalette();
          triggerAction("video.zoomOut");
        },
      },
      {
        id: "video-fit-timeline",
        label: "Ajustar Zoom / Resetar Escala",
        description: "Enquadrar a timeline completa na largura da janela",
        category: "Edição de Vídeo",
        icon: Maximize,
        displayKey: "Shift + Z / 0",
        keywords: "fit timeline ajustar escala 100% resetar zoom enquadrar",
        action: () => {
          closeCommandPalette();
          triggerAction("video.fitTimeline");
        },
      },
      {
        id: "video-toggle-mute",
        label: "Silenciar / Ativar Áudio",
        description: "Alternar o som do player de vídeo",
        category: "Edição de Vídeo",
        icon: Volume2,
        displayKey: "M",
        keywords: "mute desmutar audio som volume silenciar som",
        action: () => {
          closeCommandPalette();
          triggerAction("video.toggleMute");
        },
      },
      {
        id: "video-toggle-fullscreen",
        label: "Alternar Tela Cheia",
        description: "Expandir o player de vídeo para modo tela cheia",
        category: "Edição de Vídeo",
        icon: Maximize2,
        displayKey: "F",
        keywords: "fullscreen tela cheia maximizar player f",
        action: () => {
          closeCommandPalette();
          triggerAction("video.toggleFullscreen");
        },
      },
      {
        id: "video-toggle-cut-preview",
        label: "Prévia com Pulo de Cortes",
        description: "Alternar se o player pula trechos cortados em tempo real",
        category: "Edição de Vídeo",
        icon: Radio,
        displayKey: "\\ / P",
        keywords: "previa pulo cortes live cut preview pular",
        action: () => {
          closeCommandPalette();
          triggerAction("video.toggleCutPreview");
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
