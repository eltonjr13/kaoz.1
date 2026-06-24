export type CognitiveEventType = 
  | 'EPISODE_RECORDED' 
  | 'EPISODE_UPDATED' 
  | 'RULE_REINFORCED'
  | 'GRAPH_UPDATED';

export type EventHandler<T = any> = (data: T) => Promise<void> | void;

export class EventBus {
  private static instance: EventBus;
  private listeners: Map<CognitiveEventType, Set<EventHandler>> = new Map();

  private constructor() {}

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  public subscribe(event: CognitiveEventType, handler: EventHandler): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
  }

  public publish(event: CognitiveEventType, data: any): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;

    // Executa assincronamente fora do fluxo principal
    for (const handler of handlers) {
      setImmediate(async () => {
        try {
          await handler(data);
        } catch (err) {
          console.error(`[EventBus] Erro ao tratar evento ${event}:`, err);
        }
      });
    }
  }
}
