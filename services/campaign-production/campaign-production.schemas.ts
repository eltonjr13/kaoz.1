import type {
  CampaignAspectRatio,
  CampaignProductionJob,
  CampaignProductionOptions,
  CampaignProductionSpec,
  CampaignScene,
  ProduceCampaignRequest,
} from "./campaign-production.types.ts";

type UnknownRecord = Record<string, unknown>;
const RATIOS = new Set<CampaignAspectRatio>(["9:16", "16:9", "1:1", "4:3", "3:4"]);
const MAX_SCENES = 100;
const MAX_TOTAL_DURATION_SECONDS = 3_600;

function record(value: unknown, field: string): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} inválido.`);
  return value as UnknownRecord;
}

function text(value: unknown, field: string, maxLength = 20_000): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} deve ser um texto não vazio.`);
  const result = value.trim();
  if (result.length > maxLength) throw new Error(`${field} excede ${maxLength} caracteres.`);
  return result;
}

function optionalText(value: unknown, field: string, maxLength = 20_000): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return text(value, field, maxLength);
}

function ratio(value: unknown, field: string): CampaignAspectRatio {
  if (typeof value !== "string" || !RATIOS.has(value as CampaignAspectRatio)) throw new Error(`${field} inválido.`);
  return value as CampaignAspectRatio;
}

function finiteNumber(value: unknown, field: string, min: number, max: number): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max) throw new Error(`${field} deve estar entre ${min} e ${max}.`);
  return result;
}

function stringList(value: unknown, field: string, maxLength: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} inválido.`);
  return value.map((item, index) => text(item, `${field}[${index}]`, maxLength));
}

function reviewStatus(value: unknown): "approved" | "needs_revision" {
  if (value === "approved" || value === "needs_revision") return value;
  throw new Error("campaignProductionSpec.review.status inválido.");
}

function schemaVersion(value: unknown): "1.0" {
  if (value === "1.0") return value;
  throw new Error("schemaVersion inválida.");
}

export function parseCampaignScene(value: unknown, index = 0): CampaignScene {
  const input = record(value, `scenes[${index}]`);
  const styleKeywords = input.styleKeywords === undefined
    ? undefined
    : Array.isArray(input.styleKeywords)
      ? input.styleKeywords.map((item, keywordIndex) => text(item, `scenes[${index}].styleKeywords[${keywordIndex}]`, 200))
      : (() => { throw new Error(`scenes[${index}].styleKeywords inválido.`); })();
  return {
    sceneNumber: finiteNumber(input.sceneNumber, `scenes[${index}].sceneNumber`, 1, MAX_SCENES),
    title: text(input.title, `scenes[${index}].title`, 500),
    visualPrompt: text(input.visualPrompt, `scenes[${index}].visualPrompt`, 20_000),
    voiceoverText: text(input.voiceoverText, `scenes[${index}].voiceoverText`, 20_000),
    durationSeconds: finiteNumber(input.durationSeconds, `scenes[${index}].durationSeconds`, 0.1, 600),
    aspectRatio: ratio(input.aspectRatio, `scenes[${index}].aspectRatio`),
    speaker: optionalText(input.speaker, `scenes[${index}].speaker`, 500),
    notes: optionalText(input.notes, `scenes[${index}].notes`, 5_000),
    styleKeywords,
  };
}

function parseScenes(value: unknown): CampaignScene[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCENES) {
    throw new Error(`scenes deve conter entre 1 e ${MAX_SCENES} cenas.`);
  }
  const scenes = value.map(parseCampaignScene);
  const totalDuration = scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
  if (totalDuration > MAX_TOTAL_DURATION_SECONDS) throw new Error("A duração total da campanha excede 3600 segundos.");
  return scenes;
}

function parseOptions(value: unknown): CampaignProductionOptions | undefined {
  if (value === undefined) return undefined;
  const input = record(value, "options");
  return {
    generateImages: typeof input.generateImages === "boolean" ? input.generateImages : undefined,
    generateAudio: typeof input.generateAudio === "boolean" ? input.generateAudio : undefined,
    createDavinciPlan: typeof input.createDavinciPlan === "boolean" ? input.createDavinciPlan : undefined,
    aspectRatio: input.aspectRatio === undefined ? undefined : ratio(input.aspectRatio, "options.aspectRatio"),
    imageModel: optionalText(input.imageModel, "options.imageModel", 500),
    voiceProvider: typeof input.voiceProvider === "string" && ["fish-audio", "cartesia", "local", "mock"].includes(input.voiceProvider)
      ? input.voiceProvider as CampaignProductionOptions["voiceProvider"]
      : undefined,
    voiceModel: optionalText(input.voiceModel, "options.voiceModel", 500),
    voiceReferenceId: optionalText(input.voiceReferenceId, "options.voiceReferenceId", 500),
  };
}

export function parseProduceCampaignRequest(value: unknown): ProduceCampaignRequest & { sync?: boolean } {
  const input = record(value, "request");
  const artifacts = input.artifacts === undefined ? undefined : (() => {
    if (!Array.isArray(input.artifacts) || input.artifacts.length > 100) throw new Error("artifacts inválido.");
    return input.artifacts.map((item, index) => {
      const artifact = record(item, `artifacts[${index}]`);
      return {
        filename: optionalText(artifact.filename, `artifacts[${index}].filename`, 500),
        title: optionalText(artifact.title, `artifacts[${index}].title`, 500),
        content: optionalText(artifact.content, `artifacts[${index}].content`, 100_000),
      };
    });
  })();
  const artifactIds = input.artifactIds === undefined ? undefined : (() => {
    if (!Array.isArray(input.artifactIds) || input.artifactIds.length > 100) throw new Error("artifactIds inválido.");
    return input.artifactIds.map((id, index) => text(id, `artifactIds[${index}]`, 100));
  })();
  return {
    artifacts,
    artifactIds,
    options: parseOptions(input.options),
    customScenes: input.customScenes === undefined ? undefined : parseScenes(input.customScenes),
    campaignName: optionalText(input.campaignName, "campaignName", 500),
    sync: typeof input.sync === "boolean" ? input.sync : undefined,
  };
}

export function parseCampaignProductionSpec(value: unknown): CampaignProductionSpec {
  const input = record(value, "campaignProductionSpec");
  const review = record(input.review, "campaignProductionSpec.review");
  const declaredStatus = reviewStatus(review.status);
  const blockingIssues = stringList(review.blockingIssues, "review.blockingIssues", 1_000);
  const sourceArtifactIds = stringList(input.sourceArtifactIds, "sourceArtifactIds", 100);
  const score = finiteNumber(review.score, "review.score", 0, 100);
  const minimumScore = finiteNumber(review.minimumScore, "review.minimumScore", 0, 100);
  const status = declaredStatus === "approved" && score >= minimumScore && blockingIssues.length === 0
    ? "approved"
    : "needs_revision";
  const warnings = stringList(input.warnings, "warnings", 1_000);
  return {
    schemaVersion: schemaVersion(input.schemaVersion),
    id: text(input.id, "campaignProductionSpec.id", 100),
    warRoomSessionId: text(input.warRoomSessionId, "campaignProductionSpec.warRoomSessionId", 200),
    campaignName: text(input.campaignName, "campaignProductionSpec.campaignName", 500),
    objective: text(input.objective, "campaignProductionSpec.objective", 4_000),
    targetPlatform: text(input.targetPlatform, "campaignProductionSpec.targetPlatform", 500),
    aspectRatio: ratio(input.aspectRatio, "campaignProductionSpec.aspectRatio"),
    scenes: parseScenes(input.scenes),
    review: {
      status,
      score,
      minimumScore,
      blockingIssues,
    },
    sourceArtifactIds,
    warnings,
    generatedAt: text(input.generatedAt, "campaignProductionSpec.generatedAt", 100),
  };
}

export function assertCampaignProductionJob(value: CampaignProductionJob): CampaignProductionJob {
  if (!value.id || !value.outputDirectory || !Array.isArray(value.assets)) throw new Error("Manifesto de produção inválido.");
  parseScenes(value.parsedData.scenes);
  return value;
}
