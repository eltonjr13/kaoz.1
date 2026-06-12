"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Briefcase,
  Globe,
  Compass,
  Cpu,
  Database,
  LineChart,
  Moon,
  Rss,
  Search,
  Settings,
  Sun,
  UserRound,
} from "lucide-react";

// Navigation mapping to the project routes
const navItems = [
  { href: "/dashboard", label: "Feed", icon: Rss },
  { href: "/viral-search", label: "Discovery", icon: Compass },
  { href: "/jobs", label: "Projects", icon: Briefcase },
  { href: "/avatars", label: "Avatar", icon: UserRound },
  { href: "/jobs/new", label: "Generation", icon: Cpu },
  { href: "/flow", label: "Agente MrChicken", icon: Globe },
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
  const [isDark, setIsDark] = useState(false);

  // Initialize theme from system or local storage
  useEffect(() => {
    const root = window.document.documentElement;
    const theme = localStorage.getItem("theme");
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    
    if (theme === "dark" || (!theme && prefersDark)) {
      root.classList.add("dark");
      root.classList.remove("light");
      setTimeout(() => setIsDark(true), 0);
    } else {
      root.classList.add("light");
      root.classList.remove("dark");
      setTimeout(() => setIsDark(false), 0);
    }
  }, []);

  const toggleTheme = () => {
    const root = window.document.documentElement;
    if (isDark) {
      root.classList.remove("dark");
      root.classList.add("light");
      localStorage.setItem("theme", "light");
      setIsDark(false);
    } else {
      root.classList.remove("light");
      root.classList.add("dark");
      localStorage.setItem("theme", "dark");
      setIsDark(true);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-[var(--bg)] text-[var(--text)] font-sans antialiased transition-colors duration-150">
      {/* 1. Header Superior (80px height) */}
      <header className="h-20 w-full bg-[var(--bg-soft)] border-b border-[var(--line)] flex items-center justify-between px-6 shrink-0 z-30">
        {/* Brand/Logo */}
        <div className="flex items-baseline gap-1">
          <Link
             href="/dashboard"
             className="text-2xl font-black tracking-tighter uppercase text-zinc-950 dark:text-white hover:opacity-90 transition-opacity"
          >
            MRCHICKEN
          </Link>
          <span className="text-[10px] text-zinc-400 dark:text-zinc-500 font-semibold font-mono tracking-tight select-none">
            by KHAOZ Studio.
          </span>
        </div>

        {/* Center / Right Control Panel */}
        <div className="flex items-center gap-4">
          {/* Workspace Pill */}
          <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-soft)] text-[9px] font-mono text-zinc-500 dark:text-zinc-400">
            <span>Workspace: {workspaceLabel}</span>
          </div>

          {/* AI Status Pill */}
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-soft)] text-[9px] font-mono font-bold tracking-wide uppercase text-zinc-700 dark:text-zinc-300">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-950 dark:bg-white"></span>
            <span>AI ACTIVE</span>
            <span className="w-1.5 h-1.5 bg-blue-500 rounded-sm"></span>
          </div>

          {/* Credits Pill */}
          <div className="hidden md:flex items-center px-3 py-1.5 rounded-full border border-[var(--line)] bg-[var(--bg-soft)] text-[9px] font-mono text-zinc-500 dark:text-zinc-400">
            <span>Credits: </span>
            <span className="font-extrabold text-zinc-950 dark:text-white ml-1">4,500</span>
            <span className="mx-0.5">/</span>
            <span>5,000</span>
          </div>

          {/* Search Input */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search"
              className="pl-8 pr-3 py-1.5 w-40 lg:w-48 bg-zinc-50 dark:bg-zinc-900 border border-[var(--line)] rounded-md text-[11px] outline-none focus:border-zinc-500 dark:focus:border-zinc-400 transition-colors duration-150"
            />
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" size={12} />
          </div>

          {/* Theme Toggle Button */}
          <button
            onClick={toggleTheme}
            className="w-8 h-8 rounded-md border border-[var(--line)] flex items-center justify-center bg-zinc-50 dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-[var(--text)] transition-colors duration-150 cursor-pointer"
            aria-label="Toggle Theme"
          >
            {isDark ? <Sun size={13} /> : <Moon size={13} />}
          </button>

          {/* User Profile Card */}
          <div className="w-8 h-8 rounded-lg overflow-hidden border border-[var(--line)] bg-zinc-100 dark:bg-zinc-800 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=100&h=100&grayscale=1"
              alt="Profile"
              className="w-full h-full object-cover filter grayscale"
            />
          </div>
        </div>
      </header>

      {/* Main Body Layout (Sidebar + Main Area) */}
      <div className="flex flex-1 w-full overflow-hidden">
        {/* 2. Sidebar Fixa à Esquerda (184px width) */}
        <aside className="hidden md:flex flex-col w-[184px] bg-[var(--bg)] border-r border-[var(--line)] h-full justify-between py-6 select-none shrink-0 z-20">
          <nav className="space-y-1 px-1.5" aria-label="Navegação Lateral">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;

              return (
                <Link
                  href={item.href}
                  key={item.label}
                  className={`flex items-center gap-3 py-2 px-3.5 text-[11px] transition-all relative group ${
                    isActive
                      ? "text-zinc-950 font-bold dark:text-white"
                      : "text-zinc-500 font-medium hover:text-zinc-850 dark:hover:text-zinc-200"
                  }`}
                >
                  {/* Left Indicator vertical bar */}
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-[2.5px] bg-zinc-950 dark:bg-white"></div>
                  )}

                  <Icon
                    size={13}
                    className={`shrink-0 transition-colors ${
                      isActive ? "text-zinc-950 dark:text-white" : "text-zinc-400 group-hover:text-zinc-700"
                    }`}
                  />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Sidebar Footer */}
          <div className="px-5 mt-auto">
            <div className="text-[10px] font-bold text-zinc-950 dark:text-white font-mono leading-none tracking-tight">
              by KHAOZ Studio
            </div>
          </div>
        </aside>

        {/* 3. Main Workspace Area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-y-auto bg-[var(--bg)]">
          {children}
        </main>
      </div>
    </div>
  );
}
