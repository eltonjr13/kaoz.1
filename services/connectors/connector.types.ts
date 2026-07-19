export type ConnectorProvider = "discord" | "bluesky" | "x" | "linkedin" | "telegram" | "youtube" | "instagram";

export type ConnectorCapability =
  | "publish_text"
  | "publish_image"
  | "publish_video"
  | "schedule"
  | "read_metrics"
  | "read_mentions";

export type ConnectorAvailability = "available" | "planned";
export type ConnectorHealth = "untested" | "connected" | "error" | "disabled";

export interface ConnectorDefinition {
  provider: ConnectorProvider;
  name: string;
  description: string;
  availability: ConnectorAvailability;
  capabilities: ConnectorCapability[];
  credentialFields: Array<{
    key: string;
    label: string;
    type: "text" | "password" | "url";
    placeholder?: string;
    required: boolean;
  }>;
}

export interface ConnectorAccount {
  id: string;
  provider: ConnectorProvider;
  displayName: string;
  enabled: boolean;
  health: ConnectorHealth;
  hasCredentials: boolean;
  publicConfig: Record<string, string>;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export type StoredConnectorAccount = Omit<ConnectorAccount, "hasCredentials">;

export interface ConnectorMedia {
  path: string;
  alt?: string;
}

export interface ConnectorPublishInput {
  text: string;
  media?: ConnectorMedia[];
}

export interface ConnectorPublishResult {
  remoteId: string;
  url?: string;
  provider: ConnectorProvider;
  accountId: string;
  publishedAt: string;
}

export interface ConnectorHistoryEntry extends ConnectorPublishResult {
  id: string;
  status: "published" | "failed";
  textPreview: string;
  error?: string;
}

export type ConnectorInboundStatus = "received" | "ignored" | "responded" | "failed";

export interface ConnectorInboundHistoryEntry {
  id: string;
  provider: "discord" | "telegram";
  accountId: string;
  messageId: string;
  channelId: string;
  guildId?: string;
  userId: string;
  username?: string;
  receivedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: ConnectorInboundStatus;
  requestPreview: string;
  responsePreview?: string;
  remoteReplyId?: string;
  error?: string;
  reason?: string;
}

export interface DiscordGatewayRuntimeStatus {
  state: "stopped" | "connecting" | "connected" | "error";
  accountId?: string;
  botUserId?: string;
  connectedAt?: string;
  lastEventAt?: string;
  lastError?: string;
  reconnectCount: number;
}

export interface TelegramPollingRuntimeStatus {
  state: "stopped" | "connecting" | "connected" | "error";
  accountId?: string;
  botUserId?: string;
  connectedAt?: string;
  lastEventAt?: string;
  lastError?: string;
  reconnectCount: number;
}

export interface ConnectorAdapter {
  test(credentials: Record<string, string>, signal?: AbortSignal): Promise<{ displayName?: string; publicConfig?: Record<string, string> }>;
  publish(
    account: StoredConnectorAccount,
    credentials: Record<string, string>,
    input: ConnectorPublishInput,
    signal?: AbortSignal
  ): Promise<Omit<ConnectorPublishResult, "provider" | "accountId" | "publishedAt">>;
}
