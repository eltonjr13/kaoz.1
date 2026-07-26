import { CreativeDomainAgentBase } from "./creative-domain-agent-base.ts";

export class ImageGenerationAgent extends CreativeDomainAgentBase {
  constructor() {
    super({
      id: "creative-image-generation-agent",
      name: "Image Generation Agent",
      kind: "creative-image-generation",
      description:
        "Structural owner of future image generation responsibilities.",
      capabilities: [
        {
          name: "creative.image-generation",
          description:
            "Declares future creative image generation responsibility.",
        },
      ],
    });
  }
}
