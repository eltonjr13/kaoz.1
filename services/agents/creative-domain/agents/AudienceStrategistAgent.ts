import { CreativeBriefEnrichmentAgent } from "./creative-brief-enrichment-agent.ts";

export class AudienceStrategistAgent extends CreativeBriefEnrichmentAgent {
  constructor() {
    super({
      id: "creative-audience-strategist-agent",
      name: "Audience Strategist Agent",
      kind: "creative-audience-strategist",
      description:
        "Adds an append-only audience strategy contribution to a CreativeBrief.",
      contributionKind: "audience-strategy",
      capabilities: [
        {
          name: "creative.audience-strategy",
          description: "Adds structured audience strategy to a CreativeBrief.",
        },
      ],
    });
  }
}
