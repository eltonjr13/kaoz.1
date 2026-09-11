"use client";

import React, { type ComponentType } from "react";
import {
  AlertTriangle,
  RefreshCw,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HardDrive,
  LucideProps,
} from "lucide-react";

/**
 * Format raw bytes into human-readable size (KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (bytes <= 0 || !Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1);
  return `${val} ${units[i] || "B"}`;
}

// ---------------------------------------------------------------------------
// 1. CortexSkeleton
// ---------------------------------------------------------------------------
export interface CortexSkeletonProps {
  variant?: "cards" | "rows" | "full";
  count?: number;
  className?: string;
}

export function CortexSkeleton({
  variant = "cards",
  count = 4,
  className = "",
}: CortexSkeletonProps) {
  const items = Array.from({ length: count });

  return (
    <div
      role="status"
      aria-live="polite"
      className={`w-full min-w-0 animate-pulse space-y-4 ${className}`}
    >
      <span className="sr-only">Carregando dados do Córtex...</span>

      {variant === "cards" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
          {items.map((_, i) => (
            <div
              key={i}
              className="h-28 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <div className="h-4 w-24 rounded bg-white/10" />
                <div className="h-6 w-6 rounded-full bg-white/10" />
              </div>
              <div className="mt-4 h-7 w-16 rounded bg-white/10" />
              <div className="mt-2 h-3 w-32 rounded bg-white/5" />
            </div>
          ))}
        </div>
      )}

      {variant === "rows" && (
        <div className="space-y-2.5">
          {items.map((_, i) => (
            <div
              key={i}
              className="flex h-16 items-center justify-between rounded-lg border border-[var(--line)] bg-[var(--panel)] px-4"
            >
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-md bg-white/10" />
                <div className="space-y-1.5">
                  <div className="h-4 w-40 rounded bg-white/10" />
                  <div className="h-3 w-24 rounded bg-white/5" />
                </div>
              </div>
              <div className="h-6 w-20 rounded bg-white/10" />
            </div>
          ))}
        </div>
      )}

      {variant === "full" && (
        <div className="space-y-6">
          {/* Header skeleton */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-2">
              <div className="h-6 w-48 rounded bg-white/10" />
              <div className="h-3 w-72 rounded bg-white/5" />
            </div>
            <div className="h-8 w-28 rounded-lg bg-white/10" />
          </div>
          {/* Cards skeleton */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
            {items.map((_, i) => (
              <div
                key={i}
                className="h-28 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4"
              >
                <div className="h-4 w-20 rounded bg-white/10" />
                <div className="mt-4 h-7 w-12 rounded bg-white/10" />
              </div>
            ))}
          </div>
          {/* Detailed area skeleton */}
          <div className="h-64 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-6" />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. CortexEmptyState
// ---------------------------------------------------------------------------
export interface CortexEmptyStateProps {
  icon?: ComponentType<LucideProps>;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function CortexEmptyState({
  icon: Icon = HardDrive,
  title,
  description,
  actionLabel,
  onAction,
  className = "",
}: CortexEmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--line)] bg-[var(--panel)] p-8 text-center sm:p-12 ${className}`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/5 text-[var(--muted)]">
        <Icon className="h-6 w-6 text-[var(--muted)]" />
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--text)]">{title}</h3>
      <p className="mt-1.5 max-w-md text-sm text-[var(--muted)] leading-relaxed">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[var(--signal-soft)] px-4 py-2 text-sm font-medium text-[var(--signal-bright)] transition-colors hover:bg-[var(--signal-soft)]/80 focus:outline-none focus:ring-2 focus:ring-[var(--signal-bright)] focus:ring-offset-2 focus:ring-offset-[var(--bg)]"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. CortexErrorState
// ---------------------------------------------------------------------------
export interface CortexErrorStateProps {
  title?: string;
  message: string;
  code?: string;
  onRetry?: () => void | Promise<void>;
  isRetrying?: boolean;
  className?: string;
}

export function CortexErrorState({
  title = "Falha ao carregar dados do Córtex",
  message,
  code,
  onRetry,
  isRetrying = false,
  className = "",
}: CortexErrorStateProps) {
  return (
    <div
      role="alert"
      className={`flex flex-col gap-4 rounded-xl border border-rose-500/30 bg-rose-950/40 p-5 text-rose-200 sm:flex-row sm:items-center sm:justify-between ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-full bg-rose-900/50 p-1.5 text-rose-400">
          <AlertTriangle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-rose-100">{title}</h4>
          <p className="mt-0.5 text-xs text-rose-300/90 break-words">{message}</p>
          {code && (
            <span className="mt-1.5 inline-block font-mono text-[10px] uppercase text-rose-400/80 bg-rose-950 px-1.5 py-0.5 rounded border border-rose-800/40">
              Código: {code}
            </span>
          )}
        </div>
      </div>

      {onRetry && (
        <button
          type="button"
          onClick={() => void onRetry()}
          disabled={isRetrying}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-400/30 bg-rose-900/40 px-3.5 py-2 text-xs font-medium text-rose-100 transition-colors hover:bg-rose-900/70 focus:outline-none focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 focus:ring-offset-[var(--bg)] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`} />
          {isRetrying ? "Tentando novamente..." : "Tentar novamente"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. CortexUpdatingBadge
// ---------------------------------------------------------------------------
export interface CortexUpdatingBadgeProps {
  label?: string;
  className?: string;
}

export function CortexUpdatingBadge({
  label = "Atualizando...",
  className = "",
}: CortexUpdatingBadgeProps) {
  return (
    <span
      role="status"
      className={`inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-950/50 px-2.5 py-0.5 text-xs font-medium text-amber-300 ${className}`}
    >
      <Loader2 className="h-3 w-3 animate-spin text-amber-400" />
      <span>{label}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// 5. CortexStorageHealthPill
// ---------------------------------------------------------------------------
export interface CortexStorageHealthPillProps {
  status: "healthy" | "degraded" | "unhealthy";
  label?: string;
  sizeBytes?: number;
  showIcon?: boolean;
  className?: string;
}

export function CortexStorageHealthPill({
  status,
  label,
  sizeBytes,
  showIcon = true,
  className = "",
}: CortexStorageHealthPillProps) {
  const isHealthy = status === "healthy";
  const isDegraded = status === "degraded";

  const colorStyles = isHealthy
    ? "border-emerald-500/30 bg-emerald-950/50 text-emerald-300"
    : isDegraded
    ? "border-amber-500/30 bg-amber-950/50 text-amber-300"
    : "border-rose-500/30 bg-rose-950/50 text-rose-300";

  const dotColor = isHealthy
    ? "bg-emerald-400"
    : isDegraded
    ? "bg-amber-400"
    : "bg-rose-400";

  const defaultText = isHealthy
    ? "Operacional"
    : isDegraded
    ? "Degradado"
    : "Falha de Armazenamento";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${colorStyles} ${className}`}
      title={label || defaultText}
    >
      <span className="relative flex h-2 w-2">
        {isHealthy && (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dotColor} opacity-75`} />
        )}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dotColor}`} />
      </span>

      {showIcon && (
        <>
          {isHealthy ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
          ) : isDegraded ? (
            <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
          )}
        </>
      )}

      <span>{label || defaultText}</span>

      {typeof sizeBytes === "number" && sizeBytes > 0 && (
        <span className="opacity-70 font-mono text-[11px]">
          ({formatBytes(sizeBytes)})
        </span>
      )}
    </div>
  );
}
