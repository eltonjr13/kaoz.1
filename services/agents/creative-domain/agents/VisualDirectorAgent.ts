import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class VisualDirectorAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-visual-director-agent",
      name: "Visual Director Agent",
      kind: "creative-visual-director",
      description:
        "Structural owner of future visual direction responsibilities.",
      capabilities: [
        {
          name: "creative.visual-direction",
          description:
            "Declares future visual direction responsibility.",
        },
      ],
    });
  }
}
