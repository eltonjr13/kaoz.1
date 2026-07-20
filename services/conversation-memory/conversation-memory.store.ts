import crypto from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getFlowStorageRoot } from "../../lib/runtime-paths.ts";
import type {
  ArchiveIdentity,
  ArchiveMessageInput,
  ArchiveSearchHit,
  ArchivedConversation,
  ArchivedMessage,
  ConsolidationJob,
  ConversationChannel,
  FlowConversationImport,
} from "./conversation-memory.types.ts";

const LOCAL_PROFILE_ID = "local-user";
const CONSOLIDATION_TURN_THRESHOLD = 12;

type Row = Record<string, unknown>;

export class ConversationMemoryStore {
  private db: DatabaseSync;

  constructor(databasePath = path.join(getFlowStorageRoot(), "conversation-memory.sqlite3")) {
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS channel_identities (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK(channel IN ('flow','telegram','discord')),
        account_id TEXT NOT NULL DEFAULT '',
        external_user_id TEXT NOT NULL,
        username TEXT,
        linked_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        UNIQUE(channel, account_id, external_user_id)
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        channel TEXT NOT NULL CHECK(channel IN ('flow','telegram','discord')),
        account_id TEXT NOT NULL DEFAULT '',
        external_conversation_id TEXT NOT NULL,
        identity_id TEXT NOT NULL REFERENCES channel_identities(id),
        profile_id TEXT NOT NULL REFERENCES profiles(id),
        title TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(channel, account_id, external_conversation_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        external_message_id TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user','assistant')),
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(conversation_id, external_message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_profile_updated ON conversations(profile_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS consolidation_state (
        profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
        user_turns_since_job INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS consolidation_jobs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK(status IN ('pending','running','completed','local_only','failed')),
        through_message_rowid INTEGER NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_consolidation_jobs_status ON consolidation_jobs(status, created_at);
      CREATE TABLE IF NOT EXISTS import_markers (
        source TEXT PRIMARY KEY,
        imported_at TEXT NOT NULL,
        details_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
      END;
      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content) VALUES ('delete', old.rowid, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `);
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO profiles(id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(LOCAL_PROFILE_ID, "Usuário local", now, now);
    this.db.prepare("INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, ?)").run(now);
    this.db.prepare("UPDATE consolidation_jobs SET status='pending', updated_at=? WHERE status='running'").run(now);
  }

  observeIdentity(input: {
    channel: ConversationChannel;
    accountId?: string;
    externalUserId: string;
    username?: string;
  }): ArchiveIdentity {
    const accountId = input.accountId || "";
    const id = stableId("identity", input.channel, accountId, input.externalUserId);
    const now = new Date().toISOString();
    this.db.prepare("INSERT OR IGNORE INTO profiles(id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, input.username || `${input.channel}:${input.externalUserId}`, now, now);
    this.db.prepare(`
      INSERT INTO channel_identities(id, channel, account_id, external_user_id, username, first_seen_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel, account_id, external_user_id) DO UPDATE SET
        username=COALESCE(excluded.username, channel_identities.username), last_seen_at=excluded.last_seen_at
    `).run(id, input.channel, accountId, input.externalUserId, input.username || null, now, now);
    return this.getIdentity(id)!;
  }

  getIdentity(id: string): ArchiveIdentity | null {
    const row = this.db.prepare("SELECT * FROM channel_identities WHERE id=?").get(id) as Row | undefined;
    return row ? mapIdentity(row) : null;
  }

  listIdentities(): ArchiveIdentity[] {
    return (this.db.prepare("SELECT * FROM channel_identities ORDER BY last_seen_at DESC").all() as Row[]).map(mapIdentity);
  }

  linkIdentity(identityId: string, profileId = LOCAL_PROFILE_ID): ArchiveIdentity | null {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare("UPDATE channel_identities SET linked_profile_id=?, last_seen_at=? WHERE id=?").run(profileId, now, identityId);
      this.db.prepare("UPDATE conversations SET profile_id=?, updated_at=? WHERE identity_id=?").run(profileId, now, identityId);
    });
    return this.getIdentity(identityId);
  }

  unlinkIdentity(identityId: string): ArchiveIdentity | null {
    const now = new Date().toISOString();
    this.transaction(() => {
      this.db.prepare("UPDATE channel_identities SET linked_profile_id=NULL, last_seen_at=? WHERE id=?").run(now, identityId);
      this.db.prepare("UPDATE conversations SET profile_id=?, updated_at=? WHERE identity_id=?").run(identityId, now, identityId);
    });
    return this.getIdentity(identityId);
  }

  upsertMessage(input: ArchiveMessageInput): { message: ArchivedMessage; consolidationJobCreated: boolean; profileId: string } {
    const cleanContent = input.content.trim();
    if (!cleanContent) throw new Error("Conteúdo da mensagem não pode ser vazio.");
    const identity = this.observeIdentity(input);
    const profileId = identity.effectiveProfileId;
    const accountId = input.accountId || "";
    const conversationId = stableId("conversation", input.channel, accountId, input.externalConversationId);
    const messageId = stableId("message", conversationId, input.messageId);
    const createdAt = input.createdAt || new Date().toISOString();
    let consolidationJobCreated = false;

    this.transaction(() => {
      this.db.prepare(`
        INSERT INTO conversations(id, channel, account_id, external_conversation_id, identity_id, profile_id, title, metadata_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(channel, account_id, external_conversation_id) DO UPDATE SET
          title=CASE WHEN excluded.title <> '' THEN excluded.title ELSE conversations.title END,
          profile_id=excluded.profile_id, identity_id=excluded.identity_id,
          metadata_json=excluded.metadata_json, updated_at=MAX(conversations.updated_at, excluded.updated_at)
      `).run(
        conversationId, input.channel, accountId, input.externalConversationId, identity.id, profileId,
        input.conversationTitle?.trim() || defaultTitle(input.channel, input.username),
        JSON.stringify(input.conversationMetadata || {}), createdAt, createdAt
      );
      const insert = this.db.prepare(`
        INSERT OR IGNORE INTO messages(id, conversation_id, external_message_id, role, content, metadata_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(messageId, conversationId, input.messageId, input.role, cleanContent, JSON.stringify(input.metadata || {}), createdAt);
      if (Number(insert.changes) > 0) {
        this.db.prepare("UPDATE conversations SET updated_at=MAX(updated_at, ?) WHERE id=?").run(createdAt, conversationId);
        if (input.role === "user") consolidationJobCreated = this.incrementConsolidation(profileId, createdAt);
      }
    });
    return { message: this.getMessage(messageId)!, consolidationJobCreated, profileId };
  }

  private incrementConsolidation(profileId: string, now: string): boolean {
    this.db.prepare(`
      INSERT INTO consolidation_state(profile_id, user_turns_since_job, updated_at) VALUES (?, 1, ?)
      ON CONFLICT(profile_id) DO UPDATE SET user_turns_since_job=user_turns_since_job+1, updated_at=excluded.updated_at
    `).run(profileId, now);
    const state = this.db.prepare("SELECT user_turns_since_job FROM consolidation_state WHERE profile_id=?").get(profileId) as Row;
    if (Number(state.user_turns_since_job) < CONSOLIDATION_TURN_THRESHOLD) return false;
    const existing = this.db.prepare("SELECT id FROM consolidation_jobs WHERE profile_id=? AND status IN ('pending','running') LIMIT 1").get(profileId);
    if (existing) return false;
    const through = this.db.prepare(`
      SELECT COALESCE(MAX(m.rowid), 0) AS value FROM messages m
      JOIN conversations c ON c.id=m.conversation_id WHERE c.profile_id=?
    `).get(profileId) as Row;
    this.db.prepare(`
      INSERT INTO consolidation_jobs(id, profile_id, status, through_message_rowid, attempts, created_at, updated_at)
      VALUES (?, ?, 'pending', ?, 0, ?, ?)
    `).run(crypto.randomUUID(), profileId, Number(through.value), now, now);
    this.db.prepare("UPDATE consolidation_state SET user_turns_since_job=0, updated_at=? WHERE profile_id=?").run(now, profileId);
    return true;
  }

  getMessage(id: string): ArchivedMessage | null {
    const row = this.db.prepare("SELECT * FROM messages WHERE id=?").get(id) as Row | undefined;
    return row ? mapMessage(row) : null;
  }

  getRecentTurns(conversationId: string, limit = 6): ArchivedMessage[] {
    const rows = this.db.prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?")
      .all(conversationId, Math.max(1, Math.min(limit, 50))) as Row[];
    return rows.reverse().map(mapMessage);
  }

  resolveConversationId(channel: ConversationChannel, accountId: string | undefined, externalConversationId: string): string {
    return stableId("conversation", channel, accountId || "", externalConversationId);
  }

  listConversations(input: { profileId?: string; channel?: ConversationChannel; limit?: number; offset?: number } = {}): ArchivedConversation[] {
    const clauses = ["c.profile_id=?"];
    const params: Array<string | number> = [input.profileId || LOCAL_PROFILE_ID];
    if (input.channel) { clauses.push("c.channel=?"); params.push(input.channel); }
    params.push(Math.max(1, Math.min(input.limit || 50, 200)), Math.max(0, input.offset || 0));
    const rows = this.db.prepare(`
      SELECT c.*, COUNT(m.id) AS message_count FROM conversations c
      LEFT JOIN messages m ON m.conversation_id=c.id
      WHERE ${clauses.join(" AND ")}
      GROUP BY c.id ORDER BY c.updated_at DESC LIMIT ? OFFSET ?
    `).all(...params) as Row[];
    return rows.map(mapConversation);
  }

  getConversation(conversationId: string, input: { limit?: number; offset?: number } = {}): { conversation: ArchivedConversation; messages: ArchivedMessage[] } | null {
    const row = this.db.prepare(`
      SELECT c.*, COUNT(m.id) AS message_count FROM conversations c LEFT JOIN messages m ON m.conversation_id=c.id WHERE c.id=? GROUP BY c.id
    `).get(conversationId) as Row | undefined;
    if (!row) return null;
    const messages = this.db.prepare("SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at, rowid LIMIT ? OFFSET ?")
      .all(conversationId, Math.max(1, Math.min(input.limit || 100, 500)), Math.max(0, input.offset || 0)) as Row[];
    return { conversation: mapConversation(row), messages: messages.map(mapMessage) };
  }

  search(input: { query: string; profileId?: string; channel?: ConversationChannel; from?: string; to?: string; limit?: number; excludeConversationId?: string }): ArchiveSearchHit[] {
    const ftsQuery = toFtsQuery(input.query);
    if (!ftsQuery) return [];
    const clauses = ["messages_fts MATCH ?", "c.profile_id=?"];
    const params: Array<string | number> = [ftsQuery, input.profileId || LOCAL_PROFILE_ID];
    if (input.channel) { clauses.push("c.channel=?"); params.push(input.channel); }
    if (input.from) { clauses.push("m.created_at>=?"); params.push(input.from); }
    if (input.to) { clauses.push("m.created_at<=?"); params.push(input.to); }
    if (input.excludeConversationId) { clauses.push("c.id<>?"); params.push(input.excludeConversationId); }
    params.push(Math.max(1, Math.min(input.limit || 6, 20)));
    const rows = this.db.prepare(`
      SELECT m.*, c.channel, c.title AS conversation_title, bm25(messages_fts) AS rank
      FROM messages_fts JOIN messages m ON m.rowid=messages_fts.rowid
      JOIN conversations c ON c.id=m.conversation_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY rank ASC, m.created_at DESC LIMIT ?
    `).all(...params) as Row[];
    return rows.map((row) => ({
      ...mapMessage(row),
      channel: String(row.channel) as ConversationChannel,
      conversationTitle: String(row.conversation_title),
      score: Number(row.rank),
      context: this.neighborMessages(String(row.conversation_id), String(row.id))
    }));
  }

  private neighborMessages(conversationId: string, messageId: string): ArchivedMessage[] {
    const target = this.db.prepare("SELECT rowid FROM messages WHERE id=?").get(messageId) as Row | undefined;
    if (!target) return [];
    return (this.db.prepare(`
      SELECT * FROM messages WHERE conversation_id=? AND rowid BETWEEN ? AND ? ORDER BY rowid
    `).all(conversationId, Number(target.rowid) - 1, Number(target.rowid) + 1) as Row[]).map(mapMessage);
  }

  deleteConversation(conversationId: string): { deleted: boolean; messageIds: string[] } {
    const ids = (this.db.prepare("SELECT id FROM messages WHERE conversation_id=?").all(conversationId) as Row[]).map((row) => String(row.id));
    const result = this.db.prepare("DELETE FROM conversations WHERE id=?").run(conversationId);
    return { deleted: Number(result.changes) > 0, messageIds: ids };
  }

  listMessageIdsForIdentity(identityId: string): string[] {
    return (this.db.prepare("SELECT m.id FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.identity_id=?").all(identityId) as Row[]).map((row) => String(row.id));
  }

  importFlowConversations(conversations: FlowConversationImport[]): { conversations: number; messages: number; alreadyImported: boolean } {
    const source = "flow-localstorage-v1";
    if (this.db.prepare("SELECT source FROM import_markers WHERE source=?").get(source)) {
      return { conversations: 0, messages: 0, alreadyImported: true };
    }
    let messageCount = 0;
    for (const conversation of conversations) {
      for (const message of conversation.messages) {
        this.upsertMessage({
          channel: "flow",
          externalUserId: LOCAL_PROFILE_ID,
          externalConversationId: conversation.id,
          conversationTitle: conversation.title,
          messageId: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.timestamp,
          metadata: message.metadata
        });
        messageCount += 1;
      }
    }
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO import_markers(source, imported_at, details_json) VALUES (?, ?, ?)")
      .run(source, now, JSON.stringify({ conversations: conversations.length, messages: messageCount }));
    return { conversations: conversations.length, messages: messageCount, alreadyImported: false };
  }

  claimNextConsolidationJob(): ConsolidationJob | null {
    let claimed: ConsolidationJob | null = null;
    this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM consolidation_jobs WHERE status='pending' ORDER BY created_at LIMIT 1").get() as Row | undefined;
      if (!row) return;
      const now = new Date().toISOString();
      this.db.prepare("UPDATE consolidation_jobs SET status='running', attempts=attempts+1, updated_at=? WHERE id=? AND status='pending'").run(now, row.id);
      const next = this.db.prepare("SELECT * FROM consolidation_jobs WHERE id=?").get(row.id) as Row;
      claimed = mapJob(next);
    });
    return claimed;
  }

  private transaction<T>(action: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getConsolidationMessages(job: ConsolidationJob, limit = 36): ArchivedMessage[] {
    const rows = this.db.prepare(`
      SELECT m.* FROM messages m JOIN conversations c ON c.id=m.conversation_id
      WHERE c.profile_id=? AND m.rowid<=? ORDER BY m.rowid DESC LIMIT ?
    `).all(job.profileId, job.throughMessageRowid, Math.max(1, Math.min(limit, 100))) as Row[];
    return rows.reverse().map(mapMessage);
  }

  completeConsolidationJob(jobId: string, status: "completed" | "local_only" | "failed", error?: string): void {
    this.db.prepare("UPDATE consolidation_jobs SET status=?, last_error=?, updated_at=? WHERE id=?")
      .run(status, error || null, new Date().toISOString(), jobId);
  }

  stats(): { conversations: number; messages: number; identities: number; pendingJobs: number; databaseBytes: number } {
    const row = this.db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM conversations) AS conversations,
        (SELECT COUNT(*) FROM messages) AS messages,
        (SELECT COUNT(*) FROM channel_identities) AS identities,
        (SELECT COUNT(*) FROM consolidation_jobs WHERE status IN ('pending','running')) AS pending_jobs,
        page_count * page_size AS database_bytes
      FROM pragma_page_count(), pragma_page_size()
    `).get() as Row;
    return {
      conversations: Number(row.conversations), messages: Number(row.messages), identities: Number(row.identities),
      pendingJobs: Number(row.pending_jobs), databaseBytes: Number(row.database_bytes)
    };
  }
}

let singleton: ConversationMemoryStore | undefined;
export function getConversationMemoryStore(): ConversationMemoryStore {
  singleton ||= new ConversationMemoryStore();
  return singleton;
}

function stableId(...parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
}

function defaultTitle(channel: ConversationChannel, username?: string): string {
  return username ? `${channel}: ${username}` : `Conversa ${channel}`;
}

function parseJson(value: unknown): Record<string, unknown> {
  try { return JSON.parse(String(value || "{}")) as Record<string, unknown>; } catch { return {}; }
}

function mapIdentity(row: Row): ArchiveIdentity {
  return {
    id: String(row.id), channel: String(row.channel) as ConversationChannel, accountId: String(row.account_id),
    externalUserId: String(row.external_user_id), username: row.username ? String(row.username) : undefined,
    linkedProfileId: row.linked_profile_id ? String(row.linked_profile_id) : undefined,
    effectiveProfileId: row.linked_profile_id ? String(row.linked_profile_id) : String(row.id),
    firstSeenAt: String(row.first_seen_at), lastSeenAt: String(row.last_seen_at)
  };
}

function mapMessage(row: Row): ArchivedMessage {
  return {
    id: String(row.id), conversationId: String(row.conversation_id), externalMessageId: String(row.external_message_id),
    role: String(row.role) as "user" | "assistant", content: String(row.content), createdAt: String(row.created_at), metadata: parseJson(row.metadata_json)
  };
}

function mapConversation(row: Row): ArchivedConversation {
  return {
    id: String(row.id), channel: String(row.channel) as ConversationChannel, accountId: String(row.account_id),
    externalConversationId: String(row.external_conversation_id), identityId: String(row.identity_id), profileId: String(row.profile_id),
    title: String(row.title), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    messageCount: Number(row.message_count || 0), metadata: parseJson(row.metadata_json)
  };
}

function mapJob(row: Row): ConsolidationJob {
  return {
    id: String(row.id), profileId: String(row.profile_id), status: String(row.status) as ConsolidationJob["status"],
    throughMessageRowid: Number(row.through_message_rowid), attempts: Number(row.attempts), createdAt: String(row.created_at),
    updatedAt: String(row.updated_at), lastError: row.last_error ? String(row.last_error) : undefined
  };
}

function toFtsQuery(value: string): string {
  const terms = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  return [...new Set(terms)].slice(0, 12).map((term) => `"${term.replace(/"/g, "")}"*`).join(" AND ");
}

export { LOCAL_PROFILE_ID, CONSOLIDATION_TURN_THRESHOLD };
