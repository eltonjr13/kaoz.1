import { createAgentId, type AgentId } from "../core/agent-id.ts";
import {
  TaskDecomposerAgent,
  createTaskDecomposerAgentConfig,
} from "../decomposition/task-decomposer-agent.ts";
import {
  AgentMessageEndpoint,
  AgentMessageGateway,
  type AgentRuntimeSnapshot,
} from "../messaging/agent-message-gateway.ts";
import type { MessageBus } from "../messaging/message-bus.ts";
import type { PlanGenerator } from "../planning/plan-generator.ts";
import {
  PlannerAgent,
  createPlannerAgentConfig,
  type PlannerClock,
} from "../planning/planner-agent.ts";
import {
  SupervisorAgent,
  createSupervisorAgentConfig,
} from "../supervision/supervisor-agent.ts";
import type { SupervisorClock } from "../supervision/supervision.types.ts";

export interface ChiefAgentMessagingRuntime {
  readonly gateway: AgentMessageGateway;
  readonly plannerId: AgentId;
  readonly decomposerId: AgentId;
  readonly supervisorId: AgentId;
  listAgentRuntimeSnapshots(): readonly AgentRuntimeSnapshot[];
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
}

export interface ChiefAgentMessagingRuntimeOptions {
  readonly bus: MessageBus;
  readonly chiefId: AgentId;
  readonly executionId: string;
  readonly planGenerator: PlanGenerator;
  readonly clock: PlannerClock & SupervisorClock;
  readonly planIdGenerator: () => string;
  readonly supervisionIdGenerator: () => string;
}

/**
 * Composition root for Chief collaborators. Concrete agents are deliberately
 * kept outside ChiefAgent; the Chief sees only addresses and a MessageBus port.
 */
export function createChiefAgentMessagingRuntime(
  options: ChiefAgentMessagingRuntimeOptions,
): ChiefAgentMessagingRuntime {
  const namespace = `${options.chiefId}:${options.executionId}`;
  const planner = new PlannerAgent(options.planGenerator, {
    config: createPlannerAgentConfig({
      id: createAgentId(`${namespace}:planner`),
    }),
    clock: options.clock,
    idGenerator: options.planIdGenerator,
  });
  const decomposer = new TaskDecomposerAgent({
    config: createTaskDecomposerAgentConfig({
      id: createAgentId(`${namespace}:task-decomposer`),
    }),
  });
  const supervisor = new SupervisorAgent({
    config: createSupervisorAgentConfig({
      id: createAgentId(`${namespace}:supervisor`),
    }),
    clock: options.clock,
    idGenerator: options.supervisionIdGenerator,
  });
  const endpoints = [
    new AgentMessageEndpoint(options.bus, planner),
    new AgentMessageEndpoint(options.bus, decomposer),
    new AgentMessageEndpoint(options.bus, supervisor),
  ] as const;

  return {
    gateway: new AgentMessageGateway(options.bus),
    plannerId: planner.id,
    decomposerId: decomposer.id,
    supervisorId: supervisor.id,
    listAgentRuntimeSnapshots(): readonly AgentRuntimeSnapshot[] {
      return Object.freeze(endpoints.map((endpoint) => endpoint.snapshot()));
    },
    async initialize(): Promise<void> {
      const initialized: AgentMessageEndpoint[] = [];
      try {
        for (const endpoint of endpoints) {
          await endpoint.initialize();
          initialized.push(endpoint);
        }
      } catch (error) {
        await Promise.allSettled(
          initialized.reverse().map((endpoint) => endpoint.shutdown()),
        );
        throw error;
      }
    },
    async shutdown(): Promise<void> {
      await Promise.allSettled(
        [...endpoints].reverse().map((endpoint) => endpoint.shutdown()),
      );
    },
  };
}
