import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class AudienceStrategistAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-audience-strategist-agent",
      name: "Audience Strategist Agent",
      kind: "creative-audience-strategist",
      description:
        "Structural owner of future audience strategy responsibilities.",
      capabilities: [
        {
          name: "creative.audience-strategy",
          description:
            "Declares future audience strategy responsibility.",
        },
      ],
    });
  }
}
