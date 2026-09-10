/**
 * Tier 4: Real-World Workload Scenarios
 *
 * Covers realistic end-to-end multi-step sessions:
 * - Scenario 1: Cognitive Memory Consolidation & Lifecycle Session
 * - Scenario 2: Graph Knowledge Discovery & Procedural Rule Evaluation
 * - Scenario 3: Omnichannel Archive Search & Recall Session
 * - Scenario 4: Multi-Identity Management & Data Hygiene Session
 */

import {
  assert,
  createTestSuite,
  createTempUnifiedContext,
  LOCAL_MEMORY_USER_ID,
  LOCAL_PROFILE_ID,
  extractChatMemoryCandidates,
  detectChatMemoryCommand,
  simulatePhysicsStep,
  recallArchivedConversations,
  isArchiveRecallIntent,
} from './harness.mjs';

const suite = createTestSuite(
  4,
  'Real-World Workload Scenarios',
  'Multi-step end-to-end sessions: Memory Consolidation, Graph Evaluation, Archive Recall, Identity Hygiene'
);

// ---------------------------------------------------------------------------
// Scenario 1: Cognitive Memory Consolidation & Lifecycle Session
// ---------------------------------------------------------------------------
suite.test('S01: Cognitive Memory Consolidation & Lifecycle Session', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    // Step 1: User introduces brand guidelines and personal facts
    const initialPrompts = [
      'salve na memória; meu nome é Gabriel',
      'salve na memória; gosto de manga'
    ];

    for (const p of initialPrompts) {
      const candidates = extractChatMemoryCandidates(p);
      await ctx.chatService.saveChatMemoryCandidates(candidates, {
        userId: LOCAL_MEMORY_USER_ID,
        sessionId: 'session-brand-setup'
      });
    }

    const initialMemories = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_MEMORY_USER_ID });
    assert.equal(initialMemories.length, 2);

    // Step 2: User makes a correction to fruit preference
    const correctionPrompt = 'na verdade gosto de abacate, não de manga';
    const correctionCandidates = extractChatMemoryCandidates(correctionPrompt);
    assert.ok(correctionCandidates.length > 0, 'Must extract correction candidate');
    assert.ok(correctionCandidates[0].supersedeHints.length > 0, 'Must extract supersede hints');

    await ctx.chatService.saveChatMemoryCandidates(correctionCandidates, {
      userId: LOCAL_MEMORY_USER_ID,
      sessionId: 'session-brand-adjustment'
    });

    // Step 3: Verify audit lineage
    const allHistory = await ctx.chatService.listActiveChatMemories({
      userId: LOCAL_MEMORY_USER_ID,
      includeHistory: true
    });
    assert.equal(allHistory.length, 3);

    const superseded = allHistory.find((m) => m.status === 'superseded');
    const activeFruit = allHistory.find((m) => m.status === 'active' && m.content.includes('abacate'));
    assert.ok(superseded, 'Previous fruit must be superseded');
    assert.ok(activeFruit, 'New fruit must be active');
    assert.match(superseded.content, /manga/);

    // Step 4: Build prompt context within budget
    const promptCtx = await ctx.chatService.buildPromptContext('qual fruta eu gosto?', {
      userId: LOCAL_MEMORY_USER_ID
    });
    assert.match(promptCtx.personalFacts, /abacate/);
    assert.doesNotMatch(promptCtx.personalFacts, /manga/, 'Superseded memory must never pollute prompt');

    // Step 5: Targeted forget action
    const forgetCommand = detectChatMemoryCommand('esqueça qual fruta eu gosto');
    assert.equal(forgetCommand.type, 'forget');
    const forgottenCount = await ctx.chatService.forgetMemories(forgetCommand.target, { userId: LOCAL_MEMORY_USER_ID });
    assert.ok(forgottenCount >= 1, 'Must forget at least 1 memory matching command');

    const promptAfterForget = await ctx.chatService.buildPromptContext('qual fruta eu gosto?', {
      userId: LOCAL_MEMORY_USER_ID
    });
    assert.doesNotMatch(promptAfterForget.personalFacts, /abacate/, 'Forgotten fact must be completely absent from prompt');
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 2: Graph Knowledge Discovery & Procedural Rule Evaluation
// ---------------------------------------------------------------------------
suite.test('S02: Graph Knowledge Discovery & Procedural Rule Evaluation', async () => {
  const ctx = await createTempUnifiedContext({
    episodic: { nodes: [] },
    procedural: { rules: [] },
    semantic: {
      nodes: [
        { id: 'concept:kaoz-studio', label: 'Kaoz Studio', type: 'concept', confidenceScore: 1.0 },
        { id: 'concept:model-veo', label: 'VideoFX Veo 3.1', type: 'entity', confidenceScore: 0.95 },
        { id: 'concept:lipsync-musetalk', label: 'Lipsync MuseTalk', type: 'entity', confidenceScore: 0.9 }
      ],
      edges: [
        { id: 'e:studio->veo', source: 'concept:kaoz-studio', target: 'concept:model-veo', relation: 'uses_model', weight: 1.0 },
        { id: 'e:studio->musetalk', source: 'concept:kaoz-studio', target: 'concept:lipsync-musetalk', relation: 'uses_tool', weight: 0.8 }
      ]
    },
    chat: { memories: [] }
  });

  try {
    // Step 1: Physics layout convergence
    const initialPositions = [
      { id: 'concept:kaoz-studio', x: 500, y: 300, vx: 0, vy: 0, radius: 24 },
      { id: 'concept:model-veo', x: 505, y: 305, vx: 0, vy: 0, radius: 16 },
      { id: 'concept:lipsync-musetalk', x: 495, y: 295, vx: 0, vy: 0, radius: 16 }
    ];

    let currentNodes = initialPositions;
    for (let step = 0; step < 10; step++) {
      currentNodes = simulatePhysicsStep(currentNodes, [
        { source: 'concept:kaoz-studio', target: 'concept:model-veo', weight: 1 },
        { source: 'concept:kaoz-studio', target: 'concept:lipsync-musetalk', weight: 0.8 }
      ]);
    }

    // Nodes spread apart due to repulsion
    const distVeo = Math.hypot(currentNodes[1].x - currentNodes[0].x, currentNodes[1].y - currentNodes[0].y);
    assert.ok(distVeo > 30, 'Nodes must spread out from initial center');

    // Step 2: Failure pattern logged during execution
    await ctx.jsonProvider.updateMemory((data) => {
      data.semantic.nodes.push({
        id: 'error:veo-4k-timeout',
        label: 'Veo 4K Timeout',
        type: 'error-pattern',
        description: 'Renderizações de vídeo acima de 4K atingem timeout de 60s',
        confidenceScore: 0.85
      });
      data.semantic.edges.push({
        id: 'e:veo->timeout',
        source: 'concept:model-veo',
        target: 'error:veo-4k-timeout',
        relation: 'causes_failure',
        weight: 0.95
      });
      data.procedural.rules.push({
        id: 'rule:limit-veo-duration',
        instruction: 'Se resolução for 4K, limite duração para no máximo 5 segundos',
        priority: 1
      });
      data.episodic.nodes.push({
        id: 'ep:batch-render-fail',
        jobId: 'job-veo-101',
        feedback: 'bad',
        lastObserved: new Date().toISOString()
      });
    });

    const withError = await ctx.jsonProvider.readMemory();
    assert.equal(withError.semantic.nodes.length, 4);
    assert.equal(withError.semantic.edges.length, 3);
    assert.equal(withError.procedural.rules.length, 1);

    // Step 3: Resolve failure pattern to concept
    await ctx.jsonProvider.updateMemory((data) => {
      const errorNode = data.semantic.nodes.find((n) => n.id === 'error:veo-4k-timeout');
      if (errorNode) {
        errorNode.type = 'concept';
        errorNode.label = 'Veo 4K Chunking (Resolved)';
        errorNode.confidenceScore = 0.5;
        errorNode.metadata = { resolvedAt: new Date().toISOString() };
      }
      const failureEdge = data.semantic.edges.find((e) => e.relation === 'causes_failure');
      if (failureEdge) {
        failureEdge.relation = 'improves_quality';
      }
    });

    const resolved = await ctx.jsonProvider.readMemory();
    const resolvedNode = resolved.semantic.nodes.find((n) => n.id === 'error:veo-4k-timeout');
    assert.equal(resolvedNode.type, 'concept');
    assert.equal(resolvedNode.confidenceScore, 0.5);
    assert.ok(resolvedNode.metadata.resolvedAt);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 3: Omnichannel Archive Search & Recall Session
// ---------------------------------------------------------------------------
suite.test('S03: Omnichannel Archive Search & Recall Session', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    // Step 1: Conversations across 3 channels
    // Flow: Creative brief
    ctx.conversationStore.upsertMessage({
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'flow-campaign-sneakers',
      messageId: 'f-1',
      role: 'user',
      content: 'Vamos definir o conceito da campanha de sneakers urbanos'
    });
    ctx.conversationStore.upsertMessage({
      channel: 'flow',
      externalUserId: LOCAL_PROFILE_ID,
      externalConversationId: 'flow-campaign-sneakers',
      messageId: 'f-2',
      role: 'assistant',
      content: 'Sugiro focar no contraste entre concreto bruto e iluminação âmbar neon.'
    });

    // Telegram: Client feedback
    ctx.conversationStore.upsertMessage({
      channel: 'telegram',
      accountId: 'bot',
      externalUserId: 'client-telegram-id',
      externalConversationId: 'tg-feedback-chat',
      messageId: 'tg-1',
      role: 'user',
      content: 'O cliente adorou a ideia da iluminação âmbar no anúncio!'
    });

    // Discord: Team notes
    ctx.conversationStore.upsertMessage({
      channel: 'discord',
      accountId: 'server-1',
      externalUserId: 'editor-discord-id',
      externalConversationId: 'dc-editing-chat',
      messageId: 'dc-1',
      role: 'user',
      content: 'Na pós-produção vamos reforçar o som de passos no asfalto'
    });

    assert.equal(ctx.conversationStore.stats().conversations, 3);
    assert.equal(ctx.conversationStore.stats().messages, 4);

    // Link Telegram identity to local profile
    const tgIdentity = ctx.conversationStore.listIdentities().find((i) => i.externalUserId === 'client-telegram-id');
    assert.ok(tgIdentity);
    ctx.conversationStore.linkIdentity(tgIdentity.id, LOCAL_PROFILE_ID);

    // Step 2: Channel filtering
    const tgConvs = ctx.conversationStore.listConversations({ channel: 'telegram' });
    assert.equal(tgConvs.length, 1);
    assert.equal(tgConvs[0].channel, 'telegram');

    // Step 3: FTS5 Search with Portuguese diacritics
    const searchResults = ctx.conversationStore.search({
      query: 'iluminacao ambar',
      profileId: LOCAL_PROFILE_ID
    });
    assert.ok(searchResults.length >= 1, 'Should find messages discussing iluminação âmbar');
    assert.match(searchResults[0].content, /iluminação âmbar/);

    // Step 4: Recall query intent and context generation
    const recallQuery = 'lembra sobre iluminação âmbar?';
    assert.equal(isArchiveRecallIntent(recallQuery), true);

    const recallResult = recallArchivedConversations({
      query: recallQuery,
      profileId: LOCAL_PROFILE_ID,
      store: ctx.conversationStore
    });

    assert.ok(recallResult.hits.length > 0);
    assert.match(recallResult.context, /DADOS NAO CONFIAVEIS/);
    assert.match(recallResult.context, /iluminação âmbar/);
  } finally {
    await ctx.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Scenario 4: Multi-Identity Management & Data Hygiene Session
// ---------------------------------------------------------------------------
suite.test('S04: Multi-Identity Management & Data Hygiene Session', async () => {
  const ctx = await createTempUnifiedContext();
  try {
    // Step 1: External accounts detected
    const tgMsg = ctx.conversationStore.upsertMessage({
      channel: 'telegram',
      accountId: 'bot',
      externalUserId: 'ext-tg-vip-client',
      username: 'vip_client_tg',
      externalConversationId: 'tg-direct-chat',
      messageId: 'm-tg-10',
      role: 'user',
      content: 'Eu sou investidor anjo da startup'
    });

    const dcMsg = ctx.conversationStore.upsertMessage({
      channel: 'discord',
      accountId: 'guild-1',
      externalUserId: 'ext-dc-contractor',
      username: 'temp_contractor_dc',
      externalConversationId: 'dc-temp-chat',
      messageId: 'm-dc-20',
      role: 'user',
      content: 'Minha chave de API temporária é key-xyz-999'
    });

    // Step 2: Review detected identities
    const identities = ctx.conversationStore.listIdentities();
    assert.equal(identities.length, 2);

    const tgIdentity = identities.find((i) => i.externalUserId === 'ext-tg-vip-client');
    const dcIdentity = identities.find((i) => i.externalUserId === 'ext-dc-contractor');
    assert.ok(tgIdentity);
    assert.ok(dcIdentity);

    // Step 3: Link Telegram identity to local profile
    ctx.conversationStore.linkIdentity(tgIdentity.id, LOCAL_PROFILE_ID);
    const updatedTg = ctx.conversationStore.getIdentity(tgIdentity.id);
    assert.equal(updatedTg.linkedProfileId, LOCAL_PROFILE_ID);

    // Save a memory for the VIP client under local profile
    const vipCandidate = {
      ...extractChatMemoryCandidates('salve na memória; sou investidor anjo da startup')[0],
      evidenceRefs: [{ conversationId: tgMsg.message.conversationId, messageId: tgMsg.message.id }]
    };
    await ctx.chatService.saveChatMemoryCandidates([vipCandidate], { userId: LOCAL_PROFILE_ID });

    // Save a temporary memory for contractor with contractor evidence
    const contractorCandidate = {
      ...extractChatMemoryCandidates('salve na memória; chave de API temporária key-xyz-999')[0],
      evidenceRefs: [{ conversationId: dcMsg.message.conversationId, messageId: dcMsg.message.id }]
    };
    await ctx.chatService.saveChatMemoryCandidates([contractorCandidate], { userId: LOCAL_PROFILE_ID });

    const totalBeforePurge = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
    assert.equal(totalBeforePurge.length, 2);

    // Step 4: Unlink contractor with purge of derived evidence
    ctx.conversationStore.unlinkIdentity(dcIdentity.id);
    const dcMessages = ctx.conversationStore.listMessageIdsForIdentity(dcIdentity.id);
    const purgedCount = await ctx.chatService.forgetMemoriesByEvidence(dcMessages, LOCAL_PROFILE_ID);

    assert.equal(purgedCount, 1, 'Only contractor temporary data must be purged');

    // Step 5: Verification of data hygiene
    const remainingMemories = await ctx.chatService.listActiveChatMemories({ userId: LOCAL_PROFILE_ID });
    assert.equal(remainingMemories.length, 1);
    assert.match(remainingMemories[0].content, /investidor anjo/);
    assert.doesNotMatch(remainingMemories[0].content, /key-xyz-999/);

    const activeTgId = ctx.conversationStore.getIdentity(tgIdentity.id);
    assert.equal(activeTgId.linkedProfileId, LOCAL_PROFILE_ID, 'Telegram link remains undisturbed');
  } finally {
    await ctx.cleanup();
  }
});

export default suite;
