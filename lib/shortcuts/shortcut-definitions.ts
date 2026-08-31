export type ShortcutCategory = "global" | "navigation" | "chat" | "video";

export type ShortcutActionId =
  | "global.commandPalette"
  | "global.cheatsheet"
  | "global.toggleSidebar"
  | "global.closeModal"
  | "nav.flow"
  | "nav.supervision"
  | "nav.cortex"
  | "nav.modelP"
  | "nav.video"
  | "nav.settings"
  | "chat.newChat"
  | "chat.focusPrompt"
  | "video.playPause"
  | "video.shuttleReverse"
  | "video.shuttlePause"
  | "video.shuttleForward"
  | "video.stepBackward"
  | "video.stepForward"
  | "video.stepBackwardSecond"
  | "video.stepForwardSecond"
  | "video.jumpStart"
  | "video.jumpEnd"
  | "video.prevCut"
  | "video.nextCut"
  | "video.splitClip"
  | "video.markIn"
  | "video.markOut"
  | "video.clearInOut"
  | "video.trimStart"
  | "video.trimEnd"
  | "video.deleteSelected"
  | "video.undoCut"
  | "video.autoCutSilences"
  | "video.addEvent"
  | "video.zoomIn"
  | "video.zoomOut"
  | "video.fitTimeline"
  | "video.toggleMute"
  | "video.toggleFullscreen"
  | "video.toggleCutPreview";

export interface ShortcutDefinition {
  id: ShortcutActionId;
  label: string;
  description: string;
  category: ShortcutCategory;
  keys: string[]; // e.g. ["ctrl+k", "meta+k"]
  displayKey: string; // e.g. "Ctrl + K" or "Alt + 1"
  macDisplayKey?: string; // e.g. "⌘ + K"
  allowInInput?: boolean; // whether hotkey triggers when typing in input/textarea (default: false)
  href?: string; // for navigation shortcuts
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  // Global
  {
    id: "global.commandPalette",
    label: "Command Palette",
    description: "Pesquisar ou executar comandos rápidos",
    category: "global",
    keys: ["ctrl+k", "meta+k"],
    displayKey: "Ctrl + K",
    macDisplayKey: "⌘K",
    allowInInput: true,
  },
  {
    id: "global.cheatsheet",
    label: "Guia de Atalhos",
    description: "Abrir o mapa completo de teclas de atalho",
    category: "global",
    keys: ["?", "ctrl+/", "meta+/"],
    displayKey: "Ctrl + /",
    macDisplayKey: "⌘/",
    allowInInput: false,
  },
  {
    id: "global.toggleSidebar",
    label: "Alternar Barra Lateral",
    description: "Recolher ou expandir a barra de navegação",
    category: "global",
    keys: ["ctrl+b", "meta+b"],
    displayKey: "Ctrl + B",
    macDisplayKey: "⌘B",
    allowInInput: false,
  },
  {
    id: "global.closeModal",
    label: "Fechar Janela / Modal",
    description: "Fechar janelas suspensas, paleta ou desfocar elementos",
    category: "global",
    keys: ["escape"],
    displayKey: "Esc",
    allowInInput: true,
  },

  // Navegação
  {
    id: "nav.flow",
    label: "Ir para Kaoz.1 (Flow)",
    description: "Abrir a tela principal de chat, agentes e criação",
    category: "navigation",
    keys: ["alt+1"],
    displayKey: "Alt + 1",
    href: "/flow",
    allowInInput: false,
  },
  {
    id: "nav.supervision",
    label: "Ir para Supervisor",
    description: "Acompanhar execuções, orquestração e agentes em tempo real",
    category: "navigation",
    keys: ["alt+2"],
    displayKey: "Alt + 2",
    href: "/supervision",
    allowInInput: false,
  },
  {
    id: "nav.cortex",
    label: "Ir para Córtex",
    description: "Explorar banco de memórias, identidades e conexões neurais",
    category: "navigation",
    keys: ["alt+3"],
    displayKey: "Alt + 3",
    href: "/cortex",
    allowInInput: false,
  },
  {
    id: "nav.video",
    label: "Ir para Edição de Vídeo",
    description: "Abrir o estúdio de produção e corte de vídeo",
    category: "navigation",
    keys: ["alt+4"],
    displayKey: "Alt + 4",
    href: "/video",
    allowInInput: false,
  },
  {
    id: "nav.settings",
    label: "Ir para Configurações",
    description: "Ajustar preferências, modelos de IA, MCPs e atualizações",
    category: "navigation",
    keys: ["alt+5"],
    displayKey: "Alt + 5",
    href: "/settings",
    allowInInput: false,
  },
  {
    id: "nav.modelP",
    label: "Ir para Model P",
    description: "Visualizar o modelo cognitivo e preferências pessoais do usuário",
    category: "navigation",
    keys: ["alt+6"],
    displayKey: "Alt + 6",
    href: "/model-p",
    allowInInput: false,
  },

  // Chat / Flow
  {
    id: "chat.newChat",
    label: "Novo Chat",
    description: "Iniciar uma nova sessão de conversa limpa",
    category: "chat",
    keys: ["ctrl+n", "meta+n"],
    displayKey: "Ctrl + N",
    macDisplayKey: "⌘N",
    allowInInput: true,
  },
  {
    id: "chat.focusPrompt",
    label: "Focar Caixa de Mensagem",
    description: "Mover cursor diretamente para a caixa de digitação",
    category: "chat",
    keys: ["ctrl+j", "meta+j"],
    displayKey: "Ctrl + J",
    macDisplayKey: "⌘J",
    allowInInput: false,
  },

  // Vídeo - Reprodução & Navegação
  {
    id: "video.playPause",
    label: "Reproduzir / Pausar",
    description: "Alternar reprodução do vídeo na timeline",
    category: "video",
    keys: ["space"],
    displayKey: "Espaço",
    allowInInput: false,
  },
  {
    id: "video.shuttleReverse",
    label: "Shuttle: Voltar / Reduzir",
    description: "Retroceder ou reduzir a velocidade de reprodução",
    category: "video",
    keys: ["j"],
    displayKey: "J",
    allowInInput: false,
  },
  {
    id: "video.shuttlePause",
    label: "Shuttle: Pausar",
    description: "Pausar a reprodução do vídeo imediatamente",
    category: "video",
    keys: ["k"],
    displayKey: "K",
    allowInInput: false,
  },
  {
    id: "video.shuttleForward",
    label: "Shuttle: Avançar / Acelerar",
    description: "Avançar ou acelerar a velocidade de reprodução",
    category: "video",
    keys: ["l"],
    displayKey: "L",
    allowInInput: false,
  },
  {
    id: "video.stepBackward",
    label: "Voltar 1 Frame",
    description: "Recuar exatamente 1 quadro na agulha da timeline",
    category: "video",
    keys: ["arrowleft"],
    displayKey: "←",
    allowInInput: false,
  },
  {
    id: "video.stepForward",
    label: "Avançar 1 Frame",
    description: "Avançar exatamente 1 quadro na agulha da timeline",
    category: "video",
    keys: ["arrowright"],
    displayKey: "→",
    allowInInput: false,
  },
  {
    id: "video.stepBackwardSecond",
    label: "Voltar 1 Segundo",
    description: "Recuar 1 segundo na agulha da timeline",
    category: "video",
    keys: ["shift+arrowleft"],
    displayKey: "Shift + ←",
    allowInInput: false,
  },
  {
    id: "video.stepForwardSecond",
    label: "Avançar 1 Segundo",
    description: "Avançar 1 segundo na agulha da timeline",
    category: "video",
    keys: ["shift+arrowright"],
    displayKey: "Shift + →",
    allowInInput: false,
  },
  {
    id: "video.jumpStart",
    label: "Ir para Início da Timeline",
    description: "Mover a agulha para o frame inicial do vídeo (0:00)",
    category: "video",
    keys: ["home", "arrowup"],
    displayKey: "Home / ↑",
    allowInInput: false,
  },
  {
    id: "video.jumpEnd",
    label: "Ir para Fim da Timeline",
    description: "Mover a agulha para o frame final do vídeo",
    category: "video",
    keys: ["end", "arrowdown"],
    displayKey: "End / ↓",
    allowInInput: false,
  },
  {
    id: "video.prevCut",
    label: "Corte / Clipe Anterior",
    description: "Pular para o ponto de corte ou limite de clipe anterior",
    category: "video",
    keys: ["[", "a"],
    displayKey: "[ / A",
    allowInInput: false,
  },
  {
    id: "video.nextCut",
    label: "Próximo Corte / Clipe",
    description: "Pular para o próximo ponto de corte ou limite de clipe",
    category: "video",
    keys: ["]", "d"],
    displayKey: "] / D",
    allowInInput: false,
  },

  // Vídeo - Corte & Edição
  {
    id: "video.splitClip",
    label: "Cortar / Dividir Clipe (Razor)",
    description: "Realizar corte na posição atual da agulha da timeline",
    category: "video",
    keys: ["s", "c"],
    displayKey: "S / C",
    allowInInput: false,
  },
  {
    id: "video.markIn",
    label: "Marcar Ponto de Entrada [In]",
    description: "Definir o início do intervalo selecionado na agulha",
    category: "video",
    keys: ["i"],
    displayKey: "I",
    allowInInput: false,
  },
  {
    id: "video.markOut",
    label: "Marcar Ponto de Saída [Out]",
    description: "Definir o fim do intervalo selecionado na agulha",
    category: "video",
    keys: ["o"],
    displayKey: "O",
    allowInInput: false,
  },
  {
    id: "video.clearInOut",
    label: "Limpar Pontos In / Out",
    description: "Remover os marcadores de entrada e saída da timeline",
    category: "video",
    keys: ["alt+x", "x"],
    displayKey: "Alt + X / X",
    allowInInput: false,
  },
  {
    id: "video.trimStart",
    label: "Ripple Trim: Início até Agulha",
    description: "Aparar do início do clipe ativo até a posição da agulha",
    category: "video",
    keys: ["q"],
    displayKey: "Q",
    allowInInput: false,
  },
  {
    id: "video.trimEnd",
    label: "Ripple Trim: Agulha até Fim",
    description: "Aparar da posição da agulha até o fim do clipe ativo",
    category: "video",
    keys: ["w"],
    displayKey: "W",
    allowInInput: false,
  },
  {
    id: "video.deleteSelected",
    label: "Excluir Intervalo / Clipe Selecionado",
    description: "Excluir o trecho entre In/Out ou o clipe selecionado",
    category: "video",
    keys: ["delete", "backspace"],
    displayKey: "Del / Backspace",
    allowInInput: false,
  },
  {
    id: "video.undoCut",
    label: "Desfazer Último Corte",
    description: "Reverter a última ação de corte realizada na timeline",
    category: "video",
    keys: ["ctrl+z", "meta+z"],
    displayKey: "Ctrl + Z",
    macDisplayKey: "⌘Z",
    allowInInput: false,
  },
  {
    id: "video.autoCutSilences",
    label: "Auto-Corte de Silêncios por IA",
    description: "Abrir detecção e remoção inteligente de pausas e silêncios",
    category: "video",
    keys: ["ctrl+shift+s", "alt+s"],
    displayKey: "Ctrl + Shift + S",
    macDisplayKey: "⌘⇧S",
    allowInInput: false,
  },
  {
    id: "video.addEvent",
    label: "Adicionar Evento / Marcador",
    description: "Inserir evento de edição inteligente ou zoom na agulha",
    category: "video",
    keys: ["e", "n"],
    displayKey: "E / N",
    allowInInput: false,
  },

  // Vídeo - Timeline, Áudio & Visualização
  {
    id: "video.zoomIn",
    label: "Aumentar Zoom da Timeline",
    description: "Ampliar a escala de visualização da trilha de vídeo",
    category: "video",
    keys: ["+", "="],
    displayKey: "+",
    allowInInput: false,
  },
  {
    id: "video.zoomOut",
    label: "Diminuir Zoom da Timeline",
    description: "Reduzir a escala de visualização da trilha de vídeo",
    category: "video",
    keys: ["-"],
    displayKey: "-",
    allowInInput: false,
  },
  {
    id: "video.fitTimeline",
    label: "Ajustar Zoom / Resetar Escala",
    description: "Enquadrar a timeline inteira na largura da tela (100%)",
    category: "video",
    keys: ["shift+z", "0"],
    displayKey: "Shift + Z / 0",
    allowInInput: false,
  },
  {
    id: "video.toggleMute",
    label: "Silenciar / Ativar Áudio",
    description: "Alternar o som do player de vídeo",
    category: "video",
    keys: ["m"],
    displayKey: "M",
    allowInInput: false,
  },
  {
    id: "video.toggleFullscreen",
    label: "Alternar Tela Cheia",
    description: "Expandir o player de vídeo para modo tela cheia",
    category: "video",
    keys: ["f"],
    displayKey: "F",
    allowInInput: false,
  },
  {
    id: "video.toggleCutPreview",
    label: "Prévia com Pulo de Cortes",
    description: "Alternar o pulo automático de trechos cortados na reprodução",
    category: "video",
    keys: ["\\", "p"],
    displayKey: "\\ / P",
    allowInInput: false,
  },
];

export const SHORTCUT_CATEGORIES: { id: ShortcutCategory; label: string }[] = [
  { id: "global", label: "Geral do Sistema" },
  { id: "navigation", label: "Navegação Rápida" },
  { id: "chat", label: "Chat & Criação (Flow)" },
  { id: "video", label: "Edição de Vídeo" },
];

/**
 * Normalizes a key combo string (e.g. "ctrl+k", "Alt+1", "Escape") into a standardized format.
 */
export function normalizeKeyCombo(combo: string): string {
  const parts = combo.toLowerCase().split("+").map((p) => p.trim());
  const modifiers = new Set<string>();
  let primaryKey = "";

  for (const part of parts) {
    if (part === "ctrl" || part === "control") modifiers.add("ctrl");
    else if (part === "cmd" || part === "command" || part === "meta") modifiers.add("meta");
    else if (part === "alt" || part === "opt" || part === "option") modifiers.add("alt");
    else if (part === "shift") modifiers.add("shift");
    else primaryKey = part;
  }

  const sortedMods = Array.from(modifiers).sort();
  return sortedMods.length > 0 ? `${sortedMods.join("+")}+${primaryKey}` : primaryKey;
}

/**
 * Converts a native KeyboardEvent to a normalized combo string.
 */
export function eventToKeyCombo(event: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.metaKey) modifiers.push("meta");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey && event.key !== "Shift" && event.key !== "?") modifiers.push("shift");

  let key = event.key.toLowerCase();
  if (key === "escape") key = "escape";
  else if (key === " ") key = "space";
  else if (key === "enter") key = "enter";

  // If pressing '?' with shift, key is already '?'
  if (key === "?") {
    // Treat '?' as a direct single key trigger or shift+?
    return modifiers.filter(m => m !== "shift").length > 0
      ? `${modifiers.filter(m => m !== "shift").sort().join("+")}+?`
      : "?";
  }

  const sortedMods = modifiers.sort();
  return sortedMods.length > 0 ? `${sortedMods.join("+")}+${key}` : key;
}

/**
 * Checks whether an event target is an active text input, textarea or contenteditable element.
 */
export function isEditableElement(target: EventTarget | null): boolean {
  if (!target) return false;
  if (typeof HTMLElement !== "undefined" && !(target instanceof HTMLElement)) return false;
  const element = target as unknown as {
    tagName?: string;
    type?: string;
    isContentEditable?: boolean;
    getAttribute?: (name: string) => string | null;
  };
  const tagName = element.tagName ? element.tagName.toUpperCase() : "";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    const inputType = element.type?.toLowerCase();
    if (inputType === "checkbox" || inputType === "radio" || inputType === "button" || inputType === "submit") {
      return false;
    }
    return true;
  }
  return (
    Boolean(element.isContentEditable) ||
    (typeof element.getAttribute === "function" && element.getAttribute("contenteditable") === "true")
  );
}
