const stores = new Map<string, Map<string, unknown>>();

export class Store {
  private values: Map<string, unknown>;

  constructor(path: string) {
    if (!stores.has(path)) stores.set(path, new Map());
    this.values = stores.get(path) ?? new Map();
  }

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async save(): Promise<void> {}
}

export const load = async (path: string) => new Store(path);
