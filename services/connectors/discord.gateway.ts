import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getConfiguredAgentIdentity, queryConfiguredAgentCli } from "../agent-llm/agent-llm.service.ts";
import { skillRegistry } from "../skills/skill.registry.ts";
import { connectorStore } from "./connector.store.ts";
import { connectorVault } from "./connector.vault.ts";
import type { ConnectorInboundHistoryEntry, DiscordGatewayRuntimeStatus, StoredConnectorAccount } from "./connector.types.ts";
import { buildDiscordAgentPrompt, discordImageOperation, discordInboundEnabled, evaluateDiscordInbound, getDiscordImageAttachment, normalizeDiscordAgentResponse, requestsDiscordImageGeneration, type DiscordImageAttachment, type DiscordInboundMessage } from "./discord.inbound.ts";

const DEFAULT_GATEWAY = "wss://gateway.discord.gg";
const GATEWAY_VERSION = 10;
const GATEWAY_INTENTS = (1 << 0) | (1 << 9); // GUILDS + GUILD_MESSAGES. Mention content is available without MESSAGE_CONTENT.
const API_ROOT = "https://discord.com/api/v10";
const MAX_SEEN_MESSAGES = 500;

type GatewayPayload = { op: number; d?: unknown; s?: number | null; t?: string | null };
type ConversationTurn = { role: "user" | "assistant"; content: string };

function globalManager() {
  return globalThis as typeof globalThis & { __mrChickenDiscordGateway?: DiscordGatewayManager };
}

function publicStatus(status: DiscordGatewayRuntimeStatus): DiscordGatewayRuntimeStatus {
  return structuredClone(status);
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bot ${token}`, "content-type": "application/json", accept: "application/json" };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const MAX_DISCORD_REFERENCE_BYTES = 10 * 1024 * 1024;

async function downloadDiscordImageReference(attachment: DiscordImageAttachment): Promise<string> {
  const source = new URL(attachment.url);
  if (!new Set(["cdn.discordapp.com", "media.discordapp.net"]).has(source.hostname)) {
    throw new Error("O anexo de imagem não veio do CDN do Discord.");
  }
  if (attachment.size && attachment.size > MAX_DISCORD_REFERENCE_BYTES) {
    throw new Error("A imagem de referência excede o limite de 10 MB.");
  }
  const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Não consegui baixar a imagem anexada (HTTP ${response.status}).`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_DISCORD_REFERENCE_BYTES) {
    throw new Error("A imagem de referência está vazia ou excede o limite de 10 MB.");
  }
  return `data:${attachment.mimeType};base64,${bytes.toString("base64")}`;
}

async function generateDiscordImage(prompt: string, referenceImage?: string, operation: "simple" | "reference" | "edit" = "simple"): Promise<string> {
  // The Flow browser session belongs to the Next route runtime. Calling the
  // internal route also avoids loading Playwright in the Gateway startup chunk.
  const baseUrl = process.env.APP_BASE_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
  const response = await fetch(`${baseUrl}/api/flow/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "image", prompt, quantity: 1, operation, referenceImage }),
    signal: AbortSignal.timeout(360_000),
  });
  const body = await response.json().catch(() => ({})) as { success?: boolean; path?: string; paths?: string[]; error?: string };
  const imagePath = body.paths?.[0] || body.path;
  if (!response.ok || !body.success || !imagePath) {
    throw new Error(`Falha ao gerar a imagem: ${body.error || `Flow respondeu HTTP ${response.status}`}`);
  }
  return imagePath;
}

export class DiscordGatewayManager {
  private socket: WebSocket | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;
  private account: StoredConnectorAccount | null = null;
  private token = "";
  private fallbackChannelId = "";
  private sequence: number | null = null;
  private sessionId = "";
  private resumeGatewayUrl = "";
  private seenMessages = new Set<string>();
  private rateLimits = new Map<string, number[]>();
  private conversations = new Map<string, ConversationTurn[]>();
  private suppressedSockets = new WeakSet<WebSocket>();
  private status: DiscordGatewayRuntimeStatus = { state: "stopped", reconnectCount: 0 };

  getStatus() { return publicStatus(this.status); }

  async start(): Promise<void> {
    await this.reconcile();
  }

  async reconcile(): Promise<void> {
    const account = (await connectorStore.listAccounts()).find(discordInboundEnabled) || null;
    if (!account) return this.stop();
    const credentials: Record<string, string> = await connectorVault.read(account.id).catch(() => ({}));
    const token = credentials.botToken?.trim() || "";
    const fallbackChannelId = credentials.channelId?.trim() || "";
    if (!token || !fallbackChannelId) {
      this.setError("Discord bidirecional exige token do bot e ID de canal válidos.");
      return;
    }
    const changed = this.account?.id !== account.id || this.token !== token || JSON.stringify(this.account?.publicConfig) !== JSON.stringify(account.publicConfig);
    this.account = account;
    this.token = token;
    this.fallbackChannelId = fallbackChannelId;
    if (changed || !this.socket || this.socket.readyState === WebSocket.CLOSED) {
      this.closeSocket(true);
      this.status = { state: "connecting", accountId: account.id, reconnectCount: 0 };
      this.connect();
    }
  }

  stop(): void {
    this.intentionalClose = true;
    this.closeSocket(true);
    this.account = null;
    this.token = "";
    this.status = { state: "stopped", reconnectCount: 0 };
  }

  private connect(): void {
    if (!this.account || !this.token) return;
    this.intentionalClose = false;
    const gateway = (this.resumeGatewayUrl || DEFAULT_GATEWAY).replace(/\/$/, "");
    try {
      const socket = new WebSocket(`${gateway}/?v=${GATEWAY_VERSION}&encoding=json`);
      this.socket = socket;
      socket.addEventListener("message", (event) => { void this.onMessage(String(event.data)); });
      socket.addEventListener("close", (event) => this.onClose(socket, event.code, event.reason));
      socket.addEventListener("error", () => this.setError("Falha na conexão WebSocket com o Discord Gateway."));
    } catch (error) {
      this.setError(errorMessage(error));
      this.scheduleReconnect();
    }
  }

  private async onMessage(raw: string): Promise<void> {
    let payload: GatewayPayload;
    try { payload = JSON.parse(raw) as GatewayPayload; } catch { return; }
    if (typeof payload.s === "number") this.sequence = payload.s;
    this.status.lastEventAt = new Date().toISOString();
    if (payload.op === 10) return this.onHello(payload.d as { heartbeat_interval?: number });
    if (payload.op === 1) return this.send({ op: 1, d: this.sequence });
    if (payload.op === 7) return this.reconnectNow();
    if (payload.op === 9) {
      if (payload.d === false) { this.sessionId = ""; this.resumeGatewayUrl = ""; this.sequence = null; }
      return this.reconnectNow();
    }
    if (payload.op !== 0) return;
    if (payload.t === "READY") {
      const ready = payload.d as { session_id?: string; resume_gateway_url?: string; user?: { id?: string } };
      this.sessionId = ready.session_id || "";
      this.resumeGatewayUrl = ready.resume_gateway_url || "";
      this.status = { ...this.status, state: "connected", botUserId: ready.user?.id, connectedAt: new Date().toISOString(), lastError: undefined };
      console.info(`[DiscordGateway] status=connected accountId=${this.account?.id} botUserId=${ready.user?.id || "unknown"}`);
      return;
    }
    if (payload.t === "RESUMED") {
      this.status = { ...this.status, state: "connected", connectedAt: new Date().toISOString(), lastError: undefined };
      return;
    }
    if (payload.t === "MESSAGE_CREATE") await this.handleInbound(payload.d as DiscordInboundMessage);
  }

  private onHello(data: { heartbeat_interval?: number }): void {
    const interval = Math.max(1_000, Number(data.heartbeat_interval || 45_000));
    this.clearHeartbeat();
    this.heartbeatTimer = setInterval(() => this.send({ op: 1, d: this.sequence }), interval);
    this.heartbeatTimer.unref?.();
    if (this.sessionId && this.sequence !== null) {
      this.send({ op: 6, d: { token: this.token, session_id: this.sessionId, seq: this.sequence } });
    } else {
      this.send({ op: 2, d: { token: this.token, intents: GATEWAY_INTENTS, properties: { os: process.platform, browser: "mrchicken", device: "mrchicken" } } });
    }
  }

  private async handleInbound(message: DiscordInboundMessage): Promise<void> {
    if (!this.account || !this.status.botUserId || this.seenMessages.has(message.id)) return;
    this.rememberMessage(message.id);
    const decision = evaluateDiscordInbound(message, this.account, this.status.botUserId, this.fallbackChannelId);
    if (!decision.accepted) {
      if (decision.reason !== "not_mentioned" && decision.reason !== "bot") await this.auditIgnored(message, decision.reason);
      return;
    }
    if (!this.consumeRateLimit(decision.userId)) {
      await this.auditIgnored(message, "rate_limited");
      await this.postReply(message.channel_id, message.id, "Você enviou pedidos demais em pouco tempo. Aguarde um minuto e tente novamente.").catch(() => undefined);
      return;
    }

    const started = Date.now();
    const historyKey = `${message.channel_id}:${decision.userId}`;
    const recent = this.conversations.get(historyKey) || [];
    const audit: ConnectorInboundHistoryEntry = {
      id: crypto.randomUUID(), provider: "discord", accountId: this.account.id, messageId: message.id,
      channelId: message.channel_id, guildId: message.guild_id, userId: decision.userId, username: decision.username,
      receivedAt: new Date(started).toISOString(), status: "received", requestPreview: decision.prompt.slice(0, 200),
    };
    console.info(`[DiscordInbound] status=received messageId=${message.id} channelId=${message.channel_id} userId=${decision.userId}`);
    try {
      await fetch(`${API_ROOT}/channels/${message.channel_id}/typing`, { method: "POST", headers: authHeaders(this.token), signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
      let text: string;
      let reply: { id: string };
      const imageAttachment = getDiscordImageAttachment(message);
      if (requestsDiscordImageGeneration(decision.prompt) || imageAttachment) {
        const referenceImage = imageAttachment ? await downloadDiscordImageReference(imageAttachment) : undefined;
        const imagePath = await generateDiscordImage(decision.prompt, referenceImage, discordImageOperation(decision.prompt, Boolean(referenceImage)));
        text = "Aqui está a imagem que você pediu.";
        reply = await this.postImageReply(message.channel_id, message.id, text, imagePath);
      } else {
        const selectedSkill = skillRegistry.select(decision.prompt);
        const useTools = Boolean(selectedSkill.tools?.length || selectedSkill.preferredTools.length) && selectedSkill.id !== "general.execute-goal";
        const agentIdentity = await getConfiguredAgentIdentity();
        const response = await queryConfiguredAgentCli(buildDiscordAgentPrompt({ prompt: decision.prompt, username: decision.username, agentIdentity, recent }), {
          useExternalTools: useTools,
          toolIntentText: decision.prompt,
        });
        if (!response) throw new Error("O provedor Browser não pode atender mensagens do Discord em segundo plano. Selecione um provedor CLI ou API em Agente LLM.");
        text = normalizeDiscordAgentResponse(response);
        reply = await this.postReply(message.channel_id, message.id, text);
      }
      const updated: ConversationTurn[] = [...recent, { role: "user", content: decision.prompt }, { role: "assistant", content: text }];
      this.conversations.set(historyKey, updated.slice(-6));
      await connectorStore.appendInboundHistory({ ...audit, status: "responded", completedAt: new Date().toISOString(), durationMs: Date.now() - started, responsePreview: text.slice(0, 200), remoteReplyId: reply.id });
      console.info(`[DiscordInbound] status=responded messageId=${message.id} remoteReplyId=${reply.id}`);
    } catch (error) {
      const detail = errorMessage(error);
      await connectorStore.appendInboundHistory({ ...audit, status: "failed", completedAt: new Date().toISOString(), durationMs: Date.now() - started, error: detail });
      console.error(`[DiscordInbound] status=failed messageId=${message.id} error=${detail}`);
      await this.postReply(message.channel_id, message.id, `Não consegui responder agora: ${detail.slice(0, 1_500)}`).catch(() => undefined);
    }
  }

  private async postReply(channelId: string, messageId: string, content: string): Promise<{ id: string }> {
    const response = await fetch(`${API_ROOT}/channels/${channelId}/messages`, {
      method: "POST",
      headers: authHeaders(this.token),
      body: JSON.stringify({ content: content.slice(0, 1_900), allowed_mentions: { parse: [] }, message_reference: { message_id: messageId, fail_if_not_exists: false } }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !body.id) throw new Error(`Discord respondeu HTTP ${response.status}: ${body.message || "falha ao responder"}`);
    return { id: body.id };
  }

  private async postImageReply(channelId: string, messageId: string, content: string, imagePath: string): Promise<{ id: string }> {
    const bytes = await readFile(imagePath);
    const filename = path.basename(imagePath);
    const extension = path.extname(filename).toLowerCase();
    const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
    const form = new FormData();
    form.set("payload_json", JSON.stringify({ content, allowed_mentions: { parse: [] }, message_reference: { message_id: messageId, fail_if_not_exists: false } }));
    form.set("files[0]", new Blob([new Uint8Array(bytes)], { type: mimeType }), filename);
    const response = await fetch(`${API_ROOT}/channels/${channelId}/messages`, {
      method: "POST",
      headers: { authorization: `Bot ${this.token}`, accept: "application/json" },
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    const body = await response.json().catch(() => ({})) as { id?: string; message?: string };
    if (!response.ok || !body.id) throw new Error(`Discord respondeu HTTP ${response.status}: ${body.message || "falha ao enviar a imagem"}`);
    return { id: body.id };
  }

  private async auditIgnored(message: DiscordInboundMessage, reason: string): Promise<void> {
    if (!this.account) return;
    await connectorStore.appendInboundHistory({
      id: crypto.randomUUID(), provider: "discord", accountId: this.account.id, messageId: message.id,
      channelId: message.channel_id, guildId: message.guild_id, userId: message.author?.id || "unknown", username: message.author?.global_name || message.author?.username,
      receivedAt: new Date().toISOString(), completedAt: new Date().toISOString(), status: "ignored",
      requestPreview: (message.content || "").slice(0, 200), reason,
    });
  }

  private consumeRateLimit(userId: string): boolean {
    const now = Date.now();
    const maximum = Math.min(20, Math.max(1, Number(this.account?.publicConfig.maxRequestsPerMinute || 5)));
    const recent = (this.rateLimits.get(userId) || []).filter((time) => now - time < 60_000);
    if (recent.length >= maximum) { this.rateLimits.set(userId, recent); return false; }
    recent.push(now); this.rateLimits.set(userId, recent); return true;
  }

  private rememberMessage(id: string): void {
    this.seenMessages.add(id);
    if (this.seenMessages.size > MAX_SEEN_MESSAGES) this.seenMessages.delete(this.seenMessages.values().next().value!);
  }

  private send(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }

  private onClose(socket: WebSocket, code: number, reason: string): void {
    this.clearHeartbeat();
    if (this.socket === socket) this.socket = null;
    if (this.suppressedSockets.has(socket)) { this.suppressedSockets.delete(socket); return; }
    if (this.intentionalClose) return;
    const detail = `Discord Gateway encerrou (${code}${reason ? `: ${reason}` : ""}).`;
    if (code === 4014) this.setError(`${detail} Verifique os Gateway Intents no Discord Developer Portal.`);
    else this.setError(detail);
    this.scheduleReconnect();
  }

  private reconnectNow(): void {
    this.closeSocket(false);
    this.scheduleReconnect(1_000);
  }

  private scheduleReconnect(delay?: number): void {
    if (this.intentionalClose || !this.account || this.reconnectTimer) return;
    const reconnectCount = this.status.reconnectCount + 1;
    this.status.reconnectCount = reconnectCount;
    const wait = delay ?? Math.min(60_000, 1_000 * 2 ** Math.min(reconnectCount, 6));
    this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.status.state = "connecting"; this.connect(); }, wait);
    this.reconnectTimer.unref?.();
  }

  private closeSocket(clearReconnect: boolean): void {
    this.clearHeartbeat();
    if (clearReconnect && this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const socket = this.socket; this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      if (clearReconnect) this.suppressedSockets.add(socket);
      socket.close(1000, "reconfigure");
    }
  }

  private clearHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private setError(message: string): void {
    this.status = { ...this.status, state: "error", lastError: message };
    console.error(`[DiscordGateway] status=error error=${message}`);
  }
}

export const discordGatewayManager = globalManager().__mrChickenDiscordGateway ||= new DiscordGatewayManager();
