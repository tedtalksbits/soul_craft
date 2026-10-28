import { createSave, parseSave, type SaveFile } from './format';
import type { KeyValueStore } from './store';
import type { Simulation } from '../sim/simulation';

const PREFIX = 'snapshot:';

/**
 * Named dev snapshots of the full game state, kept apart from player saves.
 * Same envelope as a save, so an exported snapshot can also be loaded as one.
 */
export class SnapshotLibrary {
  constructor(private readonly store: KeyValueStore) {}

  async take(sim: Simulation, name: string): Promise<SaveFile> {
    const file = createSave(sim, `snapshot:${name}`);
    await this.store.set(PREFIX + name, JSON.stringify(file));
    return file;
  }

  async get(name: string): Promise<SaveFile | undefined> {
    const json = await this.store.get(PREFIX + name);
    return json === undefined ? undefined : parseSave(JSON.parse(json));
  }

  async names(): Promise<string[]> {
    return (await this.store.keys(PREFIX)).map((k) => k.slice(PREFIX.length)).sort();
  }

  async delete(name: string): Promise<void> {
    await this.store.delete(PREFIX + name);
  }
}
