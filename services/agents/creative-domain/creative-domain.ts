import type {
  AgentDescriptor,
  AgentRegistration,
} from "../registry/agent-descriptor.ts";
import {
  defineAgentDomain,
  type AgentDomainDefinition,
  type AgentDomainDescriptor,
  type AgentDomainId,
} from "../registry/agent-domain.ts";
import type { AgentRegistry } from "../registry/agent-registry.ts";
import {
  createCreativeDomainContext,
  type CreativeDomainContext,
  type CreativeDomainContextInput,
} from "./creative-domain-context.ts";
import { CREATIVE_DOMAIN_ID } from "./creative-domain-id.ts";

/**
 * Logical boundary for creative agents and contracts.
 *
 * It does not plan, schedule, route messages or generate artifacts.
 */
export class CreativeDomain implements AgentDomainDefinition {
  readonly id: AgentDomainId;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly tags: readonly string[];

  constructor() {
    const definition = defineAgentDomain({
      id: CREATIVE_DOMAIN_ID,
      name: "Creative Domain",
      version: "1.0.0",
      description:
        "Logical grouping for current and future creative agents.",
      tags: ["creative", "domain", "agents"],
    });
    this.id = definition.id;
    this.name = definition.name;
    this.version = definition.version;
    this.description = definition.description;
    this.tags = definition.tags;
    Object.freeze(this);
  }

  register(registry: AgentRegistry): AgentDomainDescriptor {
    return registry.registerDomain(this);
  }

  registerAgent(
    registry: AgentRegistry,
    registration: Omit<AgentRegistration, "domainId">,
  ): AgentDescriptor {
    this.requireRegistered(registry);
    return registry.register({
      ...registration,
      domainId: this.id,
    });
  }

  createContext(
    input: CreativeDomainContextInput,
  ): CreativeDomainContext {
    return createCreativeDomainContext(input);
  }

  contains(descriptor: AgentDescriptor): boolean {
    return descriptor.domainId === this.id;
  }

  private requireRegistered(registry: AgentRegistry): void {
    if (!registry.getDomainById(this.id)) {
      throw new Error(
        `CreativeDomain "${this.id}" must be registered before its agents.`,
      );
    }
  }
}
