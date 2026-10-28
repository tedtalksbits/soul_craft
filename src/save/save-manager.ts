import { MIGRATIONS, parseSave, SaveError, type Migration, type SaveFile, type SaveMeta } from './format';
import type { KeyValueStore } from './store';

export const SAVE_SLOTS = ['1', '2', '3'] as const;
export type SaveSlot = (typeof SAVE_SLOTS)[number];

export interface SlotInfo {
  slot: SaveSlot;
  meta: SaveMeta | null;
  /** Set when the slot holds data that could not be read (even from its backup). */
  error?: string;
}

export interface LoadResult {
  save: SaveFile;
  /** The primary copy was unreadable and the previous save was used instead. */
  fromBackup: boolean;
}

const primaryKey = (slot: string) => `save:${slot}`;
const backupKey = (slot: string) => `save:${slot}:backup`;

/**
 * Slot-based saves with one rolling backup per slot. Each write first copies
 * the current save to the backup, so a corrupted or interrupted write never
 * loses more than one save's progress.
 */
export class SaveManager {
  constructor(
    private readonly store: KeyValueStore,
    private readonly migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  ) {}

  async list(): Promise<SlotInfo[]> {
    return Promise.all(
      SAVE_SLOTS.map(async (slot): Promise<SlotInfo> => {
        try {
          const loaded = await this.load(slot);
          return { slot, meta: loaded?.save.meta ?? null };
        } catch (err) {
          return { slot, meta: null, error: err instanceof Error ? err.message : String(err) };
        }
      }),
    );
  }

  async save(slot: SaveSlot, save: SaveFile): Promise<void> {
    const previous = await this.store.get(primaryKey(slot));
    if (previous !== undefined) await this.store.set(backupKey(slot), previous);
    await this.store.set(primaryKey(slot), JSON.stringify(save));
  }

  /** Returns null for an empty slot; throws SaveError if neither copy is readable. */
  async load(slot: SaveSlot): Promise<LoadResult | null> {
    const primary = await this.store.get(primaryKey(slot));
    const backup = await this.store.get(backupKey(slot));
    if (primary === undefined && backup === undefined) return null;
    let primaryError: unknown;
    if (primary !== undefined) {
      try {
        return { save: this.parse(primary), fromBackup: false };
      } catch (err) {
        primaryError = err;
      }
    }
    if (backup !== undefined) {
      try {
        return { save: this.parse(backup), fromBackup: true };
      } catch {
        // Fall through and report the primary's error, which is the more useful one.
      }
    }
    throw primaryError instanceof Error ? primaryError : new SaveError('save is unreadable');
  }

  async delete(slot: SaveSlot): Promise<void> {
    await this.store.delete(primaryKey(slot));
    await this.store.delete(backupKey(slot));
  }

  private parse(json: string): SaveFile {
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      throw new SaveError('save is not valid JSON');
    }
    return parseSave(raw, this.migrations);
  }
}
