import { describe, expect, it } from 'vitest';
import { createSave, parseSave, SAVE_FORMAT, SAVE_VERSION, SaveError } from '../../src/save/format';
import { SaveManager } from '../../src/save/save-manager';
import { MemoryStore } from '../../src/save/store';
import { Abilities, Attributes, Equipment, Inventory, Player } from '../../src/sim/components';
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

describe('v2 -> v3', () => {
  it('gives an old save the starting kit and keeps loading', () => {
    const current = createSave(newSim(6), '1');
    const components = { ...current.snapshot.ecs.components };
    for (const key of ['inventory', 'equipment', 'buffs']) Reflect.deleteProperty(components, key);
    const v2 = {
      ...current,
      version: 2,
      snapshot: { ...current.snapshot, ecs: { ...current.snapshot.ecs, components } },
    };
    const migrated = parseSave(JSON.parse(JSON.stringify(v2)));
    const sim = Simulation.restore(migrated.snapshot, content);
    expect(sim.ecs.need(sim.player, Equipment).weapon?.item).toBe('chipped_sword');
    expect(sim.ecs.need(sim.player, Inventory).stacks).toEqual([]);
  });
});

describe('v3 -> v4', () => {
  it('makes an old save a Vanguard with every ability ready', () => {
    const current = createSave(newSim(7), '1');
    const components = { ...current.snapshot.ecs.components };
    Reflect.deleteProperty(components, 'abilities');
    const v3 = {
      ...current,
      version: 3,
      snapshot: { ...current.snapshot, ecs: { ...current.snapshot.ecs, components } },
    };
    const migrated = parseSave(JSON.parse(JSON.stringify(v3)));
    const sim = Simulation.restore(migrated.snapshot, content);
    expect(sim.ecs.need(sim.player, Abilities)).toEqual({
      class: 'vanguard',
      cooldowns: { aoe: 0, class: 0 },
      energy: 0,
      unlocked: { class: true, super: true },
      casting: null,
    });
  });
});

describe('slot metadata', () => {
  it('records the class played, for the slot list', () => {
    const sim = Simulation.create({ seed: 8, content, playerClass: 'stalker' });
    const save = parseSave(JSON.parse(JSON.stringify(createSave(sim, '2'))));
    expect(save.meta.playerClass).toBe('stalker');
  });
});

describe('v4 -> v5', () => {
  it('keeps every ability an old save had, and starts it at level 1', () => {
    const current = createSave(newSim(9), '1');
    const components = { ...current.snapshot.ecs.components };
    Reflect.deleteProperty(components, 'attributes');
    components['abilities'] = (components['abilities'] ?? []).map(([e, a]) => {
      const rest: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      Reflect.deleteProperty(rest, 'unlocked');
      return [e, rest];
    });
    const v4 = {
      ...current,
      version: 4,
      snapshot: { ...current.snapshot, ecs: { ...current.snapshot.ecs, components } },
    };
    const migrated = parseSave(JSON.parse(JSON.stringify(v4)));
    const sim = Simulation.restore(migrated.snapshot, content);
    expect(sim.ecs.need(sim.player, Abilities).unlocked).toEqual({ class: true, super: true });
    expect(sim.ecs.need(sim.player, Attributes)).toEqual({ vigor: 0, endurance: 0, might: 0, attunement: 0 });
  });
});

describe('v5 -> v6', () => {
  it('gives an old save an empty bonfire registry that fills as lit bonfires load', () => {
    const current = createSave(newSim(9), '1');
    const v5State = Object.fromEntries(
      Object.entries(current.snapshot.state).filter(([k]) => k !== 'bonfires'),
    );
    const v5 = { ...current, version: 5, snapshot: { ...current.snapshot, state: v5State } };
    const migrated = parseSave(JSON.parse(JSON.stringify(v5)));
    expect(migrated.snapshot.state.bonfires).toEqual({});
    const sim = Simulation.restore(migrated.snapshot, content);
    run(sim, 1);
    expect(Object.keys(sim.state.bonfires).length).toBeGreaterThan(0);
  });
});

describe('v6 -> v7', () => {
  it('gives an old save an unexplored map that fills in as the player moves', () => {
    const current = createSave(newSim(10), '1');
    const map = new Set(['explored', 'landmarks', 'lastDeath', 'pin']);
    const v6State = Object.fromEntries(Object.entries(current.snapshot.state).filter(([k]) => !map.has(k)));
    const v6 = { ...current, version: 6, snapshot: { ...current.snapshot, state: v6State } };
    const migrated = parseSave(JSON.parse(JSON.stringify(v6)));
    expect(migrated.snapshot.state).toMatchObject({
      explored: {},
      landmarks: {},
      lastDeath: null,
      pin: null,
    });
    const sim = Simulation.restore(migrated.snapshot, content);
    run(sim, 1);
    expect(Object.keys(sim.state.explored).length).toBeGreaterThan(0);
  });
});
