export type ShortcutCategory = "global" | "navigation" | "chat" | "video";

export type ShortcutActionId =
  | "global.commandPalette"
  | "global.cheatsheet"
  | "global.toggleSidebar"
  | "global.closeModal"
  | "nav.flow"
  | "nav.supervision"
  | "nav.cortex"
  | "nav.video"
  | "nav.settings"
  | "chat.newChat"
  | "chat.focusPrompt"
  | "video.playPause"
  | "video.splitClip"
  | "video.zoomIn"
  | "video.zoomOut";

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

  // Vídeo
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
    id: "video.splitClip",
    label: "Cortar / Dividir Clipe",
    description: "Realizar corte na posição atual do cursor da timeline",
    category: "video",
    keys: ["s"],
    displayKey: "S",
    allowInInput: false,
  },
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
  if (!target || !(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    const inputType = (target as HTMLInputElement).type?.toLowerCase();
    if (inputType === "checkbox" || inputType === "radio" || inputType === "button" || inputType === "submit") {
      return false;
    }
    return true;
  }
  return target.isContentEditable || target.getAttribute("contenteditable") === "true";
}
