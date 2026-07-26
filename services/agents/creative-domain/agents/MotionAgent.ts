import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class MotionAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-motion-agent",
      name: "Motion Agent",
      kind: "creative-motion",
      description:
        "Structural owner of future motion design responsibilities.",
      capabilities: [
        {
          name: "creative.motion-design",
          description:
            "Declares future creative motion design responsibility.",
        },
      ],
    });
  }
}
