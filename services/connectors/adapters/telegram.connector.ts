import type { ConnectorAdapter, ConnectorMedia } from "../connector.types.ts";
import { loadConnectorMedia } from "../connector.media.ts";
import { formatTelegramMessage } from "../message-format.ts";

const API_ROOT = "https://api.telegram.org";
const MAX_TEXT_LENGTH = 4_096;
const MAX_CAPTION_LENGTH = 1_024;

function botCredentials(credentials: Record<string, string>) {
  const botToken = credentials.botToken?.trim();
  const chatId = credentials.chatId?.trim();
  if (!botToken) throw new Error("Informe o token do bot do Telegram.");
  if (!chatId) throw new Error("Informe o ID do chat ou @canal do Telegram.");
  if (!/^-?\d+$/.test(chatId) && !/^@[A-Za-z][A-Za-z0-9_]{4,}$/.test(chatId)) throw new Error("O destino do Telegram deve ser um ID numérico ou um @canal válido.");
  return { botToken, chatId };
}

function endpoint(botToken: string, method: string) { return `${API_ROOT}/bot${botToken}/${method}`; }

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { description: text }; }
}

function errorMessage(body: Record<string, unknown>) { return String(body.description || body.message || "falha na API do Telegram"); }
function isImage(media: ConnectorMedia) { return /\.(?:avif|gif|jpe?g|png|webp)$/i.test(media.path); }
function isVideo(media: ConnectorMedia) { return /\.(?:m4v|mov|mp4|webm)$/i.test(media.path); }

async function sendMedia(botToken: string, chatId: string, media: ConnectorMedia, caption: string, signal?: AbortSignal) {
  const loaded = await loadConnectorMedia(media, 50_000_000);
  const method = isImage(media) ? "sendPhoto" : isVideo(media) ? "sendVideo" : "sendDocument";
  const field = method === "sendPhoto" ? "photo" : method === "sendVideo" ? "video" : "document";
  const form = new FormData();
  form.set("chat_id", chatId);
  if (caption) {
    form.set("caption", formatTelegramMessage(caption));
    form.set("parse_mode", "HTML");
  }
  form.set(field, new Blob([new Uint8Array(loaded.bytes)], { type: loaded.mimeType }), loaded.filename);
  const response = await fetch(endpoint(botToken, method), { method: "POST", body: form, signal });
  const body = await responseBody(response);
  if (!response.ok || body.ok === false) throw new Error(`Telegram retornou HTTP ${response.status}: ${errorMessage(body)}`);
  return body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : {};
}

export const telegramConnector: ConnectorAdapter = {
  async test(credentials, signal) {
    const { botToken, chatId } = botCredentials(credentials);
    const [meResponse, chatResponse] = await Promise.all([
      fetch(endpoint(botToken, "getMe"), { signal, cache: "no-store" }),
      fetch(endpoint(botToken, `getChat?chat_id=${encodeURIComponent(chatId)}`), { signal, cache: "no-store" }),
    ]);
    const [me, chat] = await Promise.all([responseBody(meResponse), responseBody(chatResponse)]);
    if (!meResponse.ok || me.ok === false) throw new Error(`Telegram retornou HTTP ${meResponse.status}: ${errorMessage(me)}`);
    if (!chatResponse.ok || chat.ok === false) throw new Error(`Telegram retornou HTTP ${chatResponse.status}: ${errorMessage(chat)}`);
    const result = chat.result && typeof chat.result === "object" ? chat.result as Record<string, unknown> : {};
    const name = typeof result.title === "string" ? result.title : typeof result.username === "string" ? `@${result.username}` : chatId;
    return { displayName: `Telegram: ${name}`, publicConfig: { chatId } };
  },
  async publish(_account, credentials, input, signal) {
    const { botToken, chatId } = botCredentials(credentials);
    const text = input.text.trim();
    const media = input.media || [];
    if (!text && !media.length) throw new Error("A publicação precisa de texto ou mídia.");
    if (text.length > MAX_TEXT_LENGTH) throw new Error("Mensagens do Telegram aceitam até 4.096 caracteres.");
    if (media.length > 10) throw new Error("Envie no máximo 10 arquivos por publicação no Telegram.");
    let result: Record<string, unknown> = {};
    if (!media.length) {
      const response = await fetch(endpoint(botToken, "sendMessage"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: formatTelegramMessage(text), parse_mode: "HTML", disable_web_page_preview: true }), signal });
      const body = await responseBody(response);
      if (!response.ok || body.ok === false) throw new Error(`Telegram retornou HTTP ${response.status}: ${errorMessage(body)}`);
      result = body.result && typeof body.result === "object" ? body.result as Record<string, unknown> : {};
    } else {
      if (text.length > MAX_CAPTION_LENGTH) {
        const response = await fetch(endpoint(botToken, "sendMessage"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: chatId, text: formatTelegramMessage(text), parse_mode: "HTML", disable_web_page_preview: true }), signal });
        const body = await responseBody(response);
        if (!response.ok || body.ok === false) throw new Error(`Telegram retornou HTTP ${response.status}: ${errorMessage(body)}`);
      }
      for (const [index, item] of media.entries()) result = await sendMedia(botToken, chatId, item, index === 0 && text.length <= MAX_CAPTION_LENGTH ? text : "", signal);
    }
    const messageId = result.message_id;
    const username = chatId.startsWith("@") ? chatId.slice(1) : "";
    return { remoteId: typeof messageId === "number" || typeof messageId === "string" ? String(messageId) : "telegram-message", url: username && messageId ? `https://t.me/${username}/${messageId}` : undefined };
  }
};
