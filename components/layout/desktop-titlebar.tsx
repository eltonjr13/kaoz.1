"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Copy,
  Download,
  LoaderCircle,
  Minus,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

const COMMANDS = [
  { href: "/flow", label: "Chat", description: "Conversar e criar com o Kaoz.1", keywords: "inicio conversa agente" },
  { href: "/supervision", label: "Supervisor", description: "Acompanhar agentes e execuções", keywords: "atividade tarefas agentes" },
  { href: "/cortex", label: "Córtex", description: "Explorar memória e conhecimento", keywords: "memoria conhecimento" },
  { href: "/video", label: "Edição de vídeo", description: "Abrir o ambiente de produção", keywords: "davinci render producao" },
  { href: "/settings", label: "Configurações", description: "Preferências, modelos e integrações", keywords: "ajustes update atualizacao" },
];

const INITIAL_NAVIGATION_STATE: Kaoz1NavigationState = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
};

function contextForPath(pathname: string) {
  const command = COMMANDS.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  return command?.label || "Workspace";
}

function updateLabel(status: Kaoz1UpdateStatus) {
  if (status.state === "available") return `Versão ${status.version || "nova"} disponível`;
  if (status.state === "downloading") return `Baixando atualização${typeof status.progress === "number" ? `: ${status.progress}%` : ""}`;
  if (status.state === "downloaded") return "Atualização pronta para instalar";
  if (status.state === "installing") return "Instalando atualização";
  if (status.state === "error") return "Falha ao verificar atualização";
  return "";
}

function isVisibleUpdate(status: Kaoz1UpdateStatus) {
  return ["available", "downloading", "downloaded", "installing", "error"].includes(status.state);
}

type DesktopBridge = NonNullable<Window["kaoz1Desktop"]>;

function NavigationControls({ bridge, navigation }: { bridge: DesktopBridge; navigation: Kaoz1NavigationState }) {
  return (
    <nav className="kaoz1-desktop-titlebar__navigation" aria-label="Navegação">
      <button type="button" disabled={!navigation.canGoBack} aria-label="Voltar" title="Voltar" onClick={() => void bridge.goBack()}>
        <ArrowLeft size={14} aria-hidden="true" />
      </button>
      <button type="button" disabled={!navigation.canGoForward} aria-label="Avançar" title="Avançar" onClick={() => void bridge.goForward()}>
        <ArrowRight size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label="Atualizar" title="Atualizar" onClick={() => void bridge.reload()}>
        <RefreshCw size={13} className={navigation.isLoading ? "kaoz1-desktop-titlebar__spin" : undefined} aria-hidden="true" />
      </button>
    </nav>
  );
}

function UpdateIndicator({ status, onOpenSettings }: { status: Kaoz1UpdateStatus; onOpenSettings: () => void }) {
  if (!isVisibleUpdate(status)) return null;
  const message = updateLabel(status);
  const busy = ["downloading", "installing"].includes(status.state);

  return (
    <button
      type="button"
      className={`kaoz1-desktop-titlebar__update kaoz1-desktop-titlebar__update--${status.state}`}
      aria-label={message}
      title={`${message}. Abrir configurações.`}
      onClick={onOpenSettings}
    >
      {busy ? <LoaderCircle size={13} className="kaoz1-desktop-titlebar__spin" aria-hidden="true" /> : status.state === "error" ? <AlertCircle size={13} aria-hidden="true" /> : <Download size={13} aria-hidden="true" />}
      {status.state === "downloading" && typeof status.progress === "number" && <span>{status.progress}%</span>}
    </button>
  );
}

function WindowControls({ bridge, maximized, onToggleMaximize }: { bridge: DesktopBridge; maximized: boolean; onToggleMaximize: () => void }) {
  return (
    <div className="kaoz1-desktop-titlebar__controls">
      <button type="button" aria-label="Minimizar" title="Minimizar" onClick={() => void bridge.minimize()}>
        <Minus size={15} aria-hidden="true" />
      </button>
      <button type="button" aria-label={maximized ? "Restaurar" : "Maximizar"} title={maximized ? "Restaurar" : "Maximizar"} onClick={onToggleMaximize}>
        {maximized ? <Copy size={13} aria-hidden="true" /> : <Square size={13} aria-hidden="true" />}
      </button>
      <button type="button" className="kaoz1-desktop-titlebar__close" aria-label="Fechar" title="Fechar" onClick={() => void bridge.close()}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

function CommandPalette({
  open,
  query,
  onQueryChange,
  onClose,
  onOpenCommand,
}: {
  open: boolean;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onOpenCommand: (href: string) => void;
}) {
  const filteredCommands = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return COMMANDS;
    return COMMANDS.filter((command) =>
      `${command.label} ${command.description} ${command.keywords}`.toLocaleLowerCase("pt-BR").includes(normalized),
    );
  }, [query]);

  if (!open) return null;

  return (
    <>
      <button type="button" className="kaoz1-desktop-titlebar__command-backdrop" aria-label="Fechar comandos rápidos" onClick={onClose} />
      <section className="kaoz1-desktop-titlebar__command-palette" role="dialog" aria-modal="true" aria-label="Comandos rápidos">
        <label>
          <Search size={15} aria-hidden="true" />
          <input autoFocus value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Pesquisar uma área do Kaoz.1" />
          <kbd>Esc</kbd>
        </label>
        <div className="kaoz1-desktop-titlebar__command-results">
          {filteredCommands.map((command) => (
            <button type="button" key={command.href} onClick={() => onOpenCommand(command.href)}>
              <span>{command.label}</span>
              <small>{command.description}</small>
            </button>
          ))}
          {filteredCommands.length === 0 && <p>Nenhum comando encontrado.</p>}
        </div>
      </section>
    </>
  );
}

export function DesktopTitlebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [desktop, setDesktop] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [navigation, setNavigation] = useState(INITIAL_NAVIGATION_STATE);
  const [updateStatus, setUpdateStatus] = useState<Kaoz1UpdateStatus>({ state: "idle" });
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const bridge = window.kaoz1Desktop;
    if (!bridge) return;

    document.documentElement.dataset.kaoz1Desktop = "true";
    setDesktop(true);
    void bridge.isMaximized().then(setMaximized);
    void bridge.getNavigationState().then(setNavigation);
    void bridge.getUpdateStatus().then(setUpdateStatus);
    const stopWindowListener = bridge.onMaximizedChanged(setMaximized);
    const stopNavigationListener = bridge.onNavigationStateChanged(setNavigation);
    const stopUpdateListener = bridge.onUpdateStatus(setUpdateStatus);
    return () => {
      stopWindowListener();
      stopNavigationListener();
      stopUpdateListener();
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandsOpen((open) => !open);
      } else if (event.key === "Escape") {
        setCommandsOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!desktop) return null;

  const bridge = window.kaoz1Desktop;
  if (!bridge) return null;

  const openCommand = (href: string) => {
    setCommandsOpen(false);
    setQuery("");
    router.push(href);
  };
  const toggleMaximize = () => void bridge.toggleMaximize();
  const context = contextForPath(pathname);

  return (
    <header className="kaoz1-desktop-titlebar" aria-label="Barra do aplicativo Kaoz.1">
      <div className="kaoz1-desktop-titlebar__brand" onDoubleClick={toggleMaximize}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="" className="h-4 w-4 rounded-sm object-cover" aria-hidden="true" />
        <span>Kaoz.1</span>
      </div>

      <NavigationControls bridge={bridge} navigation={navigation} />

      <div className="kaoz1-desktop-titlebar__context" title={context} onDoubleClick={toggleMaximize}>
        <span>{context}</span>
      </div>

      <button
        type="button"
        className="kaoz1-desktop-titlebar__command-trigger"
        aria-haspopup="dialog"
        aria-expanded={commandsOpen}
        onClick={() => setCommandsOpen(true)}
      >
        <Search size={12} aria-hidden="true" />
        <span>Pesquisar ou executar…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="kaoz1-desktop-titlebar__drag-region" aria-hidden="true" onDoubleClick={toggleMaximize} />

      <UpdateIndicator status={updateStatus} onOpenSettings={() => router.push("/settings")} />
      <WindowControls bridge={bridge} maximized={maximized} onToggleMaximize={toggleMaximize} />
      <CommandPalette open={commandsOpen} query={query} onQueryChange={setQuery} onClose={() => setCommandsOpen(false)} onOpenCommand={openCommand} />
    </header>
  );
}
