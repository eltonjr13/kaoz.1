import type { ConnectorDefinition, ConnectorProvider } from "./connector.types";

export const CONNECTOR_CATALOG: ConnectorDefinition[] = [
  {
    provider: "discord",
    name: "Discord",
    description: "Publica mensagens e arquivos em um canal por webhook.",
    availability: "available",
    capabilities: ["publish_text", "publish_image", "publish_video"],
    credentialFields: [
      { key: "webhookUrl", label: "URL do webhook", type: "password", placeholder: "https://discord.com/api/webhooks/...", required: true }
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
  { provider: "telegram", name: "Telegram", description: "Mensagens e mídia para canais e grupos.", availability: "planned", capabilities: ["publish_text", "publish_image", "publish_video"], credentialFields: [] },
  { provider: "youtube", name: "YouTube", description: "Upload de vídeos e leitura de desempenho.", availability: "planned", capabilities: ["publish_video", "read_metrics"], credentialFields: [] },
  { provider: "instagram", name: "Instagram / Facebook", description: "Publicação e métricas pela plataforma Meta.", availability: "planned", capabilities: ["publish_image", "publish_video", "read_metrics", "read_mentions"], credentialFields: [] }
];

export function getConnectorDefinition(provider: ConnectorProvider) {
  return CONNECTOR_CATALOG.find((item) => item.provider === provider);
}
