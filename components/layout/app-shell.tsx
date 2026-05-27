"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import { Briefcase, LayoutDashboard, Play, Plus, Search, UserRound } from "lucide-react";

const navItems: { href: Route; label: string; icon: typeof LayoutDashboard }[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/viral-search", label: "Busca viral", icon: Search },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/jobs/new", label: "Criar", icon: Plus },
  { href: "/avatars", label: "Avatares", icon: UserRound }
];

export function AppShell({
  children,
  workspaceLabel
}: Readonly<{
  children: React.ReactNode;
  workspaceLabel: string;
}>) {
  const pathname = usePathname();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="brand-mark">
            <Play size={18} fill="currentColor" />
          </span>
          <span>AI UGC Studio</span>
        </Link>
        <nav className="sidebar-nav" aria-label="Principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link className={`nav-link ${isActive ? "active" : ""}`} href={item.href} key={item.href}>
                <Icon size={18} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <p>{workspaceLabel}</p>
        </div>
      </aside>

      <header className="mobile-nav">
        <Link className="brand" href="/dashboard">
          <span className="brand-mark">
            <Play size={16} fill="currentColor" />
          </span>
        </Link>
        <nav className="mobile-nav-links" aria-label="Principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link className={isActive ? "active" : ""} href={item.href} key={item.href}>
                <Icon size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="app-main">{children}</main>
    </div>
  );
}
