import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSyntheticAgentTurn,
  createWarRoomSession,
  WAR_ROOM_AGENT_PROFILES,
  type WarRoomSession,
} from "../services/agents/index.ts";
import { readStoredArtifact, registerContentArtifact } from "../services/artifacts/artifact.service.ts";
import {
  CampaignProductionService,
  createCampaignProductionSpec,
  parseArtifactsToCampaign,
  parseCampaignProductionSpec,
  parseCampaignScene,
} from "../services/campaign-production/index.ts";

test("Fase 1: Warrooom gera, persiste e produz pelo contrato canônico aprovado", async () => {
  let session: WarRoomSession = createWarRoomSession({
    schemaVersion: "1.0",
    topic: "Lançamento Café Aurora",
    objective: "Gerar uma campanha vertical de lançamento com foco em experimentação.",
    targetAudience: "Adultos interessados em café especial",
    channels: ["Instagram Reels"],
    constraints: ["Sem promessas de saúde"],
  });

  for (let index = 0; index < WAR_ROOM_AGENT_PROFILES.length; index++) {
    const turn = buildSyntheticAgentTurn(session, index, session.topic);
    assert.ok(turn.artifactReference?.content);
    const persisted = await registerContentArtifact({
      id: turn.artifactReference!.id,
      name: turn.artifactReference!.name,
      content: turn.artifactReference!.content!,
      type: "markdown",
      mimeType: "text/markdown; charset=utf-8",
      metadata: { warRoomSessionId: session.id },
    });
    assert.equal(persisted.id, turn.artifactReference?.id, "Canvas deve persistir o mesmo ID exibido no feed");
    session = turn.updatedSession;
  }

  assert.equal(session.review?.status, "approved");
  assert.equal(session.status, "completed_with_warnings", "fallback sintético deve permanecer visível");

  const sourceArtifacts = session.messages.flatMap((message) =>
    (message.artifactsProduced || []).flatMap((artifact) => artifact.content ? [{
      id: artifact.id,
      filename: artifact.name,
      content: artifact.content,
    }] : []),
  );
  const spec = createCampaignProductionSpec({
    sessionId: session.id,
    campaignName: session.topic,
    objective: session.brief.objective,
    artifacts: sourceArtifacts,
    review: session.review!,
  });
  const specArtifact = await registerContentArtifact({
    id: spec.id,
    name: "campaign-production-spec.json",
    content: `${JSON.stringify(spec, null, 2)}\n`,
    type: "json",
    mimeType: "application/json; charset=utf-8",
  });

  const canvasRead = await readStoredArtifact(specArtifact.id);
  const validatedSpec = parseCampaignProductionSpec(JSON.parse(canvasRead.content.toString("utf8")));
  const parsed = parseArtifactsToCampaign([{ filename: specArtifact.name, content: canvasRead.content.toString("utf8") }]);
  assert.equal(validatedSpec.review.status, "approved");
  assert.equal(parsed.sourceMode, "canonical_spec");
  assert.equal(parsed.campaignName, "Lançamento Café Aurora");
  assert.equal(parsed.scenes.length, 4);

  const production = new CampaignProductionService();
  const job = await production.createCampaignProductionJob({
    artifactIds: [specArtifact.id],
    options: { generateImages: false, generateAudio: false, createDavinciPlan: false },
  });
  assert.equal(job.productionSpecId, spec.id);
  const completed = await production.executeCampaignProduction(job.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.parsedData.sourceMode, "canonical_spec");
});

test("Fase 1: rubrica reprovada bloqueia a produção", async () => {
  const rejectedSpec = {
    schemaVersion: "1.0",
    id: "20dbb9d9-d8dc-4b88-a992-8fe600ef0f14",
    warRoomSessionId: "war-room-rejected",
    campaignName: "Campanha Reprovada",
    objective: "Revisar antes de produzir",
    targetPlatform: "Instagram Reels",
    aspectRatio: "9:16",
    scenes: [{
      sceneNumber: 1,
      title: "Cena incompleta",
      visualPrompt: "Visual ainda pendente de validação",
      voiceoverText: "Texto ainda pendente de validação",
      durationSeconds: 3,
      aspectRatio: "9:16",
    }],
    review: { status: "needs_revision", score: 60, minimumScore: 80, blockingIssues: ["Copy incompleta"] },
    sourceArtifactIds: [],
    generatedAt: new Date().toISOString(),
  };
  const production = new CampaignProductionService();
  await assert.rejects(
    () => production.createCampaignProductionJob({
      artifacts: [{ filename: "campaign-production-spec.json", content: JSON.stringify(rejectedSpec) }],
    }),
    /bloqueada pela rubrica/i,
  );
});

test("Fase 1: schemas runtime rejeitam cena perigosa ou incompleta", () => {
  assert.throws(() => parseCampaignScene({
    sceneNumber: 1,
    title: "Cena enorme",
    visualPrompt: "Prompt",
    voiceoverText: "Locução",
    durationSeconds: 100_000,
    aspectRatio: "9:16",
  }), /durationSeconds/);
});
