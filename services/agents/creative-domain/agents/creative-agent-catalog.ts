import { AudienceStrategistAgent } from "./AudienceStrategistAgent.ts";
import { BrandAgent } from "./BrandAgent.ts";
import { CampaignDirectorAgent } from "./CampaignDirectorAgent.ts";
import { CopyAgent } from "./CopyAgent.ts";
import { CreativeReviewerAgent } from "./CreativeReviewerAgent.ts";
import { ImageGenerationAgent } from "./ImageGenerationAgent.ts";
import { MotionAgent } from "./MotionAgent.ts";
import { PromptEngineerAgent } from "./PromptEngineerAgent.ts";
import { VideoDirectionAgent } from "./VideoDirectionAgent.ts";
import { VisualDirectorAgent } from "./VisualDirectorAgent.ts";

export function createCreativeAgentCatalog() {
  return Object.freeze([
    new CampaignDirectorAgent(),
    new AudienceStrategistAgent(),
    new BrandAgent(),
    new CopyAgent(),
    new VisualDirectorAgent(),
    new PromptEngineerAgent(),
    new ImageGenerationAgent(),
    new VideoDirectionAgent(),
    new MotionAgent(),
    new CreativeReviewerAgent(),
  ]);
}
