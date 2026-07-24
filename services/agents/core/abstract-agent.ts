import {
  defineAgentCapabilities,
  type AgentCapabilities,
} from "./agent-capabilities.ts";
import type { AgentConfig } from "./agent-config.ts";
import type { AgentContext } from "./agent-context.ts";
import type { AgentHealth, AgentHealthStatus, AgentHeartbeat } from "./agent-health.ts";
import type { AgentId } from "./agent-id.ts";
import type { AgentMetadata } from "./agent-metadata.ts";
import type { AgentState } from "./agent-state.ts";
import type { AgentStatus } from "./agent-status.ts";
import type { BaseAgent } from "./base-agent.ts";

type AgentStatePatch = Partial<
  Omit<AgentState, "status" | "statusChangedAt" | "updatedAt">
>;

export abstract class AbstractAgent<
  TTask = unknown,
  TTaskResult = unknown,
  TMessage = unknown,
  TMessageResult = unknown,
> implements BaseAgent<TTask, TTaskResult, TMessage, TMessageResult> {
  protected readonly config: AgentConfig;

  private readonly metadata: AgentMetadata;
  private readonly capabilities: AgentCapabilities;
  private currentState: AgentState;

  constructor(config: AgentConfig) {
    this.config = config;
    this.metadata = freezeMetadata(config.metadata);
    this.capabilities = defineAgentCapabilities(config.capabilities.items);

    const timestamp = this.timestamp();
    this.currentState = freezeState({
      status: "created",
      statusChangedAt: timestamp,
      updatedAt: timestamp,
    });
  }

  get id(): AgentId {
    return this.metadata.id;
  }

  get state(): Readonly<AgentState> {
    return this.currentState;
  }

  async initialize(): Promise<void> {
    if (this.currentState.status === "ready" || this.currentState.status === "paused") {
      return;
    }

    this.assertStatus("initialize", ["created", "stopped"]);
    this.transitionTo("initializing");

    try {
      await this.onInitialize();
      const timestamp = this.timestamp();
      this.transitionTo("ready", {
        initializedAt: timestamp,
        pausedAt: undefined,
        stoppedAt: undefined,
        lastError: undefined,
      });
    } catch (error) {
      this.transitionToFailure(error);
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.currentState.status === "stopped") {
      return;
    }

    if (this.currentState.status === "created") {
      this.transitionTo("stopped", { stoppedAt: this.timestamp() });
      return;
    }

    this.assertStatus("shutdown", ["ready", "paused", "failed"]);
    this.transitionTo("stopping");

    try {
      await this.onShutdown();
      this.transitionTo("stopped", {
        stoppedAt: this.timestamp(),
        lastError: undefined,
      });
    } catch (error) {
      this.transitionToFailure(error);
      throw error;
    }
  }

  async pause(): Promise<void> {
    if (this.currentState.status === "paused") {
      return;
    }

    this.assertStatus("pause", ["ready"]);
    this.transitionTo("pausing");

    try {
      await this.onPause();
      this.transitionTo("paused", { pausedAt: this.timestamp() });
    } catch (error) {
      this.transitionToFailure(error);
      throw error;
    }
  }

  async resume(): Promise<void> {
    if (this.currentState.status === "ready") {
      return;
    }

    this.assertStatus("resume", ["paused"]);
    this.transitionTo("resuming");

    try {
      await this.onResume();
      this.transitionTo("ready", { pausedAt: undefined });
    } catch (error) {
      this.transitionToFailure(error);
      throw error;
    }
  }

  async heartbeat(): Promise<AgentHeartbeat> {
    const timestamp = this.timestamp();
    this.currentState = freezeState({
      ...this.currentState,
      lastHeartbeatAt: timestamp,
      updatedAt: timestamp,
    });

    return {
      agentId: this.id,
      status: this.currentState.status,
      timestamp,
    };
  }

  async health(): Promise<AgentHealth> {
    return {
      agentId: this.id,
      status: this.resolveHealthStatus(),
      lifecycleStatus: this.currentState.status,
      checkedAt: this.timestamp(),
      lastHeartbeatAt: this.currentState.lastHeartbeatAt,
    };
  }

  getCapabilities(): AgentCapabilities {
    return this.capabilities;
  }

  getMetadata(): AgentMetadata {
    return this.metadata;
  }

  abstract handleTask(task: TTask, context?: AgentContext): Promise<TTaskResult>;

  abstract handleMessage(
    message: TMessage,
    context?: AgentContext,
  ): Promise<TMessageResult>;

  protected onInitialize(): Promise<void> {
    return Promise.resolve();
  }

  protected onShutdown(): Promise<void> {
    return Promise.resolve();
  }

  protected onPause(): Promise<void> {
    return Promise.resolve();
  }

  protected onResume(): Promise<void> {
    return Promise.resolve();
  }

  private assertStatus(operation: string, allowedStatuses: readonly AgentStatus[]): void {
    if (!allowedStatuses.includes(this.currentState.status)) {
      throw new Error(
        `Cannot ${operation} agent "${this.id}" while status is "${this.currentState.status}".`,
      );
    }
  }

  private transitionTo(status: AgentStatus, patch: AgentStatePatch = {}): void {
    const timestamp = this.timestamp();
    this.currentState = freezeState({
      ...this.currentState,
      ...patch,
      status,
      statusChangedAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private transitionToFailure(error: unknown): void {
    const timestamp = this.timestamp();
    const normalizedError = normalizeError(error);
    this.transitionTo("failed", {
      lastError: {
        name: normalizedError.name,
        message: normalizedError.message,
        occurredAt: timestamp,
      },
    });
  }

  private resolveHealthStatus(): AgentHealthStatus {
    if (this.currentState.status === "ready") {
      return "healthy";
    }
    if (this.currentState.status === "failed") {
      return "unhealthy";
    }
    return "degraded";
  }

  private timestamp(): string {
    return new Date().toISOString();
  }
}

function normalizeError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  return new Error(String(error));
}

function freezeMetadata(metadata: AgentMetadata): AgentMetadata {
  return Object.freeze({
    ...metadata,
    tags: metadata.tags ? Object.freeze([...metadata.tags]) : undefined,
  });
}

function freezeState(state: AgentState): AgentState {
  return Object.freeze({
    ...state,
    lastError: state.lastError
      ? Object.freeze({ ...state.lastError })
      : undefined,
  });
}
