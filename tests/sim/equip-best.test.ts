import { describe, expect, it } from 'vitest';
import { Equipment, Inventory, Player, type ItemStack } from '../../src/sim/components';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { addStack, compareStack } from '../../src/sim/modules/items';
import { playerPower } from '../../src/sim/modules/power';
import { stashOf } from '../../src/sim/modules/storage';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run } from '../helpers';

const piece = (item: string, power: number): ItemStack => ({
  item,
  count: 1,
  level: 0,
  gear: { tier: 'common', power, seed: power, perks: [] },
});
const eq = (sim: Simulation) => sim.ecs.need(sim.player, Equipment);
const inv = (sim: Simulation) => sim.ecs.need(sim.player, Inventory);
const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));

function atVillageFire(sim: Simulation): void {
  sim.ecs.need(sim.player, Player).state = 'sit';
  sim.state.checkpoint = { id: `${content.world.origin.prefab}@origin#0,0`, x: 0, y: 0 };
}

describe('equipping from the character screen', () => {
  it('puts a ring into the ring slot it was chosen for', () => {
    const sim = newSim();
    eq(sim).ring0 = piece('ring_of_vigor', 20);
    eq(sim).ring1 = piece('ring_of_breath', 30);
    addStack(sim, sim.player, piece('ring_of_vigor', 90));
    act(sim, { type: 'equip', index: 0, slot: 'ring1' });
    expect(eq(sim).ring1?.gear?.power).toBe(90);
    expect(eq(sim).ring0?.gear?.power).toBe(20);
    expect(inv(sim).stacks.map((s) => s.gear?.power)).toEqual([30]);
  });

  it('equips straight from the stash where it opens, the worn piece taking its place there', () => {
    const sim = newSim();
    stashOf(sim).push(piece('bone_cleaver', 120));
    const refused = act(sim, { type: 'equipStash', index: 0 });
    expect(ofType(refused, 'craftFailed')[0]?.recipe).toBe('equip');
    expect(eq(sim).weapon?.item).toBe('chipped_sword');

    atVillageFire(sim);
    act(sim, { type: 'equipStash', index: 0 });
    expect(eq(sim).weapon?.item).toBe('bone_cleaver');
    expect(stashOf(sim).map((s) => s.item)).toEqual(['chipped_sword']);
  });

  it('compares any piece in the slot it would go to', () => {
    const sim = newSim();
    eq(sim).ring0 = piece('ring_of_vigor', 20);
    eq(sim).ring1 = piece('ring_of_breath', 30);
    const c = compareStack(sim, piece('ring_of_vigor', 90), 'ring1')!;
    expect(c.slot).toBe('ring1');
    expect(c.replaces?.gear?.power).toBe(30);
    expect(c.after.power).toBeGreaterThan(c.now.power);
  });
});

describe('Equip best', () => {
  it('wears the highest-Power piece for every slot it can reach, and the two best rings', () => {
    const sim = newSim();
    eq(sim).ring0 = piece('ring_of_vigor', 50);
    addStack(sim, sim.player, piece('iron_sword', 40));
    addStack(sim, sim.player, piece('bone_cleaver', 70));
    addStack(sim, sim.player, piece('iron_helm', 5));
    addStack(sim, sim.player, piece('ring_of_breath', 60));
    addStack(sim, sim.player, piece('ring_of_vigor', 30));
    // Better, but in the stash, which doesn't open out here.
    stashOf(sim).push(piece('iron_mail', 200));
    act(sim, { type: 'equipBest' });
    expect(eq(sim).weapon?.item).toBe('bone_cleaver');
    // The worn hood (10) beats the helm (5), so it stays.
    expect(eq(sim).helmet?.item).toBe(content.player.start.gear[1]);
    expect([eq(sim).ring0?.gear?.power, eq(sim).ring1?.gear?.power]).toEqual([50, 60]);
    expect(eq(sim).chest?.gear?.power).toBe(content.loot.power.start);

    atVillageFire(sim);
    act(sim, { type: 'equipBest' });
    expect(eq(sim).chest?.item).toBe('iron_mail');
    expect(playerPower(sim)).toBe(Math.floor((70 + 10 + 200 + 10 + 50 + 60) / 6));
  });

  it('changes nothing when what is worn is already the best', () => {
    const sim = newSim();
    addStack(sim, sim.player, piece('iron_sword', 1));
    const events = act(sim, { type: 'equipBest' });
    expect(ofType(events, 'equipped')).toEqual([]);
  });
});
