"use client";

/**
 * Leitura do estado do motor: status, topologia e rastros.
 *
 * A página aberta NÃO dispara aprendizado nem consultas que alterem o ranking:
 * apenas lê status e rastros já gravados. O polling só acontece com a aba ativa
 * e é cancelado no desmonte.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ConnectomeNode,
  EngineTrace,
} from "@/services/cortex-engine/cortex-engine.types";

export type EngineStatusName =
  | "disabled"
  | "preparing"
  | "ready"
  | "processing"
  | "shadow-comparing"
  | "fallback"
  | "error";

export interface EngineStatusPayload {
  configuredMode: "legacy" | "shadow" | "malecns";
  effectiveMode: "legacy" | "shadow" | "malecns";
  status: EngineStatusName;
  packageAvailable: boolean;
  packageVersion: string | null;
  packageDatasetId: string | null;
  readoutAvailable: boolean;
  readoutVersion: string | null;
  readoutVariant: string | null;
  attribution: string;
  license: string;
  scopeNotice: string;
}

export interface TopologyPayload {
  manifest: {
    datasetVersion: string;
    stats: { neurons: number; edges: number; cellTypes: number };
    activityScale: { min: number; max: number; note: string };
  };
  transform: string;
  units: string;
  nodes: ConnectomeNode[];
  positions: number[];
}

const POLL_MS = 2_000;

export interface EngineData {
  status: EngineStatusPayload | null;
  topology: TopologyPayload | null;
  traces: EngineTrace[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useEngineData(isActive: boolean): EngineData {
  const [status, setStatus] = useState<EngineStatusPayload | null>(null);
  const [topology, setTopology] = useState<TopologyPayload | null>(null);
  const [traces, setTraces] = useState<EngineTrace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    if (!isActive) return;
    const controller = new AbortController();
    let cancelled = false;

    const tick = async () => {
      try {
        const payload = await fetchEngineData(controller.signal);
        if (cancelled) return;
        applyPayload(payload, { setStatus, setTopology, setTraces, setError });
      } catch (err: any) {
        if (err?.name !== "AbortError" && !cancelled) {
          setError(err?.message || "Falha ao carregar o estado do motor.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [isActive, nonce]);

  return { status, topology, traces, loading, error, reload };
}

interface EngineFetch {
  status: EngineStatusPayload | null;
  topology: TopologyPayload | null;
  traces: EngineTrace[];
  error: string | null;
}

interface EngineFetchSetters {
  setStatus: (value: EngineStatusPayload) => void;
  setTopology: (value: TopologyPayload) => void;
  setTraces: (value: EngineTrace[]) => void;
  setError: (value: string | null) => void;
}

/**
 * Aplica o resultado do poll.
 *
 * Status e topologia só são sobrescritos quando vieram com sucesso: uma falha
 * transitória em um endpoint não pode apagar o que já foi carregado.
 */
function applyPayload(payload: EngineFetch, setters: EngineFetchSetters): void {
  if (payload.status) setters.setStatus(payload.status);
  if (payload.topology) setters.setTopology(payload.topology);
  setters.setTraces(payload.traces);
  setters.setError(payload.error);
}

async function fetchEngineData(signal: AbortSignal): Promise<EngineFetch> {
  const [statusResponse, topologyResponse, tracesResponse] = await Promise.all([
    fetch("/api/cortex/engine/status", { signal, cache: "no-store" }),
    fetch("/api/cortex/engine/topology?level=1", { signal, cache: "no-store" }),
    fetch("/api/cortex/engine/traces?limit=12", { signal, cache: "no-store" }),
  ]);
  const [statusBody, topologyBody, tracesBody] = await Promise.all([
    statusResponse.json(),
    topologyResponse.json(),
    tracesResponse.json(),
  ]);
  const errors = [statusBody, topologyBody, tracesBody]
    .filter((body) => body && body.success === false)
    .map((body) => body.error?.message)
    .filter(Boolean);
  return {
    status: statusBody?.success ? (statusBody.data as EngineStatusPayload) : null,
    topology: topologyBody?.success ? (topologyBody.data as TopologyPayload) : null,
    traces: tracesBody?.success ? ((tracesBody.data?.traces ?? []) as EngineTrace[]) : [],
    // Topologia ausente não é erro: é o estado "pacote não preparado", que a
    // interface mostra como vazio em vez de falha.
    error: errors.length > 0 ? String(errors[0]) : null,
  };
}

/** Rastreia visibilidade e foco para suspender trabalho quando não faz sentido. */
export function useIsForeground(): boolean {
  const [foreground, setForeground] = useState(true);
  const listener = useCallback(() => {
    setForeground(document.visibilityState === "visible");
  }, []);
  const attached = useRef(false);
  useEffect(() => {
    if (attached.current) return;
    attached.current = true;
    listener();
    document.addEventListener("visibilitychange", listener);
    return () => {
      attached.current = false;
      document.removeEventListener("visibilitychange", listener);
    };
  }, [listener]);
  return foreground;
}
