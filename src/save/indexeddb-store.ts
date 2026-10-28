import type { KeyValueStore } from './store';

const STORE = 'kv';

/** {@link KeyValueStore} on IndexedDB. One object store of string values. */
export class IndexedDbStore implements KeyValueStore {
  private readonly db: Promise<IDBDatabase>;

  constructor(name = 'soul-craft') {
    this.db = new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    });
  }

  get(key: string): Promise<string | undefined> {
    return this.request('readonly', (s) => s.get(key) as IDBRequest<string | undefined>);
  }

  async set(key: string, value: string): Promise<void> {
    await this.request('readwrite', (s) => s.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.request('readwrite', (s) => s.delete(key));
  }

  async keys(prefix = ''): Promise<string[]> {
    const all = await this.request('readonly', (s) => s.getAllKeys());
    return all.map(String).filter((k) => k.startsWith(prefix));
  }

  private async request<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
  }
}
