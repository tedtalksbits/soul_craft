/**
 * Minimal async string store. IndexedDB backs it in the browser; a desktop
 * build can swap in a filesystem store; tests use the in-memory one.
 */
export interface KeyValueStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.data.get(key));
  }
  set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
  delete(key: string): Promise<void> {
    this.data.delete(key);
    return Promise.resolve();
  }
  keys(prefix = ''): Promise<string[]> {
    return Promise.resolve([...this.data.keys()].filter((k) => k.startsWith(prefix)));
  }
}
