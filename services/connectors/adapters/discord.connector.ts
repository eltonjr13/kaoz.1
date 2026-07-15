import type { ConnectorAdapter } from "../connector.types.ts";
import { loadConnectorMedia } from "../connector.media.ts";

function webhookUrl(credentials: Record<string, string>) {
  const value = credentials.webhookUrl?.trim();
  if (!value) throw new Error("Informe a URL do webhook do Discord.");
  const url = new URL(value);
  if (url.protocol !== "https:" || !["discord.com", "discordapp.com", "canary.discord.com", "ptb.discord.com"].includes(url.hostname)) {
    throw new Error("A URL precisa ser um webhook HTTPS oficial do Discord.");
  }
  if (!/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9._-]+/.test(url.pathname)) throw new Error("URL de webhook do Discord inválida.");
  return url;
}

async function responseBody(response: Response) {
  const text = await response.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text }; }
}

export const discordConnector: ConnectorAdapter = {
  async test(credentials, signal) {
    const response = await fetch(webhookUrl(credentials), { signal, cache: "no-store" });
    const body = await responseBody(response);
    if (!response.ok) throw new Error(`Discord retornou HTTP ${response.status}: ${String(body.message || "webhook indisponível")}`);
    return { displayName: typeof body.name === "string" ? body.name : undefined };
  },

  async publish(_account, credentials, input, signal) {
    const url = webhookUrl(credentials);
    url.searchParams.set("wait", "true");
    const text = input.text.trim();
    if (!text && !input.media?.length) throw new Error("A publicação precisa de texto ou mídia.");
    if (text.length > 2_000) throw new Error("Mensagens do Discord aceitam até 2.000 caracteres.");
    if ((input.media?.length || 0) > 10) throw new Error("Envie no máximo 10 arquivos por mensagem no Discord.");

    let body: BodyInit;
    let headers: HeadersInit | undefined;
    if (input.media?.length) {
      const form = new FormData();
      form.set("payload_json", JSON.stringify({ content: text }));
      for (const [index, media] of input.media.entries()) {
        const loaded = await loadConnectorMedia(media, 8_000_000);
        form.set(`files[${index}]`, new Blob([new Uint8Array(loaded.bytes)], { type: loaded.mimeType }), loaded.filename);
      }
      body = form;
    } else {
      headers = { "content-type": "application/json" };
      body = JSON.stringify({ content: text });
    }

    const response = await fetch(url, { method: "POST", headers, body, signal });
    const result = await responseBody(response);
    if (!response.ok) throw new Error(`Discord retornou HTTP ${response.status}: ${String(result.message || "falha ao publicar")}`);
    const id = typeof result.id === "string" ? result.id : "discord-message";
    const channelId = typeof result.channel_id === "string" ? result.channel_id : undefined;
    const guildId = typeof result.guild_id === "string" ? result.guild_id : undefined;
    return { remoteId: id, url: guildId && channelId ? `https://discord.com/channels/${guildId}/${channelId}/${id}` : undefined };
  }
};
