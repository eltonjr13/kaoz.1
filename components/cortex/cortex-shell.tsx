"use client";

import React, { useState, useCallback, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import {
  CortexNavigation,
  type CortexSection,
  CORTEX_SECTIONS,
} from "./cortex-navigation";
import { CortexOverview } from "./cortex-overview";
import { CortexGraphClient } from "./cortex-graph-client";
import { CortexChatMemories } from "./cortex-chat-memories";
import { CortexConversationArchive } from "./cortex-conversation-archive";
import { CortexIdentities } from "./cortex-identities";
import { CortexSectionErrorBoundary } from "./cortex-error-boundary";
import {
  CortexStorageHealthPill,
  CortexUpdatingBadge,
} from "./cortex-ui-states";

export interface CortexShellProps {
  initialSection?: CortexSection;
  className?: string;
}

interface StorageHealthState {
  status: "healthy" | "degraded" | "unhealthy";
  isFullyOperational: boolean;
}

function getStorageLabel(health: StorageHealthState): string {
  if (health.isFullyOperational) return "Local-First Operacional";
  if (health.status === "degraded") return "Degradado";
  return "Erro de Armazenamento";
}

function useCortexHeaderStats() {
  const [isUpdating, setIsUpdating] = useState(false);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [storageHealth, setStorageHealth] = useState<StorageHealthState | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/memory/graph/stats", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return;
      const json = await res.json();
      const data = json.data || json;
      if (typeof data.pendingReviewCount === "number") {
        setPendingReviewCount(data.pendingReviewCount);
      }
      if (data.storageHealth) {
        setStorageHealth({
          status: data.storageHealth.status,
          isFullyOperational: data.storageHealth.isFullyOperational,
        });
      }
    } catch {
      // Non-blocking for shell header
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const refresh = async () => {
    setIsUpdating(true);
    try {
      await fetchStats();
    } finally {
      setIsUpdating(false);
    }
  };

  return { isUpdating, pendingReviewCount, storageHealth, fetchStats, refresh };
}

interface CortexTabPanelProps {
  id: CortexSection;
  activeSection: CortexSection;
  visitedSections: Set<CortexSection>;
  children: React.ReactNode;
}

function CortexTabPanel({
  id,
  activeSection,
  visitedSections,
  children,
}: CortexTabPanelProps) {
  if (!visitedSections.has(id)) return null;
  const isActive = activeSection === id;
  return (
    <div
      role="tabpanel"
      id={`cortex-panel-${id}`}
      aria-labelledby={`cortex-tab-${id}`}
      hidden={!isActive}
      className={isActive ? "block" : "hidden"}
      tabIndex={0}
    >
      {children}
    </div>
  );
}

export function CortexShell({
  initialSection = "visao-geral",
  className = "",
}: CortexShellProps) {
  const [activeSection, setActiveSection] = useState<CortexSection>(initialSection);
  const [visitedSections, setVisitedSections] = useState<Set<CortexSection>>(
    () => new Set<CortexSection>([initialSection])
  );

  const { isUpdating, pendingReviewCount, storageHealth, fetchStats, refresh } =
    useCortexHeaderStats();

  const handleSelectSection = useCallback((section: CortexSection) => {
    setActiveSection(section);
    setVisitedSections((prev) => {
      if (prev.has(section)) return prev;
      const next = new Set(prev);
      next.add(section);
      return next;
    });
  }, []);

  const spinClass = isUpdating ? "animate-spin" : "";

  return (
    <div
      className={`w-full min-w-0 max-w-full space-y-5 overflow-x-hidden p-4 sm:p-6 lg:p-8 ${className}`}
    >
      {/* Shell Master Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-[var(--line)] pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text)] sm:text-3xl">
              Córtex Cognitivo
            </h1>
            {storageHealth && (
              <CortexStorageHealthPill
                status={storageHealth.status}
                label={getStorageLabel(storageHealth)}
              />
            )}
            {isUpdating && <CortexUpdatingBadge label="Atualizando..." />}
          </div>
          <p className="mt-1 text-xs text-[var(--muted)] leading-relaxed sm:text-sm">
            Central unificada de memória cognitiva, conhecimento semântico, arquivo de conversas e identidades observadas.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isUpdating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--line)] bg-[var(--panel)] px-3 py-1.5 text-xs font-medium text-[var(--text)] transition hover:bg-white/[0.05] disabled:opacity-50"
            title="Atualizar status do Córtex"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${spinClass}`} />
            <span>Atualizar</span>
          </button>
        </div>
      </header>

      {/* Accessible WAI-ARIA Tab Navigation Bar */}
      <CortexNavigation
        sections={CORTEX_SECTIONS}
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        pendingReviewCount={pendingReviewCount}
      />

      {/* Tab Panels: Lazy-Mount + Keep-Alive with hidden={activeSection !== id} */}
      <div className="relative min-w-0 w-full max-w-full">
        <CortexTabPanel id="visao-geral" activeSection={activeSection} visitedSections={visitedSections}>
          <CortexSectionErrorBoundary
            section="Visão Geral"
            onReset={() => void fetchStats()}
          >
            <CortexOverview onNavigateSection={handleSelectSection} />
          </CortexSectionErrorBoundary>
        </CortexTabPanel>

        <CortexTabPanel id="grafo" activeSection={activeSection} visitedSections={visitedSections}>
          <CortexSectionErrorBoundary section="Grafo">
            <CortexGraphClient isActive={activeSection === "grafo"} />
          </CortexSectionErrorBoundary>
        </CortexTabPanel>

        <CortexTabPanel id="memorias" activeSection={activeSection} visitedSections={visitedSections}>
          <CortexSectionErrorBoundary section="Memórias">
            <CortexChatMemories />
          </CortexSectionErrorBoundary>
        </CortexTabPanel>

        <CortexTabPanel id="conversas" activeSection={activeSection} visitedSections={visitedSections}>
          <CortexSectionErrorBoundary section="Conversas">
            <CortexConversationArchive />
          </CortexSectionErrorBoundary>
        </CortexTabPanel>

        <CortexTabPanel id="identidades" activeSection={activeSection} visitedSections={visitedSections}>
          <CortexSectionErrorBoundary section="Identidades">
            <CortexIdentities />
          </CortexSectionErrorBoundary>
        </CortexTabPanel>
      </div>
    </div>
  );
}
