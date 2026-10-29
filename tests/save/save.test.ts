import { describe, expect, it } from 'vitest';
import { createSave, parseSave, SAVE_FORMAT, SAVE_VERSION, SaveError } from '../../src/save/format';
import { SaveManager } from '../../src/save/save-manager';
import { MemoryStore } from '../../src/save/store';
import { Player } from '../../src/sim/components';
import { Simulation } from '../../src/sim/simulation';
import { content, newSim, run } from '../helpers';

describe('save format', () => {
  it('round-trips a game through JSON', () => {
    const sim = newSim(12);
    run(sim, 120, { moveX: 1, moveY: 1, aim: null, pressed: 0, held: 0 });
    sim.ecs.need(sim.player, Player).souls = 77;
    const file = parseSave(JSON.parse(JSON.stringify(createSave(sim, '1', new Date('2026-01-01')))));
    expect(file.meta).toMatchObject({ slot: '1', souls: 77, seed: 12, playTicks: 120 });
    expect(Simulation.restore(file.snapshot, content).snapshot()).toEqual(sim.snapshot());
  });

  it('applies migrations in order and rejects saves it cannot read', () => {
    const current = createSave(newSim(), '1');
    const v0 = {
      ...current,
      version: SAVE_VERSION - 1,
      meta: { ...current.meta, slot: undefined, slotName: '1' },
    };
    const migrated = parseSave(v0, {
      [SAVE_VERSION - 1]: (s) => {
        const { slotName, ...meta } = s['meta'] as Record<string, unknown>;
        return { ...s, meta: { ...meta, slot: slotName } };
      },
    });
    expect(migrated.meta.slot).toBe('1');
    expect(migrated.version).toBe(SAVE_VERSION);

    expect(() => parseSave(v0, {})).toThrow(/no migration from save version/);
    expect(() => parseSave({ ...current, version: SAVE_VERSION + 1 })).toThrow(/newer version/);
    expect(() => parseSave({ format: 'other' })).toThrow(SaveError);
    expect(() => parseSave({ format: SAVE_FORMAT, version: SAVE_VERSION, meta: {} })).toThrow(/malformed/);
  });
});

describe('SaveManager', () => {
  it('lists slots with their metadata', async () => {
    const saves = new SaveManager(new MemoryStore());
    await saves.save('2', createSave(newSim(5), '2'));
    const slots = await saves.list();
    expect(slots.map((s) => s.meta?.seed ?? null)).toEqual([null, 5, null]);
  });

  it('keeps the previous save as a backup and recovers from a corrupt write', async () => {
    const store = new MemoryStore();
    const saves = new SaveManager(store);
    const sim = newSim(8);
    await saves.save('1', createSave(sim, '1'));
    sim.ecs.need(sim.player, Player).souls = 500;
    await saves.save('1', createSave(sim, '1'));

    expect((await saves.load('1'))?.save.meta.souls).toBe(500);
    store.data.set('save:1', '{"truncated');
    const recovered = await saves.load('1');
    expect(recovered?.fromBackup).toBe(true);
    expect(recovered?.save.meta.souls).toBe(0);
  });

  it('returns null for an empty slot and deletes both copies', async () => {
    const store = new MemoryStore();
    const saves = new SaveManager(store);
    expect(await saves.load('3')).toBeNull();
    await saves.save('3', createSave(newSim(), '3'));
    await saves.save('3', createSave(newSim(), '3'));
    await saves.delete('3');
    expect(store.data.size).toBe(0);
  });
});

describe('shipped migrations', () => {
  it('v1 -> v2 adds empty tile damage and the save loads', () => {
    const current = createSave(newSim(4), '1');
    const v1State = Object.fromEntries(
      Object.entries(current.snapshot.state).filter(([k]) => k !== 'tileDamage'),
    );
    const v1 = { ...current, version: 1, snapshot: { ...current.snapshot, state: v1State } };
    const migrated = parseSave(JSON.parse(JSON.stringify(v1)));
    expect(migrated.version).toBe(SAVE_VERSION);
    expect(migrated.snapshot.state.tileDamage).toEqual({});
    expect(() => Simulation.restore(migrated.snapshot, content)).not.toThrow();
  });
});
