import assert from "node:assert/strict";
import { mkdir, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConversationMemoryStore, LOCAL_PROFILE_ID } from "../services/conversation-memory/conversation-memory.store.ts";
import { isArchiveRecallIntent, recallArchivedConversations } from "../services/conversation-memory/conversation-memory.recall.ts";

async function fixture() {
  const root = path.join(os.tmpdir(), `mrchicken-archive-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return { root, file: path.join(root, "conversation-memory.sqlite3") };
}

test("importacao do Flow e idempotente e persiste apos reinicio", async () => {
  const { root, file } = await fixture();
  let store: ConversationMemoryStore | undefined;
  try {
    store = new ConversationMemoryStore(file);
    const payload = [{ id: "chat-a", title: "Projeto verão", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:01:00.000Z", messages: [
      { id: "u1", role: "user" as const, content: "Decidimos usar iluminação âmbar no cenário", timestamp: "2026-01-01T00:00:00.000Z" },
      { id: "a1", role: "assistant" as const, content: "Combinado.", timestamp: "2026-01-01T00:01:00.000Z" },
    ] }];
    assert.equal(store.importFlowConversations(payload).messages, 2);
    assert.equal(store.importFlowConversations(payload).alreadyImported, true);
    assert.equal(store.stats().messages, 2);
    store.close();
    store = undefined;
    store = new ConversationMemoryStore(file);
    assert.equal(store.stats().messages, 2);
    assert.match(store.search({ query: "iluminacao amb", profileId: LOCAL_PROFILE_ID })[0]?.content || "", /âmbar/);
    store.close();
    store = undefined;
  } finally { store?.close(); await rm(root, { recursive: true, force: true }); }
});

test("busca fria respeita perfil, canal, data e somente roda com intencao de recordacao", async () => {
  const { root, file } = await fixture();
  const store = new ConversationMemoryStore(file);
  try {
    const first = store.upsertMessage({ channel: "telegram", accountId: "bot", externalUserId: "100", externalConversationId: "chat:100", messageId: "1", role: "user", content: "Minha referência de cor é azul petróleo", createdAt: "2026-02-01T00:00:00.000Z" });
    const second = store.upsertMessage({ channel: "telegram", accountId: "bot", externalUserId: "200", externalConversationId: "chat:200", messageId: "2", role: "user", content: "Minha referência de cor é laranja", createdAt: "2026-02-01T00:00:00.000Z" });
    assert.equal(store.search({ query: "referencia cor", profileId: first.profileId }).length, 1);
    assert.equal(store.search({ query: "laranja", profileId: first.profileId }).length, 0);
    assert.equal(store.search({ query: "laranja", profileId: second.profileId, channel: "telegram", from: "2026-01-01", to: "2026-03-01" }).length, 1);
    assert.equal(isArchiveRecallIntent("explique teoria das cores"), false);
    assert.equal(isArchiveRecallIntent("você lembra o que falamos sobre cores?"), true);
    store.linkIdentity(store.listConversations({ profileId: first.profileId })[0].identityId, LOCAL_PROFILE_ID);
    assert.equal(store.search({ query: "petroleo", profileId: LOCAL_PROFILE_ID }).length, 1);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("decimo segundo turno cria um unico job duravel e mensagens concorrentes nao se perdem", async () => {
  const { root, file } = await fixture();
  const first = new ConversationMemoryStore(file);
  const second = new ConversationMemoryStore(file);
  try {
    for (let index = 1; index <= 12; index += 1) {
      const store = index % 2 ? first : second;
      store.upsertMessage({ channel: "flow", externalUserId: LOCAL_PROFILE_ID, externalConversationId: "turns", messageId: `u${index}`, role: "user", content: `Mensagem durável número ${index}` });
    }
    assert.equal(first.stats().messages, 12);
    assert.equal(first.stats().pendingJobs, 1);
    const job = first.claimNextConsolidationJob();
    assert.ok(job);
    first.close();
    second.close();
    const restarted = new ConversationMemoryStore(file);
    assert.equal(restarted.stats().pendingJobs, 1, "job running deve voltar para pending no restart");
    restarted.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("contexto recuperado tem vizinhanca, limite e rotulo de dado nao confiavel", async () => {
  const { root, file } = await fixture();
  const store = new ConversationMemoryStore(file);
  try {
    store.upsertMessage({ channel: "flow", externalUserId: LOCAL_PROFILE_ID, externalConversationId: "old", messageId: "1", role: "user", content: "Vamos decidir o codinome da campanha" });
    store.upsertMessage({ channel: "flow", externalUserId: LOCAL_PROFILE_ID, externalConversationId: "old", messageId: "2", role: "assistant", content: "O codinome ficou Aurora Boreal" });
    const result = recallArchivedConversations({ query: "lembra o codinome da campanha?", profileId: LOCAL_PROFILE_ID, maxTokens: 1200, store });
    assert.match(result.context, /DADOS NAO CONFIAVEIS/);
    assert.match(result.context, /Aurora Boreal/);
    assert.ok(result.hits.length <= 6);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("banco corrompido e preservado e recriado de forma recuperavel", async () => {
  const { root, file } = await fixture();
  try {
    await writeFile(file, "isto nao e sqlite");
    const store = new ConversationMemoryStore(file);
    assert.equal(store.stats().messages, 0);
    store.close();
    assert.ok((await readdir(root)).some((name) => name.startsWith("conversation-memory.sqlite3.corrupt-")));
  } finally { await rm(root, { recursive: true, force: true }); }
});
