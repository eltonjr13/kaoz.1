import { createLocalJobEvent } from "@/lib/local-store";
import type { DomainEvent, EventBus } from "./EventBus";

export class LocalJobEventBus implements EventBus {
  async publish(event: DomainEvent): Promise<void> {
    if (!event.jobId) return;

    await createLocalJobEvent(
      event.jobId,
      event.type,
      event.message,
      event.metadata
    );
  }
}
