import type { ToolHandler } from "../../tools/tool.types";
import { connectorService } from "../../connectors/connector.service";
import type { ConnectorMedia, ConnectorProvider } from "../../connectors/connector.types";

function mediaFromArgs(value: unknown): ConnectorMedia[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item): ConnectorMedia[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return typeof record.path === "string" ? [{ path: record.path, alt: typeof record.alt === "string" ? record.alt : undefined }] : [];
  });
}

function handler(provider: ConnectorProvider): ToolHandler {
  return async (args, context) => {
    const text = typeof args.text === "string" ? args.text : "";
    const accountId = typeof args.accountId === "string" ? args.accountId : undefined;
    const output = await connectorService.publish(provider, { text, accountId, media: mediaFromArgs(args.media) }, context.signal);
    return { output };
  };
}

export const connectorHandlers: Record<string, ToolHandler> = {
  "social:discord:publish": handler("discord"),
  "social:bluesky:publish": handler("bluesky")
};
