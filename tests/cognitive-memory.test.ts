import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { detectChatMemoryCommand, extractChatMemoryCandidates } from '../lib/cognitive-memory/chat/ChatMemoryExtractor.ts';
import { ChatMemoryService, LOCAL_MEMORY_USER_ID } from '../lib/cognitive-memory/chat/ChatMemoryService.ts';
import { JsonStorageProvider } from '../lib/cognitive-memory/storage/JsonStorageProvider.ts';

function testStore() {
  const root = path.join(os.tmpdir(), `mrchicken-memory-${crypto.randomUUID()}`);
  return {
    root,
    file: path.join(root, 'cognitive-memory.json'),
    service: new ChatMemoryService(new JsonStorageProvider(path.join(root, 'cognitive-memory.json')))
  };
}

test('preferencia explicita atravessa conversas e avatares por significado', async () => {
  const store = testStore();
  try {
    const candidates = extractChatMemoryCandidates('salve na memória; eu gosto de abacate', '', {
      avatarId: 'avatar-a',
      sessionId: 'chat-a'
    });
    assert.equal(detectChatMemoryCommand('salve na memória; eu gosto de abacate').type, 'save');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].explicit, true);
    assert.equal(candidates[0].scope, 'user');
    assert.ok(candidates[0].tags.includes('fruta'));

    await store.service.saveChatMemoryCandidates(candidates, {
      userId: LOCAL_MEMORY_USER_ID,
      avatarId: 'avatar-a',
      sessionId: 'chat-a'
    });

    const recalled = await store.service.buildPromptContext('qual fruta eu gosto?', {
      userId: LOCAL_MEMORY_USER_ID,
      avatarId: 'avatar-b',
      sessionId: 'chat-b'
    });
    assert.match(recalled.personalFacts, /abacate/i);
  } finally {
    await rm(store.root, { recursive: true, force: true });
  }
});

test('armazenamento migra o arquivo legado para o destino persistente', async () => {
  const root = path.join(os.tmpdir(), `mrchicken-memory-migration-${crypto.randomUUID()}`);
  const legacyFile = path.join(root, 'legacy', 'cognitive-memory.json');
  const targetFile = path.join(root, 'persistent', 'cognitive-memory.json');
  try {
    await mkdir(path.dirname(legacyFile), { recursive: true });
    await writeFile(legacyFile, JSON.stringify({
      episodic: { nodes: [] },
      procedural: { rules: [] },
      semantic: { nodes: [], edges: [] },
      chat: { memories: [] }
    }), 'utf8');
    const provider = new JsonStorageProvider(targetFile, legacyFile);
    await provider.readMemory();
    const migrated = JSON.parse(await readFile(targetFile, 'utf8'));
    assert.deepEqual(migrated.chat.memories, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('correcao substitui a memoria ativa e preserva historico', async () => {
  const store = testStore();
  try {
    await store.service.saveChatMemoryCandidates(
      extractChatMemoryCandidates('salve na memória; gosto de abacate'),
      { userId: LOCAL_MEMORY_USER_ID, sessionId: 'chat-a' }
    );
    const correction = extractChatMemoryCandidates('na verdade gosto de manga, não de abacate');
    assert.deepEqual(correction[0].supersedeHints, ['abacate']);
    await store.service.saveChatMemoryCandidates(correction, {
      userId: LOCAL_MEMORY_USER_ID,
      sessionId: 'chat-b'
    });

    const history = await store.service.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      includeHistory: true
    });
    assert.equal(history.find((memory) => /abacate/i.test(memory.content))?.status, 'superseded');
    assert.equal(history.find((memory) => /manga/i.test(memory.content))?.status, 'active');
    const recalled = await store.service.buildPromptContext('qual fruta eu gosto?', { userId: LOCAL_MEMORY_USER_ID });
    assert.doesNotMatch(recalled.personalFacts, /abacate/i);
    assert.match(recalled.personalFacts, /manga/i);
  } finally {
    await rm(store.root, { recursive: true, force: true });
  }
});

test('esquecer por categoria remove conteudo e evidencias', async () => {
  const store = testStore();
  try {
    await store.service.saveChatMemoryCandidates(
      extractChatMemoryCandidates('salve na memória; gosto de manga'),
      { userId: LOCAL_MEMORY_USER_ID }
    );
    const command = detectChatMemoryCommand('esqueça qual fruta eu gosto');
    const forgotten = await store.service.forgetMemories(command.target, { userId: LOCAL_MEMORY_USER_ID });
    assert.equal(forgotten, 1);
    const all = await store.service.listActiveChatMemories({ userId: LOCAL_MEMORY_USER_ID, includeHistory: true });
    assert.equal(all.length, 0);
  } finally {
    await rm(store.root, { recursive: true, force: true });
  }
});

test('memoria de sessao nao vaza e Cortex desligado nao grava', async () => {
  const store = testStore();
  try {
    const sessionCandidate = extractChatMemoryCandidates('salve na memória; gosto de canela', '', { defaultScope: 'session' });
    await store.service.saveChatMemoryCandidates(sessionCandidate, {
      userId: LOCAL_MEMORY_USER_ID,
      sessionId: 'chat-a'
    });
    await store.service.saveChatMemoryCandidates(
      extractChatMemoryCandidates('salve na memória; gosto de kiwi'),
      { userId: LOCAL_MEMORY_USER_ID, cortexEnabled: false }
    );
    const same = await store.service.buildPromptContext('o que eu gosto?', { userId: LOCAL_MEMORY_USER_ID, sessionId: 'chat-a' });
    const other = await store.service.buildPromptContext('o que eu gosto?', { userId: LOCAL_MEMORY_USER_ID, sessionId: 'chat-b' });
    assert.match(same.contextualFacts, /canela/i);
    assert.doesNotMatch(other.contextualFacts, /canela/i);
    assert.doesNotMatch(`${other.personalFacts}${other.contextualFacts}`, /kiwi/i);
  } finally {
    await rm(store.root, { recursive: true, force: true });
  }
});

test('conteudo sensivel e bloqueado e gravacoes concorrentes nao se sobrescrevem', async () => {
  const store = testStore();
  try {
    const sensitive = extractChatMemoryCandidates('salve na memória: minha senha é super-secreta');
    const blocked = await store.service.saveChatMemoryCandidates(sensitive, { userId: LOCAL_MEMORY_USER_ID });
    assert.equal(blocked.blockedSensitive, true);

    await Promise.all(Array.from({ length: 20 }, (_, index) => {
      const candidates = extractChatMemoryCandidates(`salve na memória; gosto de item-${index}`);
      const independentService = new ChatMemoryService(new JsonStorageProvider(store.file));
      return independentService.saveChatMemoryCandidates(candidates, { userId: LOCAL_MEMORY_USER_ID });
    }));
    const all = await store.service.listActiveChatMemories({ userId: LOCAL_MEMORY_USER_ID, includeHistory: true });
    assert.equal(all.filter((memory) => /item-/i.test(memory.content)).length, 20);
  } finally {
    await rm(store.root, { recursive: true, force: true });
  }
});
