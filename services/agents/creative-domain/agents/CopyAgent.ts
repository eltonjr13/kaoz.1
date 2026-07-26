import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class CopyAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-copy-agent",
      name: "Copy Agent",
      kind: "creative-copy",
      description:
        "Structural owner of future creative copy responsibilities.",
      capabilities: [
        {
          name: "creative.copywriting",
          description:
            "Declares future creative copywriting responsibility.",
        },
      ],
    });
  }
}
