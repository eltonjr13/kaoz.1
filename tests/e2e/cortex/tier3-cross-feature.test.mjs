/**
 * Tier 3: Cross-Feature Interactions
 *
 * Covers pairwise and multi-system integration:
 * - Memory + Graph synchronization
 * - Conversation deletion with memory cascade (forgetDerived = true vs false)
 * - Identity linking and unlinking with selective memory purge
 * - Procedural rules + Episodic memory feedback loop
 * - Flow import + SQLite archiving + FTS5 full-text recall
 * - Hot working memory budget + Cold archive deep recall coexistence
 * - Semantic graph component clustering + Overview stats alignment
 * - Memory correction lineage across identity re-attribution
 */

import {
  assert,
  createTestSuite,
  createTempUnifiedContext,
  LOCAL_MEMORY_USER_ID,
  LOCAL_PROFILE_ID,
  extractChatMemoryCandidates,
  computeConnectedComponents,
  recallArchivedConversations,
  isArchiveRecallIntent,
} from './harness.mjs';

const suite = createTestSuite(
  3,
  'Cross-Feature Interactions',
  'Pairwise and multi-subsystem integration: Memory + Graph, Conversation Cascade, Identity Link/Unlink'
);

// ---------------------------------------------------------------------------
// X01. Memory + Graph Synchronization
// ---------------------------------------------------------------------------
suite.test('X01: Memory + Graph Synchronization — Concepts in memory correlate with graph nodes', async () => {
  const ctx = await createTempUnifiedContext({
    episodic: { nodes: [] },
    procedural: { rules: [] },
    semantic: {
      nodes: [
        {
          id: 'concept:model-gemini',
          label: 'Gemini 2.5 Flash',
          type: 'entity',
          confidenceScore: 0.9,
          lastObserved: new Date().toISOString()
        }
      ],
      edges: []
    },
    chat: { memories: [] }
  });

  try {
    // Save memory referencing Gemini model
    const candidate = {
      ...extractChatMemoryCandidates('salve na memória; prefiro usar o modelo Gemini Flash')[0],
      canonicalKey: 'tool:model-gemini',
      tags: ['model', 'gemini']
    };
    await ctx.chatService.saveChatMemoryCandidates([candidate], { userId: LOCAL_MEMORY_USER_ID });

    // Update graph node confidence based on reinforced user preference
    await ctx.jsonProvider.updateMemory((data) => {
      const node = data.semantic.nodes.find((n) => n.id === 'concept:model-gemini');
      if (node) {
        node.confidenceScore = 1.0;
        node.metadata = { userPreferred: true };
      }
    });

    const memoryData = await ctx.jsonProvider.readMemory();
    const geminiNode = memoryData.semantic.nodes.find((n) => n.id === 'concept:model-gemini');
    assert.ok(geminiNode);
    assert.equal(geminiNode.confidenceScore, 1.0);
    assert.equal(geminiNode.metadata.userPreferred, true);

    const activeMemories = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_MEMORY_USER_ID });
    assert.equal(activeMemories.length, 1);
    assert.ok(activeMemories[0].tags.includes('gemini'));
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X02. Conversation Delete with Memory Cascade (forgetDerived = true)
// ---------------------------------------------------------------------------
suite.test('X02: Conversation Delete with Memory Cascade (forgetDerived = true) purges derived memories', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    const channelInput = {
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'chat-cascade-true'
    };

    const msgResult = ctx.conversationStore.upsertMessage({
      ...channelInput,
      messageId: 'msg-evidence-1',
      role: 'user',
      content: 'Minha cor favorita é azul cerúleo'
    });

    const convId = ctx.conversationStore.resolveConversationId('flow', '', 'chat-cascade-true');
    const msgId = msgResult.message.id;

    // Create a memory with evidenceRef pointing to this message
    const candidate = {
      ...extractChatMemoryCandidates('Minha cor favorita é azul cerúleo', '', { source: 'archive_consolidation' })[0],
      evidenceRefs: [{ conversationId: convId, messageId: msgId }]
    };
    await ctx.chatService.saveChatMemoryCandidates([candidate], { userId: LOCAL_PROFILE_ID });

    const beforeMemories = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
    assert.equal(beforeMemories.length, 1);

    // Delete conversation with forgetDerived = true
    const deleteResult = ctx.conversationStore.deleteConversation(convId);
    assert.equal(deleteResult.deleted, true);

    const forgottenCount = await ctx.chatService.forgetMemoriesByEvidence(deleteResult.messageIds, LOCAL_PROFILE_ID);
    assert.equal(forgottenCount, 1, 'Derived memory must be forgotten when forgetDerived=true');

    const afterMemories = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
    assert.equal(afterMemories.length, 0);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X03. Conversation Delete without Memory Cascade (forgetDerived = false)
// ---------------------------------------------------------------------------
suite.test('X03: Conversation Delete without Cascade (forgetDerived = false) preserves derived memories', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    const channelInput = {
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'chat-cascade-false'
    };

    const msgResult = ctx.conversationStore.upsertMessage({
      ...channelInput,
      messageId: 'msg-evidence-2',
      role: 'user',
      content: 'Eu sou diretor de arte em publicidade'
    });

    const convId = ctx.conversationStore.resolveConversationId('flow', '', 'chat-cascade-false');
    const msgId = msgResult.message.id;

    // Create a memory with evidenceRef pointing to this message
    const candidate = {
      ...extractChatMemoryCandidates('salve na memória; eu sou diretor de arte em publicidade', '', { source: 'archive_consolidation' })[0],
      evidenceRefs: [{ conversationId: convId, messageId: msgId }]
    };
    await ctx.chatService.saveChatMemoryCandidates([candidate], { userId: LOCAL_PROFILE_ID });

    // Delete conversation with forgetDerived = false (do not call forgetMemoriesByEvidence)
    const deleteResult = ctx.conversationStore.deleteConversation(convId);
    assert.equal(deleteResult.deleted, true);

    const afterMemories = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
    assert.equal(afterMemories.length, 1, 'Derived memory must be preserved when forgetDerived=false');
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X04. Identity Linking Reassigns Profile and Retargets Memories
// ---------------------------------------------------------------------------
suite.test('X04: Identity Linking Reassigns Profile and Retargets Memories to local-user', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    const extUserId = 'telegram-user-404';
    ctx.conversationStore.upsertMessage({
      channel: 'telegram',
      accountId: 'bot',
      externalUserId: extUserId,
      externalConversationId: 'tg-chat-profile',
      messageId: 'tg-msg-1',
      role: 'user',
      content: 'Meu nome profissional é Gabriel'
    });

    const identities = ctx.conversationStore.listIdentities();
    const tgIdentity = identities.find((i) => i.externalUserId === extUserId);
    assert.ok(tgIdentity);

    // Save memory under the identity's effectiveProfileId before linking
    const candidate = extractChatMemoryCandidates('salve na memória; meu nome profissional é Gabriel')[0];
    await ctx.chatService.saveChatMemoryCandidates([candidate], { userId: tgIdentity.effectiveProfileId });

    // Link identity to local profile
    ctx.conversationStore.linkIdentity(tgIdentity.id, LOCAL_PROFILE_ID);
    const migrationResult = await ctx.chatService.reassignUserMemories(tgIdentity.effectiveProfileId, LOCAL_PROFILE_ID);

    assert.equal(migrationResult.moved, 1);

    // Verify memory is now recalled under local-user profile
    const context = await ctx.chatService.buildPromptContext('qual é meu nome?', { userId: LOCAL_PROFILE_ID });
    assert.match(context.personalFacts, /Gabriel/);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X05. Identity Unlinking with Selective Memory Purge
// ---------------------------------------------------------------------------
suite.test('X05: Identity Unlinking with Selective Memory Purge removes only channel-derived memories', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    // 1. Message from Telegram
    const tgMsg = ctx.conversationStore.upsertMessage({
      channel: 'telegram',
      accountId: 'bot',
      externalUserId: 'tg-user-selective',
      externalConversationId: 'tg-chat-selective',
      messageId: 'tg-m1',
      role: 'user',
      content: 'Fato vindo do Telegram'
    });

    // 2. Message from Flow
    ctx.conversationStore.upsertMessage({
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'flow-chat-selective',
      messageId: 'flow-m1',
      role: 'user',
      content: 'Fato nativo do Flow'
    });

    const identities = ctx.conversationStore.listIdentities();
    const tgId = identities.find((i) => i.externalUserId === 'tg-user-selective').id;

    // Link TG to local profile
    ctx.conversationStore.linkIdentity(tgId, LOCAL_PROFILE_ID);

    // Create 2 memories: one from TG message evidence, one native
    const tgCandidate = {
      ...extractChatMemoryCandidates('salve na memória; fato vindo do telegram')[0],
      evidenceRefs: [{ conversationId: tgMsg.message.conversationId, messageId: tgMsg.message.id }]
    };
    const flowCandidate = extractChatMemoryCandidates('salve na memória; fato nativo do flow')[0];

    await ctx.chatService.saveChatMemoryCandidates([tgCandidate, flowCandidate], { userId: LOCAL_PROFILE_ID });

    assert.equal((await ctx.chatService.listActiveChatMemories({ userId: LOCAL_PROFILE_ID })).length, 2);

    // Unlink TG identity with forgetDerived = true
    ctx.conversationStore.unlinkIdentity(tgId);
    const tgMessageIds = ctx.conversationStore.listMessageIdsForIdentity(tgId);
    const forgotten = await ctx.chatService.forgetMemoriesByEvidence(tgMessageIds, LOCAL_PROFILE_ID);

    assert.equal(forgotten, 1, 'Only the 1 memory with TG evidence should be forgotten');

    const remaining = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
    assert.equal(remaining.length, 1);
    assert.match(remaining[0].content, /fato nativo do flow/i);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X06. Procedural Rules + Episodic Memory Feedback Loop
// ---------------------------------------------------------------------------
suite.test('X06: Procedural Rules + Episodic Memory Feedback Loop informs prompt instructions', async () => {
  const ctx = await createTempUnifiedContext({
    episodic: {
      nodes: [
        { id: 'ep-render-fail', jobId: 'job-999', feedback: 'bad', lastObserved: new Date().toISOString() }
      ]
    },
    procedural: {
      rules: [
        {
          id: 'rule:render-guardrail',
          instruction: 'Ao gerar vídeo acima de 4K, reduza framerate para 30fps para evitar falhas',
          priority: 2
        }
      ]
    },
    semantic: { nodes: [], edges: [] },
    chat: { memories: [] }
  });

  try {
    const memory = await ctx.jsonProvider.readMemory();
    const badEpisodes = memory.episodic.nodes.filter((n) => n.feedback === 'bad');
    assert.equal(badEpisodes.length, 1);

    const activeRules = memory.procedural.rules;
    assert.equal(activeRules.length, 1);
    assert.match(activeRules[0].instruction, /30fps/);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X07. Flow Import + SQLite Archiving + FTS5 Full-Text Recall
// ---------------------------------------------------------------------------
suite.test('X07: Flow Import is idempotent and immediately indexable by FTS5', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    const flowPayload = [
      {
        id: 'flow-import-project-1',
        title: 'Lançamento de Produto Q3',
        createdAt: '2026-03-01T10:00:00.000Z',
        updatedAt: '2026-03-01T10:05:00.000Z',
        messages: [
          {
            id: 'f-msg-1',
            role: 'user',
            content: 'Nosso público-alvo são jovens criadores de conteúdo tech',
            timestamp: '2026-03-01T10:00:00.000Z'
          },
          {
            id: 'f-msg-2',
            role: 'assistant',
            content: 'Perfeito, vamos focar a estética em cyberpunk minimalista.',
            timestamp: '2026-03-01T10:01:00.000Z'
          }
        ]
      }
    ];

    // First import
    const firstImport = ctx.conversationStore.importFlowConversations(flowPayload);
    assert.equal(firstImport.messages, 2);
    assert.equal(firstImport.conversations, 1);

    // Second import (idempotent)
    const secondImport = ctx.conversationStore.importFlowConversations(flowPayload);
    assert.equal(secondImport.alreadyImported, true);
    assert.equal(ctx.conversationStore.stats().messages, 2);

    // Immediately search via FTS5
    const hits = ctx.conversationStore.search({ query: 'criadores conteudo tech', profileId: LOCAL_PROFILE_ID });
    assert.equal(hits.length, 1);
    assert.match(hits[0].content, /jovens criadores de conteúdo tech/);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X08. Hot Memory Budget + Archive Deep Recall Coexistence
// ---------------------------------------------------------------------------
suite.test('X08: Hot Memory Budget and Cold Archive Recall operate symbiotically', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    // 1. Hot working memory preference
    const candidate = extractChatMemoryCandidates('salve na memória; minha proporção favorita de vídeo é 9:16')[0];
    await ctx.chatService.saveChatMemoryCandidates([candidate], { userId: LOCAL_PROFILE_ID });

    // 2. Cold archived message
    ctx.conversationStore.upsertMessage({
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'old-chat-campaign',
      messageId: 'old-m1',
      role: 'user',
      content: 'Vamos decidir o codinome da marca Kaoz'
    });
    ctx.conversationStore.upsertMessage({
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'old-chat-campaign',
      messageId: 'old-m2',
      role: 'assistant',
      content: 'O codinome da marca ficou Kaoz.1'
    });

    // Intent detection
    assert.equal(isArchiveRecallIntent('qual proporção você recomenda?'), false);
    assert.equal(isArchiveRecallIntent('você lembra o que combinamos sobre o codinome da marca?'), true);

    // Cold recall execution
    const coldRecall = recallArchivedConversations({
      query: 'lembra o codinome da marca?',
      profileId: LOCAL_PROFILE_ID,
      store: ctx.conversationStore
    });

    assert.match(coldRecall.context, /DADOS NAO CONFIAVEIS/);
    assert.match(coldRecall.context, /Kaoz/);

    // Hot prompt context
    const hotContext = await ctx.chatService.buildPromptContext('qual proporção de vídeo usar?', { userId: LOCAL_PROFILE_ID });
    assert.match(hotContext.personalFacts, /9:16/);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// X09. Semantic Graph Connected Components + Overview Stats Alignment
// ---------------------------------------------------------------------------
suite.test('X09: Semantic Graph Connected Components compute correct clusters', async () => {
  const nodes = [
    // Component 1: Video cluster
    { id: 'c:video', label: 'Video' },
    { id: 'c:veo', label: 'Veo' },
    // Component 2: Audio cluster
    { id: 'c:audio', label: 'Audio' },
    { id: 'c:musetalk', label: 'MuseTalk' }
  ];

  const edges = [
    { id: 'e1', source: 'c:video', target: 'c:veo' },
    { id: 'e2', source: 'c:audio', target: 'c:musetalk' }
  ];

  const clusters = computeConnectedComponents(nodes, edges);
  assert.equal(clusters.length, 2, 'Must detect exactly 2 disconnected clusters');
  assert.equal(clusters[0].length, 2);
  assert.equal(clusters[1].length, 2);
});

// ---------------------------------------------------------------------------
// X10. Memory Correction Lineage + Identity Re-attribution
// ---------------------------------------------------------------------------
suite.test('X10: Memory Correction Lineage is preserved when reassigning profiles', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    const originProfile = 'origin-profile-1';

    // 1. Initial memory
    await ctx.chatService.saveChatMemoryCandidates(
      extractChatMemoryCandidates('salve na memória; gosto de café doce'),
      { userId: originProfile, sessionId: 'session-1' }
    );

    // 2. Correction supersedes previous
    const correction = extractChatMemoryCandidates('na verdade gosto de café amargo, não de café doce');
    await ctx.chatService.saveChatMemoryCandidates(correction, {
      userId: originProfile,
      sessionId: 'session-2'
    });

    const beforeReassign = await ctx.chatService.listActiveChatMemories({
      userId: originProfile,
      includeHistory: true
    });
    assert.equal(beforeReassign.length, 2);
    assert.ok(beforeReassign.some((m) => m.status === 'superseded'));
    assert.ok(beforeReassign.some((m) => m.status === 'active'));

    // 3. Reassign entire history to local-user
    const reassignResult = await ctx.chatService.reassignUserMemories(originProfile, LOCAL_PROFILE_ID);
    assert.equal(reassignResult.moved, 2);

    const afterReassign = await ctx.chatService.listActiveChatMemories({
      userId: LOCAL_PROFILE_ID,
      includeHistory: true
    });
    assert.equal(afterReassign.length, 2);
    const active = afterReassign.find((m) => m.status === 'active');
    const superseded = afterReassign.find((m) => m.status === 'superseded');

    assert.match(active.content, /amargo/);
    assert.match(superseded.content, /doce/);
  } finally {
    await ctx.cleanup();
  }
});

export default suite;
