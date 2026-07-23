"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Menu,
  Settings,
  Shirt,
  Sparkles,
  UserRound,
  X,
  Brain,
} from "lucide-react";

const navItems = [
  { href: "/jobs", label: "Projects", icon: Briefcase },
  { href: "/avatars", label: "Avatar", icon: UserRound },
  { href: "/jobs/new", label: "Generation", icon: Cpu },
  { href: "/flow", label: "AgenteMrChicken", icon: Sparkles },
  { href: "/cortex", label: "Córtex", icon: Brain },
  { href: "/patterns", label: "Estampas", icon: Shirt },
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
      className={`flex h-full w-[248px] shrink-0 flex-col bg-[#080808] px-3 py-5 text-white transition-[width] duration-200 ease-out ${sidebarCollapsed ? "md:w-[76px]" : "md:w-[248px]"}`}
      style={{
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo */}
      <div className={`mb-1 flex items-center gap-2 ${sidebarCollapsed ? "md:flex-col" : ""}`}>
        <Link
          href="/flow"
          className={`group flex min-w-0 flex-1 items-center gap-3 rounded-[20px] px-3 py-2.5 no-underline transition-all duration-200 hover:bg-white/[0.03] ${sidebarCollapsed ? "md:flex-none md:justify-center md:px-0" : ""}`}
          onClick={() => setSidebarOpen(false)}
          title={sidebarCollapsed ? "AgenteMrChicken" : undefined}
        >
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[14px]"
            style={{
              background: "rgba(157,124,255,0.12)",
              border: "1px solid rgba(157,124,255,0.2)",
            }}
          >
            <Sparkles size={15} className="text-[#9D7CFF]" />
          </span>
          <span
            className={`min-w-0 overflow-hidden transition-all duration-200 ${sidebarCollapsed ? "md:w-0 md:opacity-0" : "w-auto opacity-100"}`}
          >
            <span
              className="block text-[13px] font-semibold leading-tight text-white tracking-[-0.01em]"
            >
              AgenteMrChicken
            </span>
            <span className="block truncate text-[11px] font-normal text-[#7B7B86] mt-0.5">
              {workspaceLabel}
            </span>
          </span>
        </Link>

        <button
          type="button"
          onClick={() => setSidebarCollapsed((value) => !value)}
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-xl text-[#9CA3AF] transition-colors hover:bg-white/[0.05] hover:text-white md:flex"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.03)",
          }}
          aria-label={sidebarCollapsed ? "Expandir menu lateral" : "Retrair menu lateral"}
          title={sidebarCollapsed ? "Expandir menu" : "Retrair menu"}
        >
          {sidebarCollapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
        </button>
      </div>

      {/* Separator */}
      <div
        className={sidebarCollapsed ? "mx-2 my-3" : "mx-3 my-3"}
        style={{ height: "1px", background: "rgba(255,255,255,0.05)" }}
      />

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Navegação lateral">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;

          return (
            <Link
              href={item.href}
              key={item.label}
              onClick={() => setSidebarOpen(false)}
              className={`group relative flex h-10 items-center gap-3 rounded-[16px] px-3 text-[13px] font-medium no-underline transition-all duration-200 ${sidebarCollapsed ? "md:justify-center md:px-0" : ""}`}
              title={sidebarCollapsed ? item.label : undefined}
              style={{
                background: isActive
                  ? "rgba(255,255,255,0.035)"
                  : "transparent",
                color: isActive ? "#ffffff" : "#B8B8C0",
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "rgba(255,255,255,0.025)";
                  e.currentTarget.style.color = "#ffffff";
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "#B8B8C0";
                }
              }}
            >
              {/* Active indicator bar */}
              <span
                className="absolute left-0 rounded-full transition-opacity duration-200"
                style={{
                  top: "10px",
                  bottom: "10px",
                  width: "2px",
                  background: "#9D7CFF",
                  opacity: isActive ? 1 : 0,
                }}
              />
              <Icon
                size={16}
                style={{
                  color: isActive ? "#9D7CFF" : "#7B7B86",
                  flexShrink: 0,
                  transition: "color 200ms ease-out",
                }}
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
    <div className="mrchicken-app-shell h-full min-h-0 max-h-full overflow-hidden flex flex-col md:flex-row bg-transparent text-white antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Mobile top bar */}
      <div
        className="mrchicken-mobile-nav fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-3 md:hidden"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(8,8,8,0.9)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
        }}
      >
        <Link href="/flow" className="flex items-center gap-2 text-sm font-semibold text-white no-underline">
          <Sparkles size={15} className="text-[#9D7CFF]" />
          AgenteMrChicken
        </Link>
        <button
          type="button"
          onClick={() => setSidebarOpen((value) => !value)}
          className="flex h-8 w-8 items-center justify-center rounded-xl text-white transition-colors"
          style={{
            border: "1px solid rgba(255,255,255,0.08)",
            background: "rgba(255,255,255,0.04)",
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
          className="mrchicken-mobile-menu-overlay fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.65)" }}
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`mrchicken-sidebar-dock fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out md:z-10 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </div>

      <main className={`h-full min-h-0 flex-1 overflow-hidden flex flex-col pt-14 transition-[margin] duration-200 ease-out md:pt-0 ${sidebarCollapsed ? "md:ml-[76px]" : "md:ml-[248px]"}`}>{children}</main>
    </div>
  );
}
