import { CreativeBriefEnrichmentAgent } from "./creative-brief-enrichment-agent.ts";

export class VisualDirectorAgent extends CreativeBriefEnrichmentAgent {
  constructor() {
    super({
      id: "creative-visual-director-agent",
      name: "Visual Director Agent",
      kind: "creative-visual-director",
      description:
        "Adds an append-only visual direction contribution to a CreativeBrief.",
      contributionKind: "visual-direction",
      capabilities: [
        {
          name: "creative.visual-direction",
          description: "Adds structured visual direction to a CreativeBrief.",
        },
      ],
    });
  }
}
