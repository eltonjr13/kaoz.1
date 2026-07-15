import type { ConnectorAdapter } from "../connector.types.ts";
import { loadConnectorMedia } from "../connector.media.ts";

const API_ROOT = "https://discord.com/api/v10";

function botCredentials(credentials: Record<string, string>) {
  const botToken = credentials.botToken?.trim();
  const channelId = credentials.channelId?.trim();
  if (!botToken) throw new Error("Informe o token do bot do Discord.");
  if (!channelId) throw new Error("Informe o ID do canal do Discord.");
  if (!/^\d{15,22}$/.test(channelId)) throw new Error("O ID do canal do Discord deve ser um Snowflake numérico válido.");
  return { botToken, channelId };
}

function authHeaders(botToken: string): HeadersInit {
  return { authorization: `Bot ${botToken}`, accept: "application/json" };
}

async function responseBody(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text }; }
}

export const discordConnector: ConnectorAdapter = {
  async test(credentials, signal) {
    const { botToken, channelId } = botCredentials(credentials);
    const response = await fetch(`${API_ROOT}/channels/${channelId}`, { headers: authHeaders(botToken), signal, cache: "no-store" });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(`Discord retornou HTTP ${response.status}: ${String(body.message || "bot sem acesso ao canal")}`);
    return { displayName: typeof body.name === "string" ? `#${body.name}` : undefined };
  },

  async publish(_account, credentials, input, signal) {
    const { botToken, channelId } = botCredentials(credentials);
    const url = `${API_ROOT}/channels/${channelId}/messages`;
    const text = input.text.trim();
    if (!text && !input.media?.length) throw new Error("A publicação precisa de texto ou mídia.");
    if (text.length > 2_000) throw new Error("Mensagens do Discord aceitam até 2.000 caracteres.");
    if ((input.media?.length || 0) > 10) throw new Error("Envie no máximo 10 arquivos por mensagem no Discord.");

    let body: BodyInit;
    let headers: HeadersInit = authHeaders(botToken);
    const payload = { content: text, allowed_mentions: { parse: [] } };
    if (input.media?.length) {
      const form = new FormData();
      form.set("payload_json", JSON.stringify(payload));
      for (const [index, media] of input.media.entries()) {
        const loaded = await loadConnectorMedia(media, 8_000_000);
        form.set(`files[${index}]`, new Blob([new Uint8Array(loaded.bytes)], { type: loaded.mimeType }), loaded.filename);
      }
      body = form;
    } else {
      headers = { ...headers, "content-type": "application/json" };
      body = JSON.stringify(payload);
    }

    const response = await fetch(url, { method: "POST", headers, body, signal });
    const result = await responseBody(response);
    if (!response.ok) throw new Error(`Discord retornou HTTP ${response.status}: ${String(result.message || "falha ao publicar")}`);
    const id = typeof result.id === "string" ? result.id : "discord-message";
    const responseChannelId = typeof result.channel_id === "string" ? result.channel_id : undefined;
    const guildId = typeof result.guild_id === "string" ? result.guild_id : undefined;
    return { remoteId: id, url: guildId && responseChannelId ? `https://discord.com/channels/${guildId}/${responseChannelId}/${id}` : undefined };
  }
};
