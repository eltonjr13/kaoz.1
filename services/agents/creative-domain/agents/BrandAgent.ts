import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class BrandAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-brand-agent",
      name: "Brand Agent",
      kind: "creative-brand",
      description:
        "Structural owner of future brand governance responsibilities.",
      capabilities: [
        {
          name: "creative.brand-governance",
          description:
            "Declares future brand governance responsibility.",
        },
      ],
    });
  }
}
