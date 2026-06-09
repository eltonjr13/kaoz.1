"use client";

import React from "react";
import {
  Rss,
  Compass,
  Folder,
  UserRound,
  Sparkles,
  Video,
  BarChart3,
  Settings,
} from "lucide-react";

type NavItemKey =
  | "feed"
  | "discovery"
  | "projects"
  | "avatar"
  | "generation"
  | "library"
  | "analytics"
  | "settings";

interface SidebarProps {
  activeTab: NavItemKey;
  setActiveTab: (tab: NavItemKey) => void;
}

const navItems: { key: NavItemKey; label: string; icon: React.ComponentType<any> }[] = [
  { key: "feed", label: "Feed", icon: Rss },
  { key: "discovery", label: "Discovery", icon: Compass },
  { key: "projects", label: "Projects", icon: Folder },
  { key: "avatar", label: "Avatar", icon: UserRound },
  { key: "generation", label: "Generation", icon: Sparkles },
  { key: "library", label: "Library", icon: Video },
  { key: "analytics", label: "Analytics", icon: BarChart3 },
  { key: "settings", label: "Settings", icon: Settings },
];

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  return (
    <aside className="w-[184px] bg-mr-bg border-r border-mr-border flex flex-col justify-between h-full flex-shrink-0 select-none py-6">
      {/* Sidebar Items */}
      <nav className="flex flex-col gap-1 w-full" aria-label="Dashboard Navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;

          return (
            <button
              key={item.key}
              onClick={() => setActiveTab(item.key)}
              className={`flex items-center gap-3 w-full py-2.5 px-4 text-left transition-all duration-150 relative group ${
                isActive
                  ? "text-mr-text-primary font-medium"
                  : "text-mr-text-secondary hover:text-mr-text-primary"
              }`}
            >
              {/* Active bar indicators */}
              {isActive && (
                <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-mr-text-primary" />
              )}
              
              <Icon
                className={`w-[18px] h-[18px] stroke-[1.25] transition-colors duration-150 ${
                  isActive
                    ? "text-mr-text-primary"
                    : "text-mr-text-secondary group-hover:text-mr-text-primary"
                }`}
              />
              <span className="text-[13px] tracking-wide">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Footer Branding */}
      <div className="px-5 mt-auto">
        <p className="text-[13px] font-semibold text-mr-text-primary tracking-tight font-sans">
          by KHAOZ Studio
        </p>
      </div>
    </aside>
  );
}
