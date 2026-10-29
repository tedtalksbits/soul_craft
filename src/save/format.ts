/**
 * On-disk save format. A save is an envelope (format tag, version, metadata
 * for the slot list) around a full simulation snapshot. Dev snapshots use the
 * same envelope, so export/import and migrations work identically for both.
 *
 * Changing anything in SimSnapshot or a component's shape? Bump SAVE_VERSION
 * and add a migration from the previous version. See docs/saves.md.
 */
import { z } from 'zod';
import { Abilities, Player } from '../sim/components';
import type { SimSnapshot, Simulation } from '../sim/simulation';

export const SAVE_FORMAT = 'soul-craft-save';
export const SAVE_VERSION = 4;

const SnapshotSchema = z.looseObject({
  version: z.number().int(),
  tick: z.number().int().nonnegative(),
  hitstop: z.number(),
  carriedPresses: z.number(),
  rng: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  state: z.looseObject({ seed: z.number() }),
  ecs: z.object({
    nextId: z.number().int(),
    entities: z.array(z.number().int()),
    components: z.record(z.string(), z.array(z.tuple([z.number().int(), z.unknown()]))),
  }),
  loadedChunks: z.array(z.string()),
});

const MetaSchema = z.object({
  slot: z.string(),
  savedAt: z.string(),
  playTicks: z.number().int().nonnegative(),
  location: z.string(),
  souls: z.number(),
  seed: z.number(),
  /** The class played, for the slot list. Optional: saves from before classes have none. */
  playerClass: z.string().optional(),
});
export type SaveMeta = z.infer<typeof MetaSchema>;

const SaveFileSchema = z.object({
  format: z.literal(SAVE_FORMAT),
  version: z.number().int(),
  meta: MetaSchema,
  snapshot: SnapshotSchema,
});

export interface SaveFile {
  format: typeof SAVE_FORMAT;
  version: number;
  meta: SaveMeta;
  snapshot: SimSnapshot;
}

export class SaveError extends Error {}

/** Upgrades a version-n save object to version n+1. Pure: must not mutate its input. */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>;

/**
 * `MIGRATIONS[n]` upgrades a version-n file to n+1. Never edit a shipped
 * migration; add a new one.
 */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {
  /** v1 -> v2: trees and mushrooms became multi-hit; SimState gained `tileDamage`. */
  1: (save) => {
    const snapshot = asRecord(save['snapshot']);
    const state = asRecord(snapshot['state']);
    return { ...save, snapshot: { ...snapshot, state: { tileDamage: {}, ...state } } };
  },
  /**
   * v2 -> v3: items and crafting. The player gains an inventory (empty), equipment (the
   * starting Chipped Sword), buffs and `using`; pickups gain `item`.
   */
  2: (save) => {
    const snapshot = asRecord(save['snapshot']);
    const ecs = asRecord(snapshot['ecs']);
    const components = asRecord(ecs['components']) as Record<string, [number, unknown][]>;
    const playerRow = components['player']?.[0];
    if (!playerRow) throw new SaveError('save has no player');
    const [player, value] = playerRow;
    return {
      ...save,
      snapshot: {
        ...snapshot,
        ecs: {
          ...ecs,
          components: {
            ...components,
            player: [[player, { ...asRecord(value), using: null }]],
            inventory: [[player, { stacks: [] }]],
            equipment: [
              [
                player,
                {
                  weapon: { item: 'chipped_sword', count: 1, level: 0 },
                  armor: null,
                  ring0: null,
                  ring1: null,
                  quick: null,
                },
              ],
            ],
            buffs: [[player, { active: [] }]],
            pickup: (components['pickup'] ?? []).map(([e, p]) => [e, { ...asRecord(p), item: null }]),
          },
        },
      },
    };
  },
  /** v3 -> v4: classes. The player becomes a Vanguard with every ability ready and no super energy. */
  3: (save) => {
    const snapshot = asRecord(save['snapshot']);
    const ecs = asRecord(snapshot['ecs']);
    const components = asRecord(ecs['components']) as Record<string, [number, unknown][]>;
    const playerRow = components['player']?.[0];
    if (!playerRow) throw new SaveError('save has no player');
    const abilities = { class: 'vanguard', cooldowns: { aoe: 0, class: 0 }, energy: 0, casting: null };
    return {
      ...save,
      snapshot: {
        ...snapshot,
        ecs: { ...ecs, components: { ...components, abilities: [[playerRow[0], abilities]] } },
      },
    };
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new SaveError('save is missing its snapshot state');
  return value as Record<string, unknown>;
}

export function createSave(sim: Simulation, slot: string, now: Date = new Date()): SaveFile {
  const player = sim.ecs.need(sim.player, Player);
  return {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    meta: {
      slot,
      savedAt: now.toISOString(),
      playTicks: sim.tick,
      location: sim.state.currentArea ?? 'Unknown',
      souls: player.souls,
      playerClass: sim.ecs.get(sim.player, Abilities)?.class,
      seed: sim.state.seed,
    },
    snapshot: sim.snapshot(),
  };
}

/** Parses, migrates and validates a save from untrusted JSON (storage, file import). */
export function parseSave(
  raw: unknown,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  target: number = SAVE_VERSION,
): SaveFile {
  if (typeof raw !== 'object' || raw === null) throw new SaveError('save is not an object');
  let save = raw as Record<string, unknown>;
  if (save['format'] !== SAVE_FORMAT) throw new SaveError('not a Soul Craft save');
  let version = save['version'];
  if (typeof version !== 'number') throw new SaveError('save has no version');
  if (version > target)
    throw new SaveError(`save is from a newer version (${version}); this build reads up to ${target}`);
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new SaveError(`no migration from save version ${version}`);
    save = { ...step(save), version: version + 1 };
    version++;
  }
  const result = SaveFileSchema.safeParse(save);
  if (!result.success) throw new SaveError(`save is malformed: ${z.prettifyError(result.error)}`);
  return result.data as unknown as SaveFile;
}
