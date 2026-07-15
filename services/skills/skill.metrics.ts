import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SkillExecutionMetrics } from "./skill.types";

export class SkillMetricsStore {
  constructor(private readonly root = process.cwd()) {}

  private directory() { return path.join(this.root, ".generated", "skills", "executions"); }

  async record(metric: SkillExecutionMetrics): Promise<void> {
    const directory = this.directory();
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, `${metric.id}.json`), `${JSON.stringify(metric, null, 2)}\n`, "utf8");
  }

  async list(skillId?: string, limit = 100): Promise<SkillExecutionMetrics[]> {
    const directory = this.directory();
    try {
      const names = (await readdir(directory)).filter((name) => name.endsWith(".json"));
      const values = await Promise.all(names.map(async (name) => {
        try { return JSON.parse(await readFile(path.join(directory, name), "utf8")) as SkillExecutionMetrics; }
        catch { return null; }
      }));
      return values
        .filter((value): value is SkillExecutionMetrics => Boolean(value) && (!skillId || value!.skillId === skillId))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, Math.min(500, Math.max(1, limit)));
    } catch { return []; }
  }
}

export const skillMetricsStore = new SkillMetricsStore();
