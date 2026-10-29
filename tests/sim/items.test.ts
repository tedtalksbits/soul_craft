import { describe, expect, it } from 'vitest';
import { Body, Equipment, Health, Inventory, Pickup, Player, Station } from '../../src/sim/components';
import { TICK_RATE } from '../../src/sim/constants';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { applyDamage } from '../../src/sim/modules/combat';
import { canCraft, stationNearby } from '../../src/sim/modules/crafting';
import { addItem, countItem, playerStats } from '../../src/sim/modules/items';
import { dropPickup } from '../../src/sim/modules/pickups';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, press, run } from '../helpers';

const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const inv = (sim: Simulation) => sim.ecs.need(sim.player, Inventory);
const eq = (sim: Simulation) => sim.ecs.need(sim.player, Equipment);
const indexOf = (sim: Simulation, item: string) => inv(sim).stacks.findIndex((s) => s.item === item);

/** Stands the player next to the village station of the given kind. */
function goTo(sim: Simulation, station: 'forge' | 'alchemy'): void {
  const found = [...sim.ecs.query(Station, Body)].find(([, s]) => s.station === station);
  if (!found) throw new Error(`no ${station} loaded`);
  const pb = sim.ecs.need(sim.player, Body);
  pb.x = found[2].x;
  pb.y = found[2].y + 14;
}

describe('inventory', () => {
  it('starts with the Chipped Sword equipped and an empty pack', () => {
    const sim = newSim();
    expect(eq(sim).weapon).toEqual({ item: 'chipped_sword', count: 1, level: 0 });
    expect(inv(sim).stacks).toEqual([]);
    expect(playerStats(sim, sim.player).damage).toBe(12);
  });

  it('fills stacks up to their limit, then new slots, and reports what did not fit', () => {
    const sim = newSim();
    expect(addItem(sim, sim.player, 'field_bandage', 25)).toBe(0);
    expect(inv(sim).stacks.map((s) => s.count)).toEqual([10, 10, 5]);
    const slots = content.player.inventorySlots;
    expect(addItem(sim, sim.player, 'ashwood', 99 * slots)).toBe(99 * 3);
    expect(inv(sim).stacks).toHaveLength(slots);
  });

  it('collects item pickups, and leaves them on the ground when the pack is full', () => {
    const sim = newSim();
    const pb = sim.ecs.need(sim.player, Body);
    dropPickup(sim, 'item', 3, pb.x, pb.y, 'iron_scrap');
    const events = run(sim, 40);
    expect(ofType(events, 'itemGained')).toEqual([{ type: 'itemGained', item: 'iron_scrap', count: 3 }]);
    expect(countItem(inv(sim), 'iron_scrap')).toBe(3);

    addItem(sim, sim.player, 'ashwood', 99 * content.player.inventorySlots);
    dropPickup(sim, 'item', 1, pb.x, pb.y, 'bone_shard');
    const full = run(sim, 40);
    expect(ofType(full, 'inventoryFull').length).toBeGreaterThan(0);
    expect([...sim.ecs.query(Pickup)].some(([, p]) => p.item === 'bone_shard')).toBe(true);
  });
});

describe('equipment', () => {
  it('equips through the input channel and swaps the old item back into the pack', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'iron_sword', 1);
    const events = act(sim, { type: 'equip', index: indexOf(sim, 'iron_sword') });
    expect(ofType(events, 'equipped')).toEqual([{ type: 'equipped', item: 'iron_sword', slot: 'weapon' }]);
    expect(eq(sim).weapon?.item).toBe('iron_sword');
    expect(countItem(inv(sim), 'chipped_sword')).toBe(1);
    expect(playerStats(sim, sim.player).damage).toBe(16);
  });

  it('armor absorbs a fraction of incoming damage', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'iron_mail', 1);
    act(sim, { type: 'equip', index: indexOf(sim, 'iron_mail') });
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, sim.player, { amount: 50, crit: false, fromX: pb.x, fromY: pb.y - 1, knockback: 0 });
    expect(sim.ecs.need(sim.player, Health).hp).toBe(100 - Math.round(50 * 0.78));
  });

  it('a ring of vigor raises max health, and removing it brings health back within the cap', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'ring_of_vigor', 1);
    act(sim, { type: 'equip', index: indexOf(sim, 'ring_of_vigor') });
    const health = sim.ecs.need(sim.player, Health);
    expect(health.max).toBe(120);
    health.hp = 120;
    act(sim, { type: 'unequip', slot: 'ring0' });
    expect(health).toMatchObject({ max: 100, hp: 100 });
  });
});

describe('consumables', () => {
  it('the quick slot drinks a buff potion that wears off', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'ember_tonic', 2);
    act(sim, { type: 'setQuick', item: 'ember_tonic' });
    const events = press(sim, ['item'], content.player.flask.duration);
    expect(ofType(events, 'buffStarted')).toHaveLength(1);
    expect(countItem(inv(sim), 'ember_tonic')).toBe(1);
    expect(playerStats(sim, sim.player).damage).toBeCloseTo(12 * 1.2);
    const later = run(sim, 60 * TICK_RATE);
    expect(ofType(later, 'buffEnded')).toEqual([{ type: 'buffEnded', stat: 'damage' }]);
    expect(playerStats(sim, sim.player).damage).toBe(12);
  });

  it('a bandage heals without touching the flask', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'field_bandage', 1);
    sim.ecs.need(sim.player, Health).hp = 40;
    const flasks = sim.ecs.need(sim.player, Player).flasks;
    act(sim, { type: 'use', item: 'field_bandage' });
    run(sim, content.player.flask.duration);
    expect(sim.ecs.need(sim.player, Health).hp).toBe(65);
    expect(sim.ecs.need(sim.player, Player).flasks).toBe(flasks);
  });
});

describe('crafting', () => {
  it('crafts anywhere-recipes on the spot, spending materials and souls', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'fungal_cap', 2);
    addItem(sim, sim.player, 'slime_gel', 1);
    sim.ecs.need(sim.player, Player).souls = 10;
    const events = act(sim, { type: 'craft', recipe: 'field_bandage' });
    expect(ofType(events, 'crafted')).toHaveLength(1);
    expect(countItem(inv(sim), 'field_bandage')).toBe(1);
    expect(countItem(inv(sim), 'fungal_cap')).toBe(0);
    expect(sim.ecs.need(sim.player, Player).souls).toBe(5);
  });

  it('needs the forge for forge recipes', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'iron_scrap', 6);
    addItem(sim, sim.player, 'ashwood', 2);
    sim.ecs.need(sim.player, Player).souls = 500;
    sim.ecs.need(sim.player, Body).x += 400;
    run(sim, 2);
    const away = act(sim, { type: 'craft', recipe: 'iron_sword' });
    expect(ofType(away, 'craftFailed')[0]?.reason).toBe('needs a forge');

    goTo(sim, 'forge');
    expect(stationNearby(sim, 'forge')).toBe(true);
    expect(canCraft(sim, 'iron_sword')).toEqual({ ok: true });
    act(sim, { type: 'craft', recipe: 'iron_sword' });
    expect(countItem(inv(sim), 'iron_sword')).toBe(1);
    expect(sim.ecs.need(sim.player, Player).souls).toBe(350);
  });

  it('reports what is missing without spending anything', () => {
    const sim = newSim();
    goTo(sim, 'alchemy');
    sim.ecs.need(sim.player, Player).souls = 100;
    expect(canCraft(sim, 'ember_tonic')).toEqual({ ok: false, reason: 'needs 2 Glowspore' });
    expect(sim.ecs.need(sim.player, Player).souls).toBe(100);
  });

  it('upgrades the equipped weapon at the forge', () => {
    const sim = newSim();
    goTo(sim, 'forge');
    addItem(sim, sim.player, 'iron_scrap', 2);
    sim.ecs.need(sim.player, Player).souls = 40;
    const events = act(sim, { type: 'upgrade' });
    expect(ofType(events, 'upgraded')).toEqual([{ type: 'upgraded', item: 'chipped_sword', level: 1 }]);
    expect(playerStats(sim, sim.player).damage).toBe(14);
    expect(countItem(inv(sim), 'iron_scrap')).toBe(0);
  });
});
