import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getLocalDataDir } from "../../lib/runtime-paths.ts";
import type {
  AutonomousGoal,
  AutonomousGoalStatus,
  CreateAutonomousGoalInput,
} from "./goal.types.ts";

const DEFAULT_GOALS_FILE = path.join(getLocalDataDir(), "goals.json");

function requireObjective(value: string): string {
  const objective = value.trim();
  if (!objective) throw new Error("O objetivo do /goal é obrigatório.");
  return objective;
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

export class AutonomousGoalStore {
  private mutationTail: Promise<unknown> = Promise.resolve();
  private readonly filePath: string;

  constructor(filePath = DEFAULT_GOALS_FILE) {
    this.filePath = filePath;
  }

  async list(conversationId?: string): Promise<AutonomousGoal[]> {
    const goals = await this.read();
    const normalizedConversationId = normalizeOptional(conversationId);
    return goals
      .filter((goal) => !normalizedConversationId || goal.conversationId === normalizedConversationId)
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }

  async find(goalId: string): Promise<AutonomousGoal | null> {
    const normalizedId = goalId.trim();
    if (!normalizedId) return null;
    return (await this.read()).find((goal) => goal.id === normalizedId) || null;
  }

  async create(input: CreateAutonomousGoalInput): Promise<AutonomousGoal> {
    return this.mutate((goals) => {
      const requestId = normalizeOptional(input.requestId);
      const existing = requestId
        ? goals.find((goal) => goal.requestId === requestId)
        : undefined;
      if (existing) return { goals, value: existing };

      const now = new Date().toISOString();
      const goal: AutonomousGoal = {
        id: crypto.randomUUID(),
        requestId,
        conversationId: normalizeOptional(input.conversationId),
        objective: requireObjective(input.objective),
        autonomyMode: "limited",
        status: "planning",
        createdAt: now,
        updatedAt: now,
      };
      return { goals: [goal, ...goals], value: goal };
    });
  }

  async update(
    goalId: string,
    patch: Partial<Omit<AutonomousGoal, "id" | "createdAt" | "updatedAt">>,
  ): Promise<AutonomousGoal | null> {
    return this.mutate((goals) => {
      const index = goals.findIndex((goal) => goal.id === goalId);
      if (index < 0) return { goals, value: null };

      const updated: AutonomousGoal = {
        ...goals[index],
        ...patch,
        id: goals[index].id,
        createdAt: goals[index].createdAt,
        updatedAt: new Date().toISOString(),
      };
      const next = [...goals];
      next[index] = updated;
      return { goals: next, value: updated };
    });
  }

  async setStatus(
    goalId: string,
    status: AutonomousGoalStatus,
    patch: Partial<Omit<AutonomousGoal, "id" | "createdAt" | "updatedAt" | "status">> = {},
  ): Promise<AutonomousGoal | null> {
    return this.update(goalId, { ...patch, status });
  }

  private async read(): Promise<AutonomousGoal[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as unknown;
      return Array.isArray(parsed) ? parsed as AutonomousGoal[] : [];
    } catch {
      return [];
    }
  }

  private mutate<T>(
    operation: (goals: AutonomousGoal[]) => { goals: AutonomousGoal[]; value: T },
  ): Promise<T> {
    const mutation = this.mutationTail.then(async () => {
      const current = await this.read();
      const result = operation(current);
      if (result.goals !== current) {
        await mkdir(path.dirname(this.filePath), { recursive: true });
        await writeFile(this.filePath, `${JSON.stringify(result.goals, null, 2)}\n`, "utf8");
      }
      return result.value;
    });
    this.mutationTail = mutation.catch(() => undefined);
    return mutation;
  }
}

export const autonomousGoalStore = new AutonomousGoalStore();
