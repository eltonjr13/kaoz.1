import { CreativeBriefEnrichmentAgent } from "./creative-brief-enrichment-agent.ts";

export class BrandAgent extends CreativeBriefEnrichmentAgent {
  constructor() {
    super({
      id: "creative-brand-agent",
      name: "Brand Agent",
      kind: "creative-brand",
      description:
        "Adds an append-only brand governance contribution to a CreativeBrief.",
      contributionKind: "brand-governance",
      capabilities: [
        {
          name: "creative.brand-governance",
          description: "Adds structured brand governance to a CreativeBrief.",
        },
      ],
    });
  }
}
