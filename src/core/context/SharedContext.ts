export type SharedContextSnapshot = Record<string, unknown>;

export class SharedContext {
  private readonly values = new Map<string, unknown>();

  constructor(initialValues: SharedContextSnapshot = {}) {
    Object.entries(initialValues).forEach(([key, value]) => {
      this.values.set(key, value);
    });
  }

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  merge(values: SharedContextSnapshot): void {
    Object.entries(values).forEach(([key, value]) => {
      this.values.set(key, value);
    });
  }

  snapshot(): SharedContextSnapshot {
    return Object.fromEntries(this.values.entries());
  }
}
