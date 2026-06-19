export interface DomainEvent {
  type: string;
  message: string;
  jobId?: string;
  metadata?: Record<string, unknown> | null;
  createdAt?: string;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
}
