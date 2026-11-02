import { describe, expect, it } from 'vitest';
import { Equipment, Inventory, Player, type ItemStack } from '../../src/sim/components';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { addItem, addStack, countItem } from '../../src/sim/modules/items';
import { maxPower } from '../../src/sim/modules/power';
import { stashCapacity, stashOf, stashReachable } from '../../src/sim/modules/storage';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run } from '../helpers';

const { storage } = content.player;
const piece = (item: string, power = 10): ItemStack => ({
  item,
  count: 1,
  level: 0,
  gear: { tier: 'common', power, seed: 1, perks: [] },
});
const inv = (sim: Simulation) => sim.ecs.need(sim.player, Inventory);
const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));

/** Resting at the village bonfire, where the stash opens before the Storehouse is rebuilt. */
function atVillageFire(sim: Simulation): void {
  sim.ecs.need(sim.player, Player).state = 'sit';
  sim.state.checkpoint = { id: `${content.world.origin.prefab}@origin#0,0`, x: 0, y: 0 };
}

describe('pockets', () => {
  it('hold a set number of spare pieces per slot, the two rings sharing one', () => {
    const sim = newSim();
    for (let i = 0; i < storage.pocket; i++) {
      expect(addStack(sim, sim.player, piece('iron_sword'))).toBe(true);
      expect(addStack(sim, sim.player, piece(i % 2 ? 'ring_of_vigor' : 'ring_of_breath'))).toBe(true);
    }
    expect(inv(sim).stacks).toHaveLength(2 * storage.pocket);
    // A helmet still fits: each slot has its own pocket.
    expect(addStack(sim, sim.player, piece('iron_helm'))).toBe(true);
    expect(stashOf(sim)).toEqual([]);
  });

  it('send a piece to the stash when its pocket is full, from anywhere, and refuse it only when that is full too', () => {
    const sim = newSim();
    for (let i = 0; i < storage.pocket; i++) addStack(sim, sim.player, piece('iron_sword'));
    sim.events.drain();
    expect(addStack(sim, sim.player, piece('bone_cleaver', 50))).toBe(true);
    expect(stashOf(sim).map((s) => s.item)).toEqual(['bone_cleaver']);
    expect(ofType(sim.events.drain(), 'sentToStash')).toEqual([
      { type: 'sentToStash', item: 'bone_cleaver' },
    ]);
    for (let i = 1; i < stashCapacity(sim); i++) stashOf(sim).push(piece('iron_sword'));
    expect(addStack(sim, sim.player, piece('iron_sword'))).toBe(false);
  });

  it('never run out of room for materials', () => {
    const sim = newSim();
    expect(addItem(sim, sim.player, 'stone', 99 * 500)).toBe(0);
    expect(countItem(inv(sim), 'stone')).toBe(99 * 500);
  });
});

describe('the stash', () => {
  it('opens only at the village bonfire before the Storehouse is rebuilt', () => {
    const sim = newSim();
    expect(stashReachable(sim)).toBe(false);
    atVillageFire(sim);
    expect(stashReachable(sim)).toBe(true);
    sim.state.checkpoint = { id: 'wayshrine@3,4#1,1', x: 0, y: 0 };
    expect(stashReachable(sim)).toBe(false);
  });

  it('takes a piece in and gives it back where it opens, and refuses elsewhere', () => {
    const sim = newSim();
    addStack(sim, sim.player, piece('bone_cleaver', 40));
    const refused = act(sim, { type: 'stash', index: 0 });
    expect(ofType(refused, 'craftFailed')[0]?.recipe).toBe('stash');
    expect(inv(sim).stacks).toHaveLength(1);

    atVillageFire(sim);
    act(sim, { type: 'stash', index: 0 });
    expect(inv(sim).stacks).toEqual([]);
    expect(stashOf(sim).map((s) => s.item)).toEqual(['bone_cleaver']);
    act(sim, { type: 'unstash', index: 0 });
    expect(stashOf(sim)).toEqual([]);
    expect(inv(sim).stacks.map((s) => s.item)).toEqual(['bone_cleaver']);
  });

  it('won’t give back a piece whose pocket is full', () => {
    const sim = newSim();
    atVillageFire(sim);
    stashOf(sim).push(piece('bone_cleaver'));
    for (let i = 0; i < storage.pocket; i++) addStack(sim, sim.player, piece('iron_sword'));
    const events = act(sim, { type: 'unstash', index: 0 });
    expect(ofType(events, 'craftFailed')[0]?.reason).toBe('that pocket is full');
    expect(stashOf(sim)).toHaveLength(1);
  });

  it('counts toward Max Power, so storing your best piece never lowers your drops', () => {
    const sim = newSim();
    const before = maxPower(sim);
    stashOf(sim).push(piece('bone_cleaver', 400));
    expect(maxPower(sim)).toBeGreaterThan(before);
    expect(sim.ecs.need(sim.player, Equipment).weapon?.item).toBe('chipped_sword');
  });
});
