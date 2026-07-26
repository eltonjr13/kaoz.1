import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class CampaignDirectorAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-campaign-director-agent",
      name: "Campaign Director Agent",
      kind: "creative-campaign-director",
      description:
        "Structural owner of future campaign direction responsibilities.",
      capabilities: [
        {
          name: "creative.campaign-direction",
          description:
            "Declares future campaign direction responsibility.",
        },
      ],
    });
  }
}
