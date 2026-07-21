import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfiguredAgentIdentity, queryConfiguredAgentCli } from "../agent-llm/agent-llm.service.ts";
import { connectorStore } from "./connector.store.ts";
import { connectorVault } from "./connector.vault.ts";
import type { ConnectorInboundHistoryEntry, StoredConnectorAccount, TelegramPollingRuntimeStatus } from "./connector.types.ts";
import { getTelegramImageAttachment, requestsTelegramImageGeneration, telegramImageOperation, telegramInboundEnabled, telegramMessagePrompt, type TelegramImageAttachment, type TelegramInboundMessage } from "./telegram.inbound.ts";
import { archiveConnectorReply, prepareConnectorConversation } from "../conversation-memory/conversation-memory.connector.ts";
import { formatTelegramMessage } from "./message-format.ts";

const API_ROOT = "https://api.telegram.org";
const MAX_CONVERSATION_TURNS = 6;
const MAX_TELEGRAM_REFERENCE_BYTES = 10 * 1024 * 1024;

type TelegramUpdate = { update_id?: number; message?: TelegramInboundMessage };
type ConversationTurn = { role: "user" | "assistant"; content: string };

function globalManager() {
  return globalThis as typeof globalThis & { __mrChickenTelegramPolling?: TelegramPollingManager };
}

function apiUrl(token: string, method: string) { return `${API_ROOT}/bot${token}/${method}`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function parseIds(value?: string) { return new Set((value || "").split(",").map((item) => item.trim()).filter(Boolean)); }
function offsetKey(accountId: string, token: string) { return `${accountId}:${crypto.createHash("sha256").update(token).digest("hex")}`; }

function normalizeAgentResponse(value: string) {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch { /* Respostas em texto puro são aceitas. */ }
  return trimmed || "Não consegui gerar uma resposta agora.";
}

function buildTelegramAgentPrompt(input: { prompt: string; username?: string; identity: { provider: string; model: string }; recent: ConversationTurn[]; memoryContext?: string }) {
  const history = input.recent.length ? input.recent.map((turn) => `${turn.role === "user" ? "Usuário" : "Agente"}: ${turn.content}`).join("\n") : "(nova conversa)";
  return `Você é o agente MrChicken respondendo no Telegram.
Responda diretamente, em português, de forma útil e natural. Não afirme ter executado uma ação que não foi executada. Não use a ferramenta social:telegram:publish, pois sua resposta já será enviada ao usuário.
Se perguntarem qual modelo ou provedor você usa, responda somente com: ${input.identity.provider} / ${input.identity.model}.

CONVERSA RECENTE:
${history}

MEMORIA CORTEX:
${input.memoryContext || "Sem memoria relevante."}

USUÁRIO ${input.username ? `(${input.username})` : ""}:
${input.prompt}`;
}

export class TelegramPollingManager {
  private account: StoredConnectorAccount | null = null;
  private token = "";
  private offset = 0;
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private conversations = new Map<string, ConversationTurn[]>();
  private rateLimits = new Map<string, number[]>();
  private status: TelegramPollingRuntimeStatus = { state: "stopped", reconnectCount: 0 };

  getStatus() { return structuredClone(this.status); }

  async start() { await this.reconcile(); }

  async reconcile() {
    const account = (await connectorStore.listAccounts()).find(telegramInboundEnabled) || null;
    if (!account) return this.stop();
    const credentials = await connectorVault.read(account.id).catch(() => ({} as Record<string, string>));
    const token = credentials.botToken?.trim() || "";
    if (!token) { this.setError("Telegram bidirecional exige um token de bot válido."); return; }
    const identityChanged = this.account?.id !== account.id || this.token !== token;
    this.account = account;
    this.token = token;
    if (identityChanged) {
      this.offset = await connectorStore.getTelegramPollingOffset(offsetKey(account.id, token));
      this.conversations.clear();
      this.status = { state: "connecting", accountId: account.id, reconnectCount: 0 };
    }
    if (!this.running) void this.pollLoop();
  }

  stop() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.running = false;
    this.account = null;
    this.token = "";
    this.offset = 0;
    this.status = { state: "stopped", reconnectCount: 0 };
  }

  private async pollLoop() {
    if (this.running || !this.account || !this.token) return;
    this.running = true;
    try {
      while (this.running && this.account && this.token) {
        const response = await fetch(apiUrl(this.token, "getUpdates"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ offset: this.offset || undefined, timeout: 25, allowed_updates: ["message"] }),
          signal: AbortSignal.timeout(35_000),
        });
        const body = await response.json().catch(() => ({})) as { ok?: boolean; result?: TelegramUpdate[]; description?: string };
        if (!response.ok || !body.ok || !Array.isArray(body.result)) throw new Error(`Telegram retornou HTTP ${response.status}: ${body.description || "falha no polling"}`);
        this.status = { ...this.status, state: "connected", connectedAt: this.status.connectedAt || new Date().toISOString(), lastError: undefined };
        for (const update of body.result) {
          if (update.message) await this.handleMessage(update.message);
          if (typeof update.update_id === "number") {
            this.offset = await connectorStore.saveTelegramPollingOffset(offsetKey(this.account.id, this.token), update.update_id + 1);
          }
        }
      }
    } catch (error) {
      if (this.running) {
        this.setError(errorMessage(error));
        this.scheduleReconnect();
      }
    } finally { this.running = false; }
  }

  private async handleMessage(message: TelegramInboundMessage) {
    if (!this.account || !message.message_id || !message.chat?.id || !message.from?.id || message.from.is_bot) return;
    this.status.lastEventAt = new Date().toISOString();
    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const imageAttachment = getTelegramImageAttachment(message);
    const prompt = telegramMessagePrompt(message, Boolean(imageAttachment));
    const allowedChats = parseIds(this.account.publicConfig.allowedChatIds || this.account.publicConfig.chatId);
    const allowedUsers = parseIds(this.account.publicConfig.allowedUserIds);
    const isAllowed = (allowedChats.size === 0 || allowedChats.has(chatId)) && (allowedUsers.size === 0 || allowedUsers.has(userId));
    const audit: ConnectorInboundHistoryEntry = {
      id: crypto.randomUUID(), provider: "telegram", accountId: this.account.id, messageId: String(message.message_id), channelId: chatId,
      userId, username: message.from.username || message.from.first_name, receivedAt: new Date().toISOString(), status: "received", requestPreview: prompt.slice(0, 200),
    };
    if (!isAllowed || !prompt) {
      await connectorStore.appendInboundHistory({ ...audit, status: "ignored", completedAt: new Date().toISOString(), reason: !isAllowed ? "not_allowed" : "empty_message" });
      return;
    }
    if (!this.consumeRateLimit(userId)) {
      await connectorStore.appendInboundHistory({ ...audit, status: "ignored", completedAt: new Date().toISOString(), reason: "rate_limited" });
      await this.sendMessage(chatId, "Você enviou pedidos demais em pouco tempo. Aguarde um minuto e tente novamente.", message.message_id).catch(() => undefined);
      return;
    }
    const started = Date.now();
    const historyKey = `${chatId}:${userId}`;
    const archiveConversationId = `${chatId}:${userId}`;
    try {
      const prepared = await prepareConnectorConversation({
        channel: 'telegram', accountId: this.account.id, externalUserId: userId, username: audit.username,
        externalConversationId: archiveConversationId, conversationTitle: message.chat?.title || audit.username,
        messageId: String(message.message_id), prompt,
      });
      const recent = prepared.recent;
      let text: string;
      let replyId: string;
      if (requestsTelegramImageGeneration(prompt) || imageAttachment) {
        await this.sendChatAction(chatId, "upload_photo");
        const referenceImage = imageAttachment ? await this.downloadImageReference(imageAttachment) : undefined;
        const imagePath = await this.generateImage(prompt, referenceImage, telegramImageOperation(prompt, Boolean(referenceImage)));
        text = "Aqui está a imagem que você pediu.";
        replyId = await this.sendPhoto(chatId, text, imagePath, message.message_id);
      } else {
        await this.sendChatAction(chatId, "typing");
        const identity = await getConfiguredAgentIdentity();
        const response = await queryConfiguredAgentCli(buildTelegramAgentPrompt({ prompt, username: audit.username, identity, recent, memoryContext: prepared.memoryContext }), { toolIntentText: prompt });
        if (!response) throw new Error("O provedor Browser não pode responder mensagens do Telegram em segundo plano. Selecione um provedor CLI ou API em Agente LLM.");
        text = normalizeAgentResponse(response);
        replyId = await this.sendMessage(chatId, text, message.message_id);
      }
      const updated: ConversationTurn[] = [...recent, { role: "user" as const, content: prompt }, { role: "assistant" as const, content: text }];
      this.conversations.set(historyKey, updated.slice(-MAX_CONVERSATION_TURNS));
      archiveConnectorReply({ channel: 'telegram', accountId: this.account.id, externalUserId: userId, username: audit.username, externalConversationId: archiveConversationId, conversationTitle: message.chat?.title || audit.username, messageId: replyId, content: text });
      await connectorStore.appendInboundHistory({ ...audit, status: "responded", completedAt: new Date().toISOString(), durationMs: Date.now() - started, responsePreview: text.slice(0, 200), remoteReplyId: replyId });
      console.info(`[TelegramInbound] status=responded messageId=${message.message_id} chatId=${chatId}`);
    } catch (error) {
      const detail = errorMessage(error);
      await connectorStore.appendInboundHistory({ ...audit, status: "failed", completedAt: new Date().toISOString(), durationMs: Date.now() - started, error: detail });
      console.error(`[TelegramInbound] status=failed messageId=${message.message_id} error=${detail}`);
      await this.sendMessage(chatId, `Não consegui responder agora: ${detail.slice(0, 1_500)}`, message.message_id).catch(() => undefined);
    }
  }

  private async sendMessage(chatId: string, text: string, replyToMessageId: number) {
    const formattedText = formatTelegramMessage(text.slice(0, 4_096));
    const response = await fetch(apiUrl(this.token, "sendMessage"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: formattedText, parse_mode: "HTML", reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true }, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!response.ok || !body.ok || !body.result?.message_id) throw new Error(`Telegram retornou HTTP ${response.status}: ${body.description || "falha ao responder"}`);
    return String(body.result.message_id);
  }

  private async sendChatAction(chatId: string, action: "typing" | "upload_photo") {
    await fetch(apiUrl(this.token, "sendChatAction"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
  }

  private async downloadImageReference(attachment: TelegramImageAttachment): Promise<string> {
    if (attachment.size && attachment.size > MAX_TELEGRAM_REFERENCE_BYTES) throw new Error("A imagem de referência excede o limite de 10 MB.");
    const metadataResponse = await fetch(apiUrl(this.token, `getFile?file_id=${encodeURIComponent(attachment.fileId)}`), { signal: AbortSignal.timeout(15_000) });
    const metadata = await metadataResponse.json().catch(() => ({})) as { ok?: boolean; result?: { file_path?: string; file_size?: number }; description?: string };
    if (!metadataResponse.ok || !metadata.ok || !metadata.result?.file_path) {
      throw new Error(`Não consegui localizar a imagem anexada: ${metadata.description || `HTTP ${metadataResponse.status}`}`);
    }
    if (metadata.result.file_size && metadata.result.file_size > MAX_TELEGRAM_REFERENCE_BYTES) throw new Error("A imagem de referência excede o limite de 10 MB.");
    const response = await fetch(`${API_ROOT}/file/bot${this.token}/${metadata.result.file_path}`, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Não consegui baixar a imagem anexada (HTTP ${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_TELEGRAM_REFERENCE_BYTES) throw new Error("A imagem de referência está vazia ou excede o limite de 10 MB.");
    return `data:${attachment.mimeType};base64,${bytes.toString("base64")}`;
  }

  private async generateImage(prompt: string, referenceImage?: string, operation: "simple" | "reference" | "edit" = "simple"): Promise<string> {
    const baseUrl = process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
    const response = await fetch(`${baseUrl}/api/flow/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "image", prompt, quantity: 1, operation, referenceImage }),
      signal: AbortSignal.timeout(360_000),
    });
    const body = await response.json().catch(() => ({})) as { success?: boolean; path?: string; paths?: string[]; error?: string };
    const imagePath = body.paths?.[0] || body.path;
    if (!response.ok || !body.success || !imagePath) throw new Error(`Falha ao gerar a imagem: ${body.error || `Flow respondeu HTTP ${response.status}`}`);
    return imagePath;
  }

  private async sendPhoto(chatId: string, caption: string, imagePath: string, replyToMessageId: number) {
    const bytes = await readFile(imagePath);
    const filename = path.basename(imagePath);
    const extension = path.extname(filename).toLowerCase();
    const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    const form = new FormData();
    form.set("chat_id", chatId);
    form.set("caption", caption.slice(0, 1_024));
    form.set("reply_parameters", JSON.stringify({ message_id: replyToMessageId, allow_sending_without_reply: true }));
    form.set("photo", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
    const response = await fetch(apiUrl(this.token, "sendPhoto"), { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!response.ok || !body.ok || !body.result?.message_id) throw new Error(`Telegram retornou HTTP ${response.status}: ${body.description || "falha ao enviar a imagem"}`);
    return String(body.result.message_id);
  }

  private consumeRateLimit(userId: string) {
    const now = Date.now();
    const maximum = Math.min(20, Math.max(1, Number(this.account?.publicConfig.maxRequestsPerMinute || 5)));
    const recent = (this.rateLimits.get(userId) || []).filter((time) => now - time < 60_000);
    if (recent.length >= maximum) { this.rateLimits.set(userId, recent); return false; }
    recent.push(now); this.rateLimits.set(userId, recent); return true;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || !this.account) return;
    const reconnectCount = this.status.reconnectCount + 1;
    this.status.reconnectCount = reconnectCount;
    const delay = Math.min(60_000, 1_000 * 2 ** Math.min(reconnectCount, 6));
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.status.state = "connecting"; void this.pollLoop(); }, delay);
    this.reconnectTimer.unref?.();
  }

  private setError(message: string) {
    this.status = { ...this.status, state: "error", lastError: message };
    console.error(`[TelegramPolling] status=error error=${message}`);
  }
}

export const telegramPollingManager = globalManager().__mrChickenTelegramPolling ||= new TelegramPollingManager();
