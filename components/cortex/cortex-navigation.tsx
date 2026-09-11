"use client";

import React, { useRef, useEffect, type ComponentType } from "react";
import {
  LayoutDashboard,
  GitBranch,
  Brain,
  MessagesSquare,
  Shield,
  Network,
  LucideProps,
} from "lucide-react";

export type CortexSection =
  | "cerebro"
  | "visao-geral"
  | "grafo"
  | "memorias"
  | "conversas"
  | "identidades";

export interface CortexSectionConfig {
  id: CortexSection;
  label: string;
  description: string;
  icon: ComponentType<LucideProps>;
  shortcutNumber: string;
  badge?: number | string | null;
  badgeVariant?: "warning" | "info" | "default";
}

export const CORTEX_SECTIONS: CortexSectionConfig[] = [
  {
    id: "cerebro",
    label: "Cérebro",
    description:
      "Anatomia real do recorte do conectoma e processamento observado das memórias",
    icon: Network,
    shortcutNumber: "1",
  },
  {
    id: "visao-geral",
    label: "Visão Geral",
    description: "Métricas consolidadas e saúde operacional dos motores locais",
    icon: LayoutDashboard,
    shortcutNumber: "2",
  },
  {
    id: "grafo",
    label: "Grafo",
    description: "Grafo cognitivo de conhecimento e regras procedimentais",
    icon: GitBranch,
    shortcutNumber: "3",
  },
  {
    id: "memorias",
    label: "Memórias",
    description: "Memórias persistentes, tags e revisões de aprendizado",
    icon: Brain,
    shortcutNumber: "4",
  },
  {
    id: "conversas",
    label: "Conversas",
    description: "Arquivo histórico omnichannel pesquisável (Flow, Telegram, Discord)",
    icon: MessagesSquare,
    shortcutNumber: "5",
  },
  {
    id: "identidades",
    label: "Identidades",
    description: "Identidades externas observadas e vínculos com perfil local",
    icon: Shield,
    shortcutNumber: "6",
  },
];

export interface CortexNavigationProps {
  sections?: CortexSectionConfig[];
  activeSection: CortexSection;
  onSelectSection: (section: CortexSection) => void;
  pendingReviewCount?: number;
  className?: string;
}

/**
 * Resolve a seção de destino para uma tecla de navegação do tablist.
 *
 * Devolve -1 quando a tecla não é um comando conhecido. Aceita as setas, Home,
 * End e os dígitos de 1 a N (um por seção).
 */
export function resolveNextIndex(
  event: { key: string },
  currentIndex: number,
  total: number
): number {
  switch (event.key) {
    case "ArrowRight":
    case "ArrowDown":
      return (currentIndex + 1) % total;
    case "ArrowLeft":
    case "ArrowUp":
      return (currentIndex - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      break;
  }
  const digit = /^[1-9]$/.test(event.key) ? Number(event.key) : -1;
  return digit >= 1 && digit <= total ? digit - 1 : -1;
}

export function CortexNavigation({
  sections = CORTEX_SECTIONS,
  activeSection,
  onSelectSection,
  pendingReviewCount = 0,
  className = "",
}: CortexNavigationProps) {
  const tabRefs = useRef<Map<CortexSection, HTMLButtonElement>>(new Map());

  const currentIndex = sections.findIndex((s) => s.id === activeSection);

  // Focus the active tab button when activeSection changes via keyboard navigation
  const focusTab = (id: CortexSection) => {
    const btn = tabRefs.current.get(id);
    if (btn) {
      btn.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const total = sections.length;
    if (total === 0) return;
    const nextIndex = resolveNextIndex(e, currentIndex, total);
    if (nextIndex < 0) return;
    e.preventDefault();
    const targetSection = sections[nextIndex].id;
    onSelectSection(targetSection);
    focusTab(targetSection);
  };

  return (
    <nav
      aria-label="Navegação do Córtex"
      className={`w-full min-w-0 max-w-full overflow-x-auto no-scrollbar ${className}`}
    >
      <div
        role="tablist"
        aria-label="Seções do Córtex Cognitivo"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="inline-flex min-w-full sm:min-w-0 items-center gap-1 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1.5 backdrop-blur-sm"
      >
        {sections.map((section) => {
          const isActive = section.id === activeSection;
          const Icon = section.icon;

          // Memórias badge for pending reviews
          const badgeCount =
            section.id === "memorias" && pendingReviewCount > 0
              ? pendingReviewCount
              : section.badge;

          return (
            <button
              key={section.id}
              ref={(el) => {
                if (el) tabRefs.current.set(section.id, el);
                else tabRefs.current.delete(section.id);
              }}
              role="tab"
              id={`cortex-tab-${section.id}`}
              aria-selected={isActive}
              aria-controls={`cortex-panel-${section.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSelectSection(section.id)}
              className={`group relative flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-bright)] ${
                isActive
                  ? "bg-[var(--signal-soft)] text-[var(--signal-bright)] border border-[var(--signal-bright)]/30 shadow-sm"
                  : "text-[var(--muted)] hover:bg-white/[0.04] hover:text-[var(--text)] border border-transparent"
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 transition-colors ${
                  isActive
                    ? "text-[var(--signal-bright)]"
                    : "text-[var(--muted)] group-hover:text-[var(--text)]"
                }`}
              />
              <span className="whitespace-nowrap font-medium">{section.label}</span>

              {/* Numeric keyboard shortcut hint */}
              <kbd
                className={`hidden md:inline-flex h-4 min-w-4 items-center justify-center rounded px-1 text-[10px] font-mono leading-none transition-opacity ${
                  isActive
                    ? "bg-[var(--signal-bright)]/20 text-[var(--signal-bright)]"
                    : "bg-white/5 text-[var(--muted)]/70 group-hover:opacity-100"
                }`}
                title={`Atalho: ${section.shortcutNumber}`}
              >
                {section.shortcutNumber}
              </kbd>

              {/* Dynamic Notification Badge */}
              {typeof badgeCount === "number" && badgeCount > 0 && (
                <span
                  className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-bold text-amber-300 border border-amber-500/40"
                  title={`${badgeCount} itens pendentes de revisão`}
                >
                  {badgeCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
