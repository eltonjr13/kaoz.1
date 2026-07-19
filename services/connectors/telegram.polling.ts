import crypto from "node:crypto";
import { getConfiguredAgentIdentity, queryConfiguredAgentCli } from "../agent-llm/agent-llm.service.ts";
import { connectorStore } from "./connector.store.ts";
import { connectorVault } from "./connector.vault.ts";
import type { ConnectorInboundHistoryEntry, StoredConnectorAccount, TelegramPollingRuntimeStatus } from "./connector.types.ts";

const API_ROOT = "https://api.telegram.org";
const MAX_CONVERSATION_TURNS = 6;

type TelegramUser = { id?: number; username?: string; first_name?: string; is_bot?: boolean };
type TelegramMessage = { message_id?: number; chat?: { id?: number; type?: string; title?: string }; from?: TelegramUser; text?: string };
type TelegramUpdate = { update_id?: number; message?: TelegramMessage };
type ConversationTurn = { role: "user" | "assistant"; content: string };

function globalManager() {
  return globalThis as typeof globalThis & { __mrChickenTelegramPolling?: TelegramPollingManager };
}

function apiUrl(token: string, method: string) { return `${API_ROOT}/bot${token}/${method}`; }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
function parseIds(value?: string) { return new Set((value || "").split(",").map((item) => item.trim()).filter(Boolean)); }

function telegramInboundEnabled(account: StoredConnectorAccount) {
  return account.enabled && account.provider === "telegram" && account.publicConfig.inboundEnabled === "true";
}

function normalizeAgentResponse(value: string) {
  const trimmed = value.trim();
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown };
    if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message.trim();
  } catch { /* Respostas em texto puro são aceitas. */ }
  return trimmed || "Não consegui gerar uma resposta agora.";
}

function buildTelegramAgentPrompt(input: { prompt: string; username?: string; identity: string; recent: ConversationTurn[] }) {
  const history = input.recent.length ? input.recent.map((turn) => `${turn.role === "user" ? "Usuário" : "Agente"}: ${turn.content}`).join("\n") : "(nova conversa)";
  return `Você é ${input.identity}, o agente MrChicken respondendo no Telegram.
Responda diretamente, em português, de forma útil e natural. Não afirme ter executado uma ação que não foi executada. Não use a ferramenta social:telegram:publish, pois sua resposta já será enviada ao usuário.

CONVERSA RECENTE:
${history}

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
    const changed = this.account?.id !== account.id || this.token !== token || JSON.stringify(this.account?.publicConfig) !== JSON.stringify(account.publicConfig);
    this.account = account;
    this.token = token;
    if (changed) {
      this.offset = 0;
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
          if (typeof update.update_id === "number") this.offset = update.update_id + 1;
          if (update.message) await this.handleMessage(update.message);
        }
      }
    } catch (error) {
      if (this.running) {
        this.setError(errorMessage(error));
        this.scheduleReconnect();
      }
    } finally { this.running = false; }
  }

  private async handleMessage(message: TelegramMessage) {
    if (!this.account || !message.message_id || !message.chat?.id || !message.from?.id || message.from.is_bot) return;
    this.status.lastEventAt = new Date().toISOString();
    const chatId = String(message.chat.id);
    const userId = String(message.from.id);
    const prompt = message.text?.trim() || "";
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
    const recent = this.conversations.get(historyKey) || [];
    try {
      const identity = await getConfiguredAgentIdentity();
      const response = await queryConfiguredAgentCli(buildTelegramAgentPrompt({ prompt, username: audit.username, identity, recent }), { toolIntentText: prompt });
      if (!response) throw new Error("O provedor Browser não pode responder mensagens do Telegram em segundo plano. Selecione um provedor CLI ou API em Agente LLM.");
      const text = normalizeAgentResponse(response);
      const replyId = await this.sendMessage(chatId, text, message.message_id);
      this.conversations.set(historyKey, [...recent, { role: "user", content: prompt }, { role: "assistant", content: text }].slice(-MAX_CONVERSATION_TURNS));
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
    const response = await fetch(apiUrl(this.token, "sendMessage"), {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4_096), reply_parameters: { message_id: replyToMessageId, allow_sending_without_reply: true }, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(30_000),
    });
    const body = await response.json().catch(() => ({})) as { ok?: boolean; result?: { message_id?: number }; description?: string };
    if (!response.ok || !body.ok || !body.result?.message_id) throw new Error(`Telegram retornou HTTP ${response.status}: ${body.description || "falha ao responder"}`);
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
