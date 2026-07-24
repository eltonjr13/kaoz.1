import type { AgentId } from "../core/agent-id.ts";
import type { Envelope } from "./envelope.ts";

export interface AgentMailboxOptions {
  readonly capacity?: number;
}

interface MailboxItem {
  readonly envelope: Envelope;
  readonly sequence: number;
}

export class AgentMailbox {
  readonly agentId: AgentId;

  private readonly capacity: number;
  private readonly queue: MailboxItem[] = [];
  private sequence = 0;
  private closed = false;

  constructor(agentId: AgentId, options: AgentMailboxOptions = {}) {
    this.agentId = agentId;
    this.capacity = options.capacity ?? Number.POSITIVE_INFINITY;
    if (
      this.capacity !== Number.POSITIVE_INFINITY &&
      (!Number.isInteger(this.capacity) || this.capacity <= 0)
    ) {
      throw new Error("AgentMailbox capacity must be a positive integer.");
    }
  }

  get size(): number {
    return this.queue.length;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  enqueue(envelope: Envelope): void {
    if (this.closed) {
      throw new Error(`Mailbox "${this.agentId}" is closed.`);
    }
    if (this.queue.length >= this.capacity) {
      throw new Error(`Mailbox "${this.agentId}" capacity was exceeded.`);
    }

    const item: MailboxItem = {
      envelope,
      sequence: this.sequence++,
    };
    const insertionIndex = this.queue.findIndex(
      (queued) =>
        queued.envelope.priority < envelope.priority ||
        (queued.envelope.priority === envelope.priority &&
          queued.sequence > item.sequence),
    );
    if (insertionIndex === -1) {
      this.queue.push(item);
      return;
    }
    this.queue.splice(insertionIndex, 0, item);
  }

  dequeue(): Envelope | undefined {
    return this.queue.shift()?.envelope;
  }

  peek(): Envelope | undefined {
    return this.queue[0]?.envelope;
  }

  snapshot(): readonly Envelope[] {
    return Object.freeze(this.queue.map((item) => item.envelope));
  }

  clear(): readonly Envelope[] {
    const removed = this.queue.splice(0).map((item) => item.envelope);
    return Object.freeze(removed);
  }

  close(): readonly Envelope[] {
    this.closed = true;
    return this.clear();
  }
}
