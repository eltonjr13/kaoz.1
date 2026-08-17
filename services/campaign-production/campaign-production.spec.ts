import crypto from "node:crypto";
import { parseArtifactsToCampaign } from "./campaign-parser.ts";
import { parseCampaignProductionSpec } from "./campaign-production.schemas.ts";
import type { CampaignProductionSpec } from "./campaign-production.types.ts";

interface WarRoomSpecInput {
  sessionId: string;
  campaignName: string;
  objective: string;
  artifacts: ReadonlyArray<{ id: string; filename: string; content: string }>;
  review: {
    status: "approved" | "needs_revision";
    score: number;
    minimumScore: number;
    blockingIssues: readonly string[];
  };
  warnings?: readonly string[];
}

export function createCampaignProductionSpec(input: WarRoomSpecInput): CampaignProductionSpec {
  const parsed = parseArtifactsToCampaign(input.artifacts.map((artifact) => ({
    filename: artifact.filename,
    title: artifact.filename,
    content: artifact.content,
  })));
  return parseCampaignProductionSpec({
    schemaVersion: "1.0",
    id: crypto.randomUUID(),
    warRoomSessionId: input.sessionId,
    campaignName: parsed.campaignName || input.campaignName,
    objective: input.objective,
    targetPlatform: parsed.targetPlatform,
    aspectRatio: parsed.aspectRatio,
    scenes: parsed.scenes,
    review: {
      status: input.review.status,
      score: input.review.score,
      minimumScore: input.review.minimumScore,
      blockingIssues: [...input.review.blockingIssues],
    },
    sourceArtifactIds: input.artifacts.map((artifact) => artifact.id),
    warnings: [...(input.warnings || [])],
    generatedAt: new Date().toISOString(),
  });
}
