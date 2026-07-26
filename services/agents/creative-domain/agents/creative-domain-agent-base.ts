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
export abstract class CreativeDomainAgentBase extends AbstractAgent<
  CreativeAgentTask,
  never,
  CreativeAgentMessage,
  never
> {
  readonly domain = CREATIVE_DOMAIN_NAME;
  readonly domainId = CREATIVE_DOMAIN_ID;

  protected constructor(definition: CreativeAgentDefinition) {
    super(createCreativeAgentConfig(definition));
  }

  handleTask(
    _task: CreativeAgentTask,
    _context?: AgentContext,
  ): Promise<never> {
    return Promise.reject(
      new CreativeAgentNotExecutableError(this.id),
    );
  }

  handleMessage(
    _message: CreativeAgentMessage,
    _context?: AgentContext,
  ): Promise<never> {
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
        "structural",
        `domain:${CREATIVE_DOMAIN_ID}`,
      ]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze(
        definition.capabilities.map((capability) =>
          createDormantCapability(capability),
        ),
      ),
    }),
  });
}

function createDormantCapability(
  input: CreativeAgentDefinition["capabilities"][number],
): AgentCapability {
  return Object.freeze({
    name: input.name,
    version: CREATIVE_AGENT_VERSION,
    description: input.description,
    priority: 50,
    cost: 0,
    expectedLatencyMs: 0,
    dependencies: Object.freeze([]),
    restrictions: Object.freeze([
      Object.freeze({
        name: "not-executable",
        description:
          "Capability is registered for discovery but execution is not enabled yet.",
      }),
    ]),
  });
}
