import { AbstractAgent } from "../core/abstract-agent.ts";
import type { AgentConfig } from "../core/agent-config.ts";
import type { AgentContext } from "../core/agent-context.ts";
import { createAgentId, type AgentId } from "../core/agent-id.ts";
import { createExecutionSnapshot } from "./execution-snapshot.ts";
import { DefaultSupervisionActionPlanner } from "./supervision-action-planner.ts";
import { DEFAULT_SUPERVISION_DETECTORS } from "./supervision-detectors.ts";
import type {
  ExecutionSnapshot,
  SupervisionAction,
  SupervisionActionDraft,
  SupervisionActionPlanner,
  SupervisionDetector,
  SupervisionEvidenceValue,
  SupervisionFinding,
  SupervisionIssue,
  SupervisionPolicy,
  SupervisionReport,
  SupervisionSeverity,
  SupervisorClock,
} from "./supervision.types.ts";

export interface SupervisorMessage {
  readonly type: "analyze-execution";
  readonly snapshot: ExecutionSnapshot;
}

export interface SupervisorAgentOptions {
  readonly config?: AgentConfig;
  readonly policy?: Partial<SupervisionPolicy>;
  readonly detectors?: readonly SupervisionDetector[];
  readonly actionPlanner?: SupervisionActionPlanner;
  readonly clock?: SupervisorClock;
  readonly idGenerator?: () => string;
}

export interface SupervisorAgentConfigOptions {
  readonly id?: AgentId;
  readonly name?: string;
  readonly version?: string;
  readonly description?: string;
}

const DEFAULT_POLICY: SupervisionPolicy = Object.freeze({
  inactiveAgentAfterMs: 60_000,
  stuckTaskAfterMs: 300_000,
  loopTransitionThreshold: 3,
  cancelOnDeadlock: true,
  cancelOnLoop: false,
});

const systemClock: SupervisorClock = Object.freeze({
  now: () => new Date(),
});

/**
 * Analyzes immutable execution snapshots and emits declarative actions.
 * It never restarts agents, reassigns tasks or cancels executions itself.
 */
export class SupervisorAgent extends AbstractAgent<
  ExecutionSnapshot,
  SupervisionReport,
  SupervisorMessage,
  SupervisionReport
> {
  private readonly policy: SupervisionPolicy;
  private readonly detectors: readonly SupervisionDetector[];
  private readonly actionPlanner: SupervisionActionPlanner;
  private readonly clock: SupervisorClock;
  private readonly idGenerator: () => string;

  constructor(options: SupervisorAgentOptions = {}) {
    const config = options.config ?? createSupervisorAgentConfig();
    assertSupervisionCapability(config);
    super(config);
    this.policy = resolvePolicy(options.policy);
    this.detectors = Object.freeze([
      ...(options.detectors ?? DEFAULT_SUPERVISION_DETECTORS),
    ]);
    assertUniqueDetectorTypes(this.detectors);
    this.actionPlanner =
      options.actionPlanner ?? new DefaultSupervisionActionPlanner();
    this.clock = options.clock ?? systemClock;
    this.idGenerator = options.idGenerator ?? defaultId;
  }

  async handleTask(
    snapshotInput: ExecutionSnapshot,
    _context?: AgentContext,
  ): Promise<SupervisionReport> {
    this.assertReady();
    const snapshot = createExecutionSnapshot(snapshotInput);
    const analyzedAt = this.clock.now().toISOString();
    const findings = this.detectors
      .flatMap((detector) => detector.detect(snapshot, this.policy))
      .map(freezeFinding)
      .sort(compareFindings);
    const issues = findings.map((finding) =>
      createIssue(this.idGenerator(), snapshot, finding)
    );
    assertUniqueIds(issues, "Supervision issues");

    const actions = deduplicateActionDrafts(
      issues.flatMap((issue) =>
        this.actionPlanner
          .plan(issue, snapshot, this.policy)
          .map((draft) => ({ issue, draft }))
      ),
    ).map(({ issue, draft }) =>
      createAction(this.idGenerator(), snapshot, analyzedAt, issue, draft)
    );
    assertUniqueIds(actions, "Supervision actions");

    return Object.freeze({
      id: requireText(this.idGenerator(), "Supervision report id"),
      executionId: snapshot.executionId,
      planId: snapshot.planId,
      planVersion: snapshot.planVersion,
      analyzedAt,
      healthy: issues.length === 0,
      issues: Object.freeze(issues),
      actions: Object.freeze(actions),
    });
  }

  handleMessage(
    message: SupervisorMessage,
    context?: AgentContext,
  ): Promise<SupervisionReport> {
    if (message?.type !== "analyze-execution" || !message.snapshot) {
      return Promise.reject(
        new Error("SupervisorAgent only accepts analyze-execution messages."),
      );
    }
    return this.handleTask(message.snapshot, context);
  }

  private assertReady(): void {
    if (this.state.status !== "ready") {
      throw new Error(
        `SupervisorAgent "${this.id}" must be ready before analyzing executions.`,
      );
    }
  }
}

export function createSupervisorAgentConfig(
  options: SupervisorAgentConfigOptions = {},
): AgentConfig {
  return Object.freeze({
    metadata: Object.freeze({
      id: options.id ?? createAgentId("supervisor-agent"),
      name: options.name?.trim() || "Supervisor Agent",
      version: options.version?.trim() || "1.0.0",
      description:
        options.description?.trim() ||
        "Detects execution anomalies and proposes recovery actions.",
      kind: "supervisor",
      tags: Object.freeze(["supervision", "recovery", "infrastructure"]),
    }),
    capabilities: Object.freeze({
      items: Object.freeze([
        Object.freeze({
          name: "execution-supervision",
          version: "1.0.0",
          description: "Analyzes execution snapshots and proposes recovery actions.",
          priority: 100,
          cost: 0,
          expectedLatencyMs: 0,
          dependencies: Object.freeze([]),
          restrictions: Object.freeze([
            Object.freeze({
              name: "no-action-execution",
              description: "Recovery actions are declarative and never executed.",
            }),
          ]),
        }),
      ]),
    }),
  });
}

function createIssue(
  id: string,
  snapshot: ExecutionSnapshot,
  finding: SupervisionFinding,
): SupervisionIssue {
  return Object.freeze({
    id: requireText(id, "Supervision issue id"),
    executionId: snapshot.executionId,
    detectedAt: snapshot.capturedAt,
    ...finding,
  });
}

function createAction(
  id: string,
  snapshot: ExecutionSnapshot,
  createdAt: string,
  issue: SupervisionIssue,
  draft: SupervisionActionDraft,
): SupervisionAction {
  assertPriority(draft.priority);
  return Object.freeze({
    id: requireText(id, "Supervision action id"),
    issueId: issue.id,
    executionId: snapshot.executionId,
    createdAt,
    type: draft.type,
    reason: requireText(draft.reason, "Supervision action reason"),
    priority: draft.priority,
    taskId: draft.taskId
      ? requireText(draft.taskId, "Supervision action taskId")
      : undefined,
    agentId: draft.agentId ? createAgentId(draft.agentId) : undefined,
  });
}

function freezeFinding(finding: SupervisionFinding): SupervisionFinding {
  return Object.freeze({
    type: finding.type,
    severity: finding.severity,
    message: requireText(finding.message, "Supervision finding message"),
    taskIds: Object.freeze(uniqueSorted(finding.taskIds)),
    agentIds: Object.freeze(
      [...new Set(finding.agentIds)]
        .map(createAgentId)
        .sort((left, right) => String(left).localeCompare(String(right))),
    ),
    evidence: freezeEvidence(finding.evidence),
  });
}

function freezeEvidence(
  evidence: Readonly<Record<string, SupervisionEvidenceValue>>,
): Readonly<Record<string, SupervisionEvidenceValue>> {
  const result: Record<string, SupervisionEvidenceValue> = {};
  for (const [key, value] of Object.entries(evidence)) {
    result[key] = Array.isArray(value)
      ? Object.freeze([...value])
      : value;
  }
  return Object.freeze(result);
}

function deduplicateActionDrafts(
  values: readonly {
    readonly issue: SupervisionIssue;
    readonly draft: SupervisionActionDraft;
  }[],
): readonly {
  readonly issue: SupervisionIssue;
  readonly draft: SupervisionActionDraft;
}[] {
  const seen = new Set<string>();
  return values.filter(({ draft }) => {
    const key = [
      draft.type,
      draft.taskId ?? "",
      draft.agentId ?? "",
    ].join("\u0000");
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function compareFindings(
  left: SupervisionFinding,
  right: SupervisionFinding,
): number {
  return (
    severityRank(right.severity) - severityRank(left.severity) ||
    left.type.localeCompare(right.type) ||
    (left.taskIds[0] ?? "").localeCompare(right.taskIds[0] ?? "") ||
    String(left.agentIds[0] ?? "").localeCompare(
      String(right.agentIds[0] ?? ""),
    )
  );
}

function severityRank(severity: SupervisionSeverity): number {
  return {
    low: 1,
    medium: 2,
    high: 3,
    critical: 4,
  }[severity];
}

function resolvePolicy(
  input: Partial<SupervisionPolicy> | undefined,
): SupervisionPolicy {
  return Object.freeze({
    inactiveAgentAfterMs: positiveFinite(
      input?.inactiveAgentAfterMs ?? DEFAULT_POLICY.inactiveAgentAfterMs,
      "Supervision inactiveAgentAfterMs",
    ),
    stuckTaskAfterMs: positiveFinite(
      input?.stuckTaskAfterMs ?? DEFAULT_POLICY.stuckTaskAfterMs,
      "Supervision stuckTaskAfterMs",
    ),
    loopTransitionThreshold: positiveInteger(
      input?.loopTransitionThreshold ??
        DEFAULT_POLICY.loopTransitionThreshold,
      "Supervision loopTransitionThreshold",
    ),
    cancelOnDeadlock:
      input?.cancelOnDeadlock ?? DEFAULT_POLICY.cancelOnDeadlock,
    cancelOnLoop: input?.cancelOnLoop ?? DEFAULT_POLICY.cancelOnLoop,
  });
}

function assertSupervisionCapability(config: AgentConfig): void {
  if (
    !config.capabilities.items.some(
      (capability) => capability.name === "execution-supervision",
    )
  ) {
    throw new Error(
      'SupervisorAgent config must declare the "execution-supervision" capability.',
    );
  }
}

function assertUniqueDetectorTypes(
  detectors: readonly SupervisionDetector[],
): void {
  if (new Set(detectors.map((detector) => detector.type)).size !== detectors.length) {
    throw new Error("SupervisorAgent detectors must have unique types.");
  }
}

function assertUniqueIds(
  values: readonly { readonly id: string }[],
  label: string,
): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    throw new Error(`${label} must have unique ids.`);
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function assertPriority(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error("Supervision action priority must be an integer between 0 and 100.");
  }
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return value;
}

function requireText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }
  return normalized;
}

function defaultId(): string {
  return `supervision-${globalThis.crypto.randomUUID()}`;
}

