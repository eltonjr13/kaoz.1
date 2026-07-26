import type { Goal } from "../planning/planning.types.ts";

export type CreativeGoalKind =
  | "campaign"
  | "image"
  | "video"
  | "branding";

export interface CreativeGoalClassification {
  readonly kind: CreativeGoalKind;
  readonly matchedTerm: string;
  readonly requiredCapability: string;
  readonly artifactKind: string;
}

interface CreativeGoalRule {
  readonly kind: CreativeGoalKind;
  readonly term: string;
  readonly pattern: RegExp;
  readonly requiredCapability: string;
  readonly artifactKind: string;
}

const CREATIVE_GOAL_RULES: readonly CreativeGoalRule[] = Object.freeze([
  createRule(
    "campaign",
    "campanha",
    /\bcampanhas?\b/u,
    "creative.campaign-direction",
    "campaign",
  ),
  createRule(
    "campaign",
    "publicidade",
    /\bpublicidade\b/u,
    "creative.campaign-direction",
    "campaign",
  ),
  createRule(
    "campaign",
    "social media",
    /\bsocial[\s-]+media\b/u,
    "creative.campaign-direction",
    "social-media",
  ),
  createRule(
    "campaign",
    "anúncio",
    /\banuncios?\b/u,
    "creative.campaign-direction",
    "advertisement",
  ),
  createRule(
    "campaign",
    "marketing",
    /\bmarketing\b/u,
    "creative.campaign-direction",
    "campaign",
  ),
  createRule(
    "branding",
    "branding",
    /\bbranding\b/u,
    "creative.brand-governance",
    "brand",
  ),
  createRule(
    "image",
    "imagem",
    /\bimagens?\b/u,
    "creative.image-generation",
    "image",
  ),
  createRule(
    "video",
    "vídeo",
    /\bvideos?\b/u,
    "creative.video-direction",
    "video",
  ),
]);

/**
 * Classifies only the goal's declared intent. Constraints are deliberately
 * excluded because they can mention creative assets only to prohibit them.
 */
export function classifyCreativeGoal(
  goal: Pick<Goal, "title" | "objective">,
): CreativeGoalClassification | undefined {
  const intent = normalizeIntent(`${goal.title}\n${goal.objective}`);
  const rule = CREATIVE_GOAL_RULES.find((candidate) =>
    candidate.pattern.test(intent)
  );
  if (!rule) {
    return undefined;
  }
  return Object.freeze({
    kind: rule.kind,
    matchedTerm: rule.term,
    requiredCapability: rule.requiredCapability,
    artifactKind: rule.artifactKind,
  });
}

function createRule(
  kind: CreativeGoalKind,
  term: string,
  pattern: RegExp,
  requiredCapability: string,
  artifactKind: string,
): CreativeGoalRule {
  return Object.freeze({
    kind,
    term,
    pattern,
    requiredCapability,
    artifactKind,
  });
}

function normalizeIntent(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}
