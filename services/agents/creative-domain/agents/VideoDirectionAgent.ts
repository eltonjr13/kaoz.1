import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class VideoDirectionAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-video-direction-agent",
      name: "Video Direction Agent",
      kind: "creative-video-direction",
      description:
        "Structural owner of future video direction responsibilities.",
      capabilities: [
        {
          name: "creative.video-direction",
          description:
            "Declares future creative video direction responsibility.",
        },
      ],
    });
  }
}
