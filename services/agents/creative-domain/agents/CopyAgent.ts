import { CreativeBriefEnrichmentAgent } from "./creative-brief-enrichment-agent.ts";

export class CopyAgent extends CreativeBriefEnrichmentAgent {
  constructor() {
    super({
      id: "creative-copy-agent",
      name: "Copy Agent",
      kind: "creative-copy",
      description:
        "Adds an append-only copywriting contribution to a CreativeBrief.",
      contributionKind: "copywriting",
      capabilities: [
        {
          name: "creative.copywriting",
          description: "Adds structured copy direction to a CreativeBrief.",
        },
      ],
    });
  }
}
