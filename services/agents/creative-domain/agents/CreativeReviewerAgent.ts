import { CreativeBriefEnrichmentAgent } from "./creative-brief-enrichment-agent.ts";

export class CreativeReviewerAgent extends CreativeBriefEnrichmentAgent {
  constructor() {
    super({
      id: "creative-reviewer-agent",
      name: "Creative Reviewer Agent",
      kind: "creative-reviewer",
      description:
        "Adds an append-only creative review contribution to a CreativeBrief.",
      contributionKind: "creative-review",
      capabilities: [
        {
          name: "creative.review",
          description: "Adds structured review findings to a CreativeBrief.",
        },
      ],
    });
  }
}
