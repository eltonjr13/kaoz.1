import { AbstractAgent } from "../../core/abstract-agent.ts";
import type { AgentCapability } from "../../core/agent-capabilities.ts";
import type { AgentConfig } from "../../core/agent-config.ts";
import type { AgentContext } from "../../core/agent-context.ts";
import { createAgentId } from "../../core/agent-id.ts";
import { CREATIVE_DOMAIN_ID } from "../creative-domain-id.ts";

export const CREATIVE_AGENT_VERSION = "1.0.0";
export const CREATIVE_DOMAIN_NAME = "Creative";

export interface CreativeAgentTask {
  readonly type: string;
  readonly payload?: unknown;
}

export interface CreativeAgentMessage {
  readonly type: string;
  readonly payload?: unknown;
}

export interface CreativeAgentDefinition {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  readonly capabilities: readonly {
    readonly name: string;
    readonly description: string;
  }[];
  readonly executable?: boolean;
}

export class CreativeAgentNotExecutableError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super(
      `Creative agent "${agentId}" is registered as structural infrastructure and cannot execute tasks yet.`,
    );
    this.name = "CreativeAgentNotExecutableError";
    this.agentId = agentId;
  }
}

/**
 * Structural base for the CreativeDomain catalog.
 *
 * Lifecycle, health, heartbeat, metadata and capabilities come from
 * AbstractAgent/BaseAgent. Task and message execution remain disabled.
 */
export abstract class CreativeDomainAgentBase<
  TTask = CreativeAgentTask,
  TTaskResult = never,
  TMessage = CreativeAgentMessage,
  TMessageResult = never,
> extends AbstractAgent<
  TTask,
  TTaskResult,
  TMessage,
  TMessageResult
> {
  readonly domain = CREATIVE_DOMAIN_NAME;
  readonly domainId = CREATIVE_DOMAIN_ID;

  protected constructor(definition: CreativeAgentDefinition) {
    super(createCreativeAgentConfig(definition));
  }

  handleTask(
    _task: TTask,
    _context?: AgentContext,
  ): Promise<TTaskResult> {
    return Promise.reject(
      new CreativeAgentNotExecutableError(this.id),
    );
  }

  handleMessage(
    _message: TMessage,
    _context?: AgentContext,
  ): Promise<TMessageResult> {
    return Promise.reject(
      new CreativeAgentNotExecutableError(this.id),
    );
  }
}

function createCreativeAgentConfig(
  definition: CreativeAgentDefinition,
): AgentConfig {
  return Object.freeze({
    metadata: Object.freeze({
      id: createAgentId(definition.id),
      name: definition.name,
      version: CREATIVE_AGENT_VERSION,
      description: definition.description,
      kind: definition.kind,
      tags: Object.freeze([
        "creative",
        "specialized",
        definition.executable === true ? "active" : "structural",
        `domain:${CREATIVE_DOMAIN_ID}`,
      ]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze(
        definition.capabilities.map((capability) =>
          createCreativeCapability(
            capability,
            definition.executable === true,
          ),
        ),
      ),
    }),
  });
}

function createCreativeCapability(
  input: CreativeAgentDefinition["capabilities"][number],
  executable: boolean,
): AgentCapability {
  return Object.freeze({
    name: input.name,
    version: CREATIVE_AGENT_VERSION,
    description: input.description,
    priority: 50,
    cost: 0,
    expectedLatencyMs: 0,
    dependencies: Object.freeze([]),
    restrictions: executable
      ? Object.freeze([])
      : Object.freeze([
          Object.freeze({
            name: "not-executable",
            description:
              "Capability is registered for discovery but execution is not enabled yet.",
          }),
        ]),
  });
}
