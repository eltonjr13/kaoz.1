import type { ConnectorDefinition, ConnectorProvider } from "./connector.types.ts";

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  {
    provider: "discord",
    name: "Discord",
    description: "Publica mensagens e arquivos em um canal usando um bot do Discord.",
    availability: "available",
    capabilities: ["publish_text", "publish_image", "publish_video"],
    credentialFields: [
      { key: "channelId", label: "ID do canal", type: "text", placeholder: "123456789012345678", required: true },
      { key: "botToken", label: "Token do bot", type: "password", placeholder: "Cole o token gerado no Discord Developer Portal", required: true }
    ]
  },
  {
    provider: "bluesky",
    name: "Bluesky",
    description: "Publica textos e imagens usando uma senha de aplicativo.",
    availability: "available",
    capabilities: ["publish_text", "publish_image"],
    credentialFields: [
      { key: "identifier", label: "Handle ou e-mail", type: "text", placeholder: "voce.bsky.social", required: true },
      { key: "appPassword", label: "Senha de aplicativo", type: "password", placeholder: "xxxx-xxxx-xxxx-xxxx", required: true },
      { key: "serviceUrl", label: "Servidor PDS", type: "url", placeholder: "https://bsky.social", required: false }
    ]
  },
  { provider: "x", name: "X / Twitter", description: "Posts, threads e mídia via API oficial.", availability: "planned", capabilities: ["publish_text", "publish_image", "read_metrics", "read_mentions"], credentialFields: [] },
  { provider: "linkedin", name: "LinkedIn", description: "Publicação em perfis e páginas profissionais.", availability: "planned", capabilities: ["publish_text", "publish_image", "publish_video", "read_metrics"], credentialFields: [] },
  {
    provider: "telegram",
    name: "Telegram",
    description: "Envia mensagens, imagens e vídeos para um canal ou grupo usando um bot.",
    availability: "available",
    capabilities: ["publish_text", "publish_image", "publish_video"],
    credentialFields: [
      { key: "chatId", label: "ID do chat ou @canal", type: "text", placeholder: "-1001234567890 ou @meucanal", required: true },
      { key: "botToken", label: "Token do bot", type: "password", placeholder: "Cole o token do BotFather", required: true }
    ]
  },
  { provider: "youtube", name: "YouTube", description: "Upload de vídeos e leitura de desempenho.", availability: "planned", capabilities: ["publish_video", "read_metrics"], credentialFields: [] },
  { provider: "instagram", name: "Instagram / Facebook", description: "Publicação e métricas pela plataforma Meta.", availability: "planned", capabilities: ["publish_image", "publish_video", "read_metrics", "read_mentions"], credentialFields: [] }
];

export function getConnectorDefinition(provider: ConnectorProvider) {
  return CONNECTOR_CATALOG.find((item) => item.provider === provider);
}
