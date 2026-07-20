export type ConversationChannel = "flow" | "telegram" | "discord";
export type ConversationRole = "user" | "assistant";

export interface ArchiveIdentity {
  id: string;
  channel: ConversationChannel;
  accountId: string;
  externalUserId: string;
  username?: string;
  linkedProfileId?: string;
  effectiveProfileId: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ArchivedConversation {
  id: string;
  channel: ConversationChannel;
  accountId: string;
  externalConversationId: string;
  identityId: string;
  profileId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  metadata?: Record<string, unknown>;
}

export interface ArchivedMessage {
  id: string;
  conversationId: string;
  externalMessageId: string;
  role: ConversationRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface ArchiveMessageInput {
  channel: ConversationChannel;
  accountId?: string;
  externalUserId: string;
  username?: string;
  externalConversationId: string;
  conversationTitle?: string;
  conversationMetadata?: Record<string, unknown>;
  messageId: string;
  role: ConversationRole;
  content: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export interface ArchiveSearchHit extends ArchivedMessage {
  channel: ConversationChannel;
  conversationTitle: string;
  score: number;
  context: ArchivedMessage[];
}

export interface FlowConversationImport {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Array<{
    id: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    metadata?: Record<string, unknown>;
  }>;
}

export type ConsolidationJobStatus = "pending" | "running" | "completed" | "local_only" | "failed";

export interface ConsolidationJob {
  id: string;
  profileId: string;
  status: ConsolidationJobStatus;
  throughMessageRowid: number;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
}
