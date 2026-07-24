import type {
  DependencyEdge,
  DependencyGraph,
  ExecutionStep,
} from "./planning.types.ts";

export function createDependencyGraph(
  steps: readonly ExecutionStep[],
): DependencyGraph {
  const nodes = steps.map((step) => step.id);
  assertUnique(nodes, "Execution steps must have unique ids.");
  const nodeSet = new Set(nodes);
  const edges: DependencyEdge[] = [];

  for (const step of steps) {
    assertUnique(
      step.dependencyIds,
      `Execution step "${step.id}" contains duplicate dependencies.`,
    );
    for (const dependencyId of step.dependencyIds) {
      if (dependencyId === step.id) {
        throw new Error(`Execution step "${step.id}" cannot depend on itself.`);
      }
      if (!nodeSet.has(dependencyId)) {
        throw new Error(
          `Execution step "${step.id}" depends on unknown step "${dependencyId}".`,
        );
      }
      edges.push(
        Object.freeze({
          prerequisiteStepId: dependencyId,
          dependentStepId: step.id,
        }),
      );
    }
  }

  edges.sort(compareEdges);
  const topologicalOrder = sortTopologically(nodes, edges);

  return Object.freeze({
    nodes: Object.freeze([...nodes].sort(compareText)),
    edges: Object.freeze(edges),
    topologicalOrder: Object.freeze(topologicalOrder),
  });
}

function sortTopologically(
  nodes: readonly string[],
  edges: readonly DependencyEdge[],
): string[] {
  const inDegree = new Map(nodes.map((node) => [node, 0]));
  const dependents = new Map(nodes.map((node) => [node, [] as string[]]));

  for (const edge of edges) {
    inDegree.set(
      edge.dependentStepId,
      (inDegree.get(edge.dependentStepId) ?? 0) + 1,
    );
    dependents.get(edge.prerequisiteStepId)?.push(edge.dependentStepId);
  }
  for (const values of dependents.values()) {
    values.sort(compareText);
  }

  const ready = nodes
    .filter((node) => inDegree.get(node) === 0)
    .sort(compareText);
  const ordered: string[] = [];

  while (ready.length > 0) {
    const node = ready.shift();
    if (node === undefined) {
      break;
    }
    ordered.push(node);
    for (const dependent of dependents.get(node) ?? []) {
      const remaining = (inDegree.get(dependent) ?? 0) - 1;
      inDegree.set(dependent, remaining);
      if (remaining === 0) {
        ready.push(dependent);
        ready.sort(compareText);
      }
    }
  }

  if (ordered.length !== nodes.length) {
    throw new Error("Dependency graph contains a cycle.");
  }
  return ordered;
}

function compareEdges(left: DependencyEdge, right: DependencyEdge): number {
  return (
    compareText(left.prerequisiteStepId, right.prerequisiteStepId) ||
    compareText(left.dependentStepId, right.dependentStepId)
  );
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right);
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}

