/**
 * A small entity-component store.
 *
 * Components are plain, JSON-serializable data, so the whole world can be
 * snapshotted, saved and restored exactly. Behavior lives in systems
 * (src/sim/modules), never on components.
 */

export type Entity = number;

export interface ComponentType<T> {
  readonly name: string;
  /** Phantom field that carries `T` for inference. Never set at runtime. */
  readonly __type?: T;
}

export type ComponentValue<C> = C extends ComponentType<infer T> ? T : never;
type ComponentValues<C extends readonly ComponentType<unknown>[]> = {
  [K in keyof C]: ComponentValue<C[K]>;
};

export function defineComponent<T>(name: string): ComponentType<T> {
  return { name };
}

export interface EcsSnapshot {
  nextId: number;
  entities: Entity[];
  components: Record<string, [Entity, unknown][]>;
}

export class World {
  private nextId = 1;
  private readonly alive = new Set<Entity>();
  private readonly doomed = new Set<Entity>();
  private readonly stores = new Map<string, Map<Entity, unknown>>();

  create(): Entity {
    const e = this.nextId++;
    this.alive.add(e);
    return e;
  }

  /** True while the entity exists and has not been marked for destruction. */
  isAlive(e: Entity): boolean {
    return this.alive.has(e) && !this.doomed.has(e);
  }

  /**
   * Marks an entity for removal. It disappears from queries immediately and is
   * deleted in {@link flush}, so systems can destroy while iterating.
   */
  destroy(e: Entity): void {
    if (this.alive.has(e)) this.doomed.add(e);
  }

  flush(): void {
    if (this.doomed.size === 0) return;
    for (const e of this.doomed) {
      for (const store of this.stores.values()) store.delete(e);
      this.alive.delete(e);
    }
    this.doomed.clear();
  }

  add<T>(e: Entity, type: ComponentType<T>, value: T): T {
    if (!this.alive.has(e)) throw new Error(`Cannot add ${type.name} to missing entity ${e}`);
    this.storeFor(type).set(e, value);
    return value;
  }

  get<T>(e: Entity, type: ComponentType<T>): T | undefined {
    return this.stores.get(type.name)?.get(e) as T | undefined;
  }

  /** Like {@link get} but throws when the component is missing. Use where absence is a bug. */
  need<T>(e: Entity, type: ComponentType<T>): T {
    const value = this.get(e, type);
    if (value === undefined) throw new Error(`Entity ${e} has no ${type.name}`);
    return value;
  }

  has(e: Entity, type: ComponentType<unknown>): boolean {
    return this.stores.get(type.name)?.has(e) ?? false;
  }

  remove(e: Entity, type: ComponentType<unknown>): void {
    this.stores.get(type.name)?.delete(e);
  }

  /** Iterates entities that have every listed component, yielding `[entity, ...values]`. */
  *query<const C extends readonly ComponentType<unknown>[]>(
    ...types: C
  ): Generator<[Entity, ...ComponentValues<C>]> {
    const stores = types.map((t) => this.stores.get(t.name));
    if (stores.some((s) => s === undefined)) return;
    const present = stores as Map<Entity, unknown>[];
    // Drive iteration from the smallest store.
    let driver = present[0];
    for (const s of present) if (driver === undefined || s.size < driver.size) driver = s;
    if (driver === undefined) return;
    for (const e of driver.keys()) {
      if (this.doomed.has(e)) continue;
      const row: unknown[] = [e];
      let complete = true;
      for (const s of present) {
        const v = s.get(e);
        if (v === undefined) {
          complete = false;
          break;
        }
        row.push(v);
      }
      if (complete) yield row as [Entity, ...ComponentValues<C>];
    }
  }

  /** The first live entity with the component, if any. Handy for singletons like the player. */
  first(type: ComponentType<unknown>): Entity | undefined {
    for (const e of this.stores.get(type.name)?.keys() ?? []) if (!this.doomed.has(e)) return e;
    return undefined;
  }

  get entityCount(): number {
    return this.alive.size - this.doomed.size;
  }

  snapshot(): EcsSnapshot {
    this.flush();
    const components: EcsSnapshot['components'] = {};
    for (const [name, store] of this.stores) {
      if (store.size > 0) components[name] = [...store].map(([e, v]) => [e, structuredClone(v)]);
    }
    return { nextId: this.nextId, entities: [...this.alive], components };
  }

  static fromSnapshot(snap: EcsSnapshot): World {
    const w = new World();
    w.nextId = snap.nextId;
    for (const e of snap.entities) w.alive.add(e);
    for (const [name, rows] of Object.entries(snap.components)) {
      w.stores.set(name, new Map(rows.map(([e, v]) => [e, structuredClone(v)])));
    }
    return w;
  }

  private storeFor(type: ComponentType<unknown>): Map<Entity, unknown> {
    let store = this.stores.get(type.name);
    if (!store) {
      store = new Map();
      this.stores.set(type.name, store);
    }
    return store;
  }
}
