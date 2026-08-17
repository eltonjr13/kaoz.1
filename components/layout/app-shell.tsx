"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";

const navItems = [
  { href: "/flow", label: "Kaoz.1", icon: Sparkles },
  { href: "/supervision", label: "Supervisor", icon: Activity },
  { href: "/cortex", label: "Córtex", icon: Brain },
  { href: "/video", label: "Edição de vídeo", icon: Video },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function AppShell({
  children,
  workspaceLabel,
}: Readonly<{
  children: React.ReactNode;
  workspaceLabel: string;
}>) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const sidebar = (
    <aside
      className={`flex h-full w-[248px] shrink-0 flex-col bg-[var(--bg)] px-3 py-5 text-[var(--text)] transition-[width] duration-200 ease-out ${sidebarCollapsed ? "md:w-[76px]" : "md:w-[248px]"}`}
      style={{
        borderRight: "1px solid var(--line)",
      }}
    >
      {/* Logo */}
      <div className={`mb-3 flex items-center gap-2 ${sidebarCollapsed ? "md:flex-col" : ""}`}>
        <Link
          href="/flow"
          className={`group flex min-w-0 flex-1 items-center gap-3 rounded-[20px] px-3 py-2.5 no-underline hover:no-underline focus:no-underline active:no-underline outline-none focus:outline-none focus-visible:outline-none transition-all duration-200 hover:bg-[var(--panel-strong)] ${sidebarCollapsed ? "md:flex-none md:justify-center md:px-0" : ""}`}
          onClick={() => setSidebarOpen(false)}
          title={sidebarCollapsed ? "Kaoz.1" : undefined}
          style={{ textDecoration: "none" }}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[12px]"
            style={{
              border: "1px solid var(--line)",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icon.png" alt="Kaoz.1" className="h-full w-full object-cover" />
          </span>
          <span
            className={`min-w-0 overflow-hidden transition-all duration-200 ${sidebarCollapsed ? "md:w-0 md:opacity-0" : "w-auto opacity-100"}`}
          >
            <span
              className="block text-[13px] font-semibold leading-tight text-[var(--text)] tracking-[-0.01em]"
            >
              Kaoz.1
            </span>
            <span className="block truncate text-[11px] font-normal text-[var(--muted)] mt-0.5">
              {workspaceLabel}
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setSidebarCollapsed((value) => !value)}
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[var(--muted)] transition-colors hover:bg-[var(--panel-strong)] hover:text-[var(--text)] outline-none focus:outline-none focus-visible:outline-none md:flex"
          style={{
            border: "1px solid var(--line)",
            background: "var(--panel)",
          }}
          aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Retrair menu lateral"}
          title={sidebarCollapsed ? "Expandir menu" : "Retrair menu"}
        >
          {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Navegação lateral">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              href={item.href}
              key={item.label}
              onClick={() => setSidebarOpen(false)}
              aria-current={isActive ? "page" : undefined}
              data-active={isActive}
              className={`kaoz-signal-nav-item group flex h-10 items-center gap-3 px-3 text-[13px] font-medium no-underline hover:no-underline focus:no-underline active:no-underline outline-none focus:outline-none focus-visible:outline-none transition-all duration-200 hover:bg-[var(--panel-strong)] hover:text-[var(--text)] ${sidebarCollapsed ? "md:justify-center md:px-0" : ""}`}
              title={sidebarCollapsed ? item.label : undefined}
              style={{
                color: "var(--muted)",
                textDecoration: "none",
              }}
            >
              <Icon
                size={16}
                className="shrink-0 text-[var(--muted)] transition-colors duration-200 group-hover:text-[var(--text)]"
              />
              <span className={`truncate transition-all duration-200 ${sidebarCollapsed ? "md:w-0 md:opacity-0" : "w-auto opacity-100"}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );

  return (
    <div className="kaoz1-app-shell h-full min-h-0 max-h-full overflow-hidden flex flex-col md:flex-row bg-transparent text-white antialiased">
      {/* Mobile top bar */}
      <div
        className="kaoz1-mobile-nav fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-3 md:hidden"
        style={{
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
        <button
          type="button"
          onClick={() => setSidebarOpen((value) => !value)}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-[var(--text)] transition-colors"
          style={{
            border: "1px solid var(--line)",
            background: "var(--panel)",
          }}
          aria-label={sidebarOpen ? "Fechar menu" : "Abrir menu"}
        >
          {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <button
          type="button"
          className="kaoz1-mobile-menu-overlay fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.65)" }}
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`kaoz1-sidebar-dock fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out md:z-10 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </div>

      <main className={`h-full min-h-0 flex-1 overflow-hidden flex flex-col pt-14 transition-[margin] duration-200 ease-out md:pt-0 ${sidebarCollapsed ? "md:ml-[76px]" : "md:ml-[248px]"}`}>{children}</main>
    </div>
  );
}
