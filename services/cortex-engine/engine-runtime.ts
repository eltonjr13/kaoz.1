/**
 * Runtime do motor: ciclo de vida do worker, fila, deadlines e fallback.
 *
 * O worker roda em `worker_threads`, o que permite INTERROMPER computação de
 * verdade (`terminate()`). `Promise.race` sem parar a computação não atende ao
 * requisito de cancelamento (plano, seção 15.3).
 *
 * Fila cheia, timeout, worker encerrado e saturação inválida produzem fallback
 * explícito — nunca um ranking parcial silencioso.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { Worker } from "node:worker_threads";
import type {
  EngineWorkerRequest,
  EngineWorkerResponse,
  FallbackReason,
} from "./cortex-engine.types.ts";

export interface RuntimeOptions {
  packageDir: string;
  readoutPath: string;
  dimension: number;
  maxQueue: number;
  sampleSize: number;
  /** Caminho do worker já compilado para JavaScript. */
  workerScript: string;
}

interface Pending {
  requestId: string;
  resolve: (result: EngineWorkerResponse) => void;
  timer: NodeJS.Timeout;
}

export class EngineRuntimeError extends Error {
  public readonly reason: FallbackReason;

  constructor(reason: FallbackReason, message: string) {
    super(message);
    this.reason = reason;
    this.name = "EngineRuntimeError";
  }
}

export class EngineRuntime {
  private worker: Worker | null = null;
  private ready = false;
  private pending = new Map<string, Pending>();
  private queueDepth = 0;
  private starting: Promise<void> | null = null;
  private options: RuntimeOptions;

  constructor(options: RuntimeOptions) {
    this.options = options;
  }

  public get isReady(): boolean {
    return this.ready;
  }

  public get depth(): number {
    return this.queueDepth;
  }

  /** Inicia o worker uma única vez; chamadas concorrentes compartilham a promessa. */
  public async start(): Promise<void> {
    if (this.ready) return;
    if (this.starting) return this.starting;
    this.starting = this.spawn();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async spawn(): Promise<void> {
    const script = this.options.workerScript;
    if (!(await fileExists(script))) {
      throw new EngineRuntimeError(
        "package-missing",
        `worker compilado não encontrado em ${script}; rode cortex:build-worker`
      );
    }
    const worker = new Worker(script, {
      workerData: {
        packageDir: this.options.packageDir,
        dimension: this.options.dimension,
        readoutPath: this.options.readoutPath,
        sampleSize: this.options.sampleSize,
      },
    });
    this.worker = worker;
    worker.on("message", (message: unknown) => this.onMessage(message));
    worker.on("error", (error: Error) => this.failAll("worker-exited", error.message));
    worker.on("exit", (code: number) => {
      this.ready = false;
      this.worker = null;
      if (code !== 0) this.failAll("worker-exited", `worker saiu com código ${code}`);
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new EngineRuntimeError("worker-exited", "worker não ficou pronto a tempo")),
        30_000
      );
      worker.once("message", (message: { kind?: string; error?: FallbackReason; detail?: string }) => {
        clearTimeout(timer);
        if (message?.kind === "ready") {
          this.ready = true;
          resolve();
          return;
        }
        reject(
          new EngineRuntimeError(
            message?.error ?? "engine-error",
            message?.detail ?? "falha ao inicializar o worker"
          )
        );
      });
    });
  }

  private onMessage(message: unknown): void {
    const response = message as EngineWorkerResponse & { kind?: string };
    if (!response || response.kind) return;
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(response.requestId);
    this.queueDepth = Math.max(0, this.queueDepth - 1);
    pending.resolve(response);
  }

  /** Falha toda a fila com um motivo; usada quando o worker morre. */
  private failAll(reason: FallbackReason, detail: string): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve({ requestId, ok: false, error: reason, timings: { detail: 0 } });
    }
    this.pending.clear();
    this.queueDepth = 0;
    void detail;
  }

  /**
   * Envia um pedido respeitando o deadline. Ao estourar, o worker é encerrado
   * de fato: não fica computação pendente consumindo CPU.
   */
  public async rank(request: EngineWorkerRequest): Promise<EngineWorkerResponse> {
    if (!this.ready || !this.worker) {
      throw new EngineRuntimeError("worker-exited", "worker não está pronto");
    }
    if (this.queueDepth >= this.options.maxQueue) {
      throw new EngineRuntimeError(
        "queue-full",
        `fila cheia (${this.queueDepth}/${this.options.maxQueue})`
      );
    }
    this.queueDepth += 1;
    const worker = this.worker;
    return new Promise<EngineWorkerResponse>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(request.requestId)) {
          this.queueDepth = Math.max(0, this.queueDepth - 1);
        }
        // Interrupção real: encerra o worker e recria sob demanda.
        void this.terminate();
        resolve({
          requestId: request.requestId,
          ok: false,
          error: "deadline-exceeded",
          timings: { deadlineMs: request.deadlineMs },
        });
      }, request.deadlineMs);
      this.pending.set(request.requestId, { requestId: request.requestId, resolve, timer });
      worker.postMessage(request);
    });
  }

  /** Encerra o worker; o próximo `start()` recria. Usado no fallback e no rollback. */
  public async terminate(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    this.ready = false;
    this.failAll("worker-exited", "worker encerrado");
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Encerramento já em curso: nada a fazer.
      }
    }
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Caminho do worker compilado.
 *
 * Prefere o `.mjs` gerado por `cortex:build-worker`; cai para o fonte `.ts`
 * apenas em desenvolvimento, onde o runner de testes consegue executá-lo. O
 * Node do Electron NÃO executa TypeScript — por isso o pacote exige o `.mjs`.
 */
export async function resolveWorkerScript(root = process.cwd()): Promise<string> {
  const compiled = path.join(root, "services", "cortex-engine", "worker-build", "engine-worker.mjs");
  if (await fileExists(compiled)) return compiled;
  return path.join(root, "services", "cortex-engine", "engine-worker.ts");
}
