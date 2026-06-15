"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Briefcase,
  Compass,
  Cpu,
  Database,
  LineChart,
  Menu,
  Rss,
  Settings,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Feed", icon: Rss },
  { href: "/viral-search", label: "Discovery", icon: Compass },
  { href: "/jobs", label: "Projects", icon: Briefcase },
  { href: "/avatars", label: "Avatar", icon: UserRound },
  { href: "/jobs/new", label: "Generation", icon: Cpu },
  { href: "/flow", label: "AgenteMrChicken", icon: Sparkles },
  { href: "#library", label: "Library", icon: Database },
  { href: "#analytics", label: "Analytics", icon: LineChart },
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

  const sidebar = (
    <aside
      className="flex h-full w-[248px] shrink-0 flex-col bg-[#080808] px-3 py-5 text-white"
      style={{
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Logo */}
      <Link
        href="/dashboard"
        className="group flex items-center gap-3 rounded-[20px] px-3 py-2.5 no-underline transition-all duration-200 hover:bg-white/[0.03]"
        onClick={() => setSidebarOpen(false)}
        style={{ marginBottom: "4px" }}
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
        <span className="min-w-0">
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

      {/* Separator */}
      <div
        className="mx-3 my-3"
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
              className="group relative flex h-10 items-center gap-3 rounded-[16px] px-3 text-[13px] font-medium no-underline transition-all duration-200"
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
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom user profile */}
      <div
        className="mt-4 pt-4"
        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}
      >
        <div
          className="flex items-center gap-3 rounded-[20px] p-2.5 px-3"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{
              background: "rgba(157,124,255,0.15)",
              border: "1px solid rgba(157,124,255,0.25)",
            }}
          >
            N
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-white leading-tight">
              Nexus
            </div>
            <div
              className="mt-0.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              style={{
                background: "rgba(157,124,255,0.1)",
                color: "#9D7CFF",
                border: "1px solid rgba(157,124,255,0.18)",
              }}
            >
              Pro
            </div>
          </div>
        </div>
        <div
          className="mt-3 px-1 text-[10px] tracking-[0.06em] uppercase"
          style={{ color: "#4A4A54" }}
        >
          by BM4E Studio
        </div>
      </div>
    </aside>
  );

  return (
    <div className="min-h-screen bg-[#080808] text-white antialiased" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Mobile top bar */}
      <div
        className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-4 py-3 md:hidden"
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
          className="fixed inset-0 z-40 md:hidden"
          style={{ background: "rgba(0,0,0,0.65)" }}
          aria-label="Fechar menu"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out md:z-10 md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {sidebar}
      </div>

      <main className="min-h-screen pt-14 md:ml-[248px] md:pt-0">{children}</main>
    </div>
  );
}
