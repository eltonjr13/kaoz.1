import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("persiste o offset do Telegram e nunca o faz regredir", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "mrchicken-telegram-offset-"));
  process.env.MRCHICKEN_DATA_DIR = dataDir;
  try {
    const moduleUrl = new URL(`../services/connectors/connector.store.ts?offset-test=${Date.now()}`, import.meta.url);
    const { ConnectorStore } = await import(moduleUrl.href);
    const store = new ConnectorStore();

    assert.equal(await store.getTelegramPollingOffset("telegram-1:bot-a"), 0);
    assert.equal(await store.saveTelegramPollingOffset("telegram-1:bot-a", 101), 101);

    const restartedStore = new ConnectorStore();
    assert.equal(await restartedStore.getTelegramPollingOffset("telegram-1:bot-a"), 101);
    assert.equal(await restartedStore.saveTelegramPollingOffset("telegram-1:bot-a", 99), 101);
    assert.equal(await restartedStore.getTelegramPollingOffset("telegram-1:bot-b"), 0);
  } finally {
    delete process.env.MRCHICKEN_DATA_DIR;
    await rm(dataDir, { recursive: true, force: true });
  }
});
