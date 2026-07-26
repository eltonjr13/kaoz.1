import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class CreativeReviewerAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-reviewer-agent",
      name: "Creative Reviewer Agent",
      kind: "creative-reviewer",
      description:
        "Structural owner of future creative review responsibilities.",
      capabilities: [
        {
          name: "creative.review",
          description:
            "Declares future creative review responsibility.",
        },
      ],
    });
  }
}
