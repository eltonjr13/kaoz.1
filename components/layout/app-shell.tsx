"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  Activity,
  ChevronLeft,
  ChevronRight,
  Menu,
  Settings,
  Sparkles,
  Video,
  X,
  Brain,
  Keyboard,
  Search,
  UserCheck,
  Pencil,
} from "lucide-react";
import { useHotkey } from "@/lib/shortcuts/use-hotkeys";
import { useShortcuts } from "@/lib/shortcuts/ShortcutContext";
import { KbdBadge } from "@/components/shortcuts/KbdBadge";

const navItems = [
  { href: "/flow", label: "Kaoz.1", icon: Sparkles, shortcut: "Alt+1" },
  { href: "/supervision", label: "Supervisor", icon: Activity, shortcut: "Alt+2" },
  { href: "/cortex", label: "Córtex", icon: Brain, shortcut: "Alt+3" },
  { href: "/sketch", label: "Sketch", icon: Pencil, shortcut: "Alt+7" },
  { href: "/model-p", label: "Model P", icon: UserCheck, shortcut: "Alt+6" },
  { href: "/video", label: "Edição de vídeo", icon: Video, shortcut: "Alt+4" },
  { href: "/settings", label: "Settings", icon: Settings, shortcut: "Alt+5" },
];

function SidebarHeader({
  workspaceLabel,
  collapsed,
  onCloseMobile,
  onToggleCollapse,
}: {
  workspaceLabel: string;
  collapsed: boolean;
  onCloseMobile: () => void;
  onToggleCollapse: () => void;
}) {
  return (
    <div className={`mb-3 flex items-center gap-2 ${collapsed ? "md:flex-col" : ""}`}>
      <Link
        href="/flow"
        className={`group flex min-w-0 flex-1 items-center gap-3 rounded-[20px] px-3 py-2.5 no-underline hover:no-underline focus:no-underline active:no-underline outline-none focus:outline-none focus-visible:outline-none transition-all duration-200 hover:bg-[var(--panel-strong)] ${
          collapsed ? "md:flex-none md:justify-center md:px-0" : ""
        }`}
        onClick={onCloseMobile}
        title={collapsed ? "Kaoz.1" : undefined}
        style={{ textDecoration: "none" }}
      >
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[12px]"
          style={{ border: "1px solid var(--line)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.png" alt="Kaoz.1" className="h-full w-full object-cover" />
        </span>
        <span
          className={`min-w-0 overflow-hidden transition-all duration-200 ${
            collapsed ? "md:w-0 md:opacity-0" : "w-auto opacity-100"
          }`}
        >
          <span className="block text-[13px] font-semibold leading-tight text-[var(--text)] tracking-[-0.01em]">
            Kaoz.1
          </span>
          <span className="block truncate text-[11px] font-normal text-[var(--muted)] mt-0.5">
            {workspaceLabel}
          </span>
        </span>
      </Link>

      <button
        type="button"
        onClick={onToggleCollapse}
        className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)] outline-none focus:outline-none focus-visible:outline-none md:flex"
        style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
        aria-label={collapsed ? "Expandir menu lateral (Ctrl+B)" : "Retrair menu lateral (Ctrl+B)"}
        title={collapsed ? "Expandir menu (Ctrl+B)" : "Retrair menu (Ctrl+B)"}
      >
        {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
      </button>
    </div>
  );
}

function SidebarNav({
  pathname,
  collapsed,
  onCloseMobile,
}: {
  pathname: string;
  collapsed: boolean;
  onCloseMobile: () => void;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5" aria-label="Navegação lateral">
      {navItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            href={item.href}
            key={item.label}
            onClick={onCloseMobile}
            aria-current={isActive ? "page" : undefined}
            data-active={isActive}
            className={`kaoz-signal-nav-item group flex h-10 items-center justify-between px-3 text-[13px] font-medium no-underline hover:no-underline focus:no-underline active:no-underline outline-none focus:outline-none focus-visible:outline-none transition-all duration-200 hover:bg-[var(--panel-strong)] hover:text-[var(--text)] ${
              collapsed ? "md:justify-center md:px-0" : ""
            }`}
            title={collapsed ? `${item.label} (${item.shortcut})` : undefined}
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            <div className="flex items-center gap-3 min-w-0">
              <Icon
                size={16}
                className="shrink-0 text-[var(--muted)] transition-colors duration-200 group-hover:text-[var(--text)]"
              />
              <span
                className={`truncate transition-all duration-200 ${
                  collapsed ? "md:w-0 md:opacity-0" : "w-auto opacity-100"
                }`}
              >
                {item.label}
              </span>
            </div>

            {!collapsed && (
              <span className="hidden lg:inline-flex opacity-0 group-hover:opacity-100 transition-opacity">
                <KbdBadge keys={item.shortcut} size="sm" className="text-[9px]" />
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter({
  collapsed,
  onOpenCommands,
  onOpenShortcuts,
}: {
  collapsed: boolean;
  onOpenCommands: () => void;
  onOpenShortcuts: () => void;
}) {
  return (
    <div className="mt-auto pt-3 border-t border-[var(--line)] flex flex-col gap-1">
      <button
        type="button"
        onClick={onOpenCommands}
        className={`flex h-9 items-center gap-3 rounded-xl px-3 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)] transition-colors ${
          collapsed ? "justify-center px-0" : "justify-between"
        }`}
        title="Command Palette (Ctrl+K)"
      >
        <div className="flex items-center gap-3">
          <Search size={15} className="shrink-0" />
          {!collapsed && <span>Comandos</span>}
        </div>
        {!collapsed && <KbdBadge keys="Ctrl+K" size="sm" />}
      </button>

      <button
        type="button"
        onClick={onOpenShortcuts}
        className={`flex h-9 items-center gap-3 rounded-xl px-3 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-strong)] hover:text-[var(--text)] transition-colors ${
          collapsed ? "justify-center px-0" : "justify-between"
        }`}
        title="Guia de Atalhos (?)"
      >
        <div className="flex items-center gap-3">
          <Keyboard size={15} className="shrink-0" />
          {!collapsed && <span>Atalhos</span>}
        </div>
        {!collapsed && <KbdBadge keys="?" size="sm" />}
      </button>
    </div>
  );
}

function MobileTopBar({
  onOpenCommands,
  onToggleSidebar,
  sidebarOpen,
}: {
  onOpenCommands: () => void;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  return (
    <div
      className="kaoz1-mobile-nav fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-3 md:hidden"
      style={{
        paddingTop: "calc(0.75rem + var(--sat))",
        borderBottom: "1px solid var(--line)",
        background: "color-mix(in srgb, var(--bg) 90%, transparent)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <Link href="/flow" className="flex items-center gap-2 text-sm font-semibold text-[var(--text)] no-underline">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.png" alt="Kaoz.1" className="h-5 w-5 rounded-md object-cover" />
        Kaoz.1
      </Link>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpenCommands}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text)] transition-colors active:scale-95"
          style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
          aria-label="Abrir Comandos"
        >
          <Search size={16} />
        </button>
        <button
          type="button"
          onClick={onToggleSidebar}
          className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text)] transition-colors active:scale-95"
          style={{ border: "1px solid var(--line)", background: "var(--panel)" }}
          aria-label={sidebarOpen ? "Fechar menu" : "Abrir menu"}
        >
          {sidebarOpen ? <X size={17} /> : <Menu size={17} />}
        </button>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  workspaceLabel,
}: Readonly<{
  children: React.ReactNode;
  workspaceLabel: string;
}>) {
  const pathname = usePathname();
  const router = useRouter();
  const { openCommandPalette, openCheatsheet } = useShortcuts();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Quick navigation hotkeys
  useHotkey(["alt+1"], () => router.push("/flow"));
  useHotkey(["alt+2"], () => router.push("/supervision"));
  useHotkey(["alt+3"], () => router.push("/cortex"));
  useHotkey(["alt+4"], () => router.push("/video"));
  useHotkey(["alt+5"], () => router.push("/settings"));
  useHotkey(["alt+6"], () => router.push("/model-p"));
  useHotkey(["alt+7"], () => router.push("/sketch"));
  useHotkey(["ctrl+b", "meta+b"], () => setSidebarCollapsed((val) => !val));

  return (
    <div className="kaoz1-app-shell h-full min-h-0 max-h-full overflow-hidden flex flex-col md:flex-row bg-transparent text-white antialiased">
      <MobileTopBar
        onOpenCommands={openCommandPalette}
        onToggleSidebar={() => setSidebarOpen((val) => !val)}
        sidebarOpen={sidebarOpen}
      />

      {sidebarOpen && (
        <button
          type="button"
          className="kaoz1-mobile-menu-overlay fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div
        className={`kaoz1-sidebar-dock fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out md:z-10 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <aside
          className={`flex h-full w-[260px] shrink-0 flex-col bg-[var(--bg)] px-3 py-5 text-[var(--text)] transition-[width] duration-200 ease-out ${
            sidebarCollapsed ? "md:w-[76px]" : "md:w-[248px]"
          }`}
          style={{
            borderRight: "1px solid var(--line)",
            paddingTop: "calc(1.25rem + var(--sat))",
            paddingBottom: "calc(1.25rem + var(--sab))",
          }}
        >
          <SidebarHeader
            workspaceLabel={workspaceLabel}
            collapsed={sidebarCollapsed}
            onCloseMobile={() => setSidebarOpen(false)}
            onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
          />
          <SidebarNav
            pathname={pathname}
            collapsed={sidebarCollapsed}
            onCloseMobile={() => setSidebarOpen(false)}
          />
          <SidebarFooter
            collapsed={sidebarCollapsed}
            onOpenCommands={openCommandPalette}
            onOpenShortcuts={openCheatsheet}
          />
        </aside>
      </div>

      <main
        className={`h-full min-h-0 flex-1 overflow-hidden flex flex-col pt-[calc(3.5rem+var(--sat))] pb-[var(--sab)] transition-[margin] duration-200 ease-out md:pt-0 md:pb-0 ${
          sidebarCollapsed ? "md:ml-[76px]" : "md:ml-[248px]"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
