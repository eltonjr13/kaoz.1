import crypto from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

export type PendingTransactionalWrite = { target: string; content: string };

export async function transactionalWrite(
  entries: PendingTransactionalWrite[],
  beforeReplace?: (index: number) => Promise<void> | void,
) {
  const id = crypto.randomUUID();
  const prepared = entries.map((entry) => ({
    ...entry,
    temporary: `${entry.target}.${id}.tmp`,
    backup: `${entry.target}.${id}.bak`,
  }));
  const committed: typeof prepared = [];
  const backedUp: typeof prepared = [];
  try {
    for (const entry of prepared) await writeFile(entry.temporary, entry.content, "utf8");
    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index];
      await rename(entry.target, entry.backup).then(() => backedUp.push(entry)).catch(() => undefined);
      await beforeReplace?.(index);
      await rename(entry.temporary, entry.target);
      committed.push(entry);
    }
    await Promise.all(prepared.map((entry) => rm(entry.backup, { force: true })));
  } catch (error) {
    for (const entry of committed.reverse()) await rm(entry.target, { force: true }).catch(() => undefined);
    for (const entry of backedUp.reverse()) await rename(entry.backup, entry.target).catch(() => undefined);
    throw error;
  } finally {
    await Promise.all(prepared.flatMap((entry) => [
      rm(entry.temporary, { force: true }),
      rm(entry.backup, { force: true }),
    ]));
  }
}
