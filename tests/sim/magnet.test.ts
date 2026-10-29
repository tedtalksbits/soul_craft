import { describe, expect, it } from 'vitest';
import { Body, Inventory, Magnetized, Pickup, Player } from '../../src/sim/components';
import { addItem, countItem } from '../../src/sim/modules/items';
import { dropPickup } from '../../src/sim/modules/pickups';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run } from '../helpers';

/** Drops a pickup `dx` px to the player's right, with no random scatter left to chance. */
function dropAt(sim: Simulation, dx: number, kind: 'souls' | 'item', item: string | null = null) {
  const pb = sim.ecs.need(sim.player, Body);
  dropPickup(sim, kind, 5, pb.x + dx, pb.y, item);
  const found = [...sim.ecs.query(Pickup, Body)].at(-1);
  if (!found) throw new Error('no pickup');
  Object.assign(found[2], { x: pb.x + dx, y: pb.y });
  return found[0];
}

describe('loot magnet', () => {
  const radius = content.player.magnet.radius;

  it('pulls landed loot within the radius to the player and collects it', () => {
    const sim = newSim();
    const souls = sim.ecs.need(sim.player, Player).souls;
    const e = dropAt(sim, radius - 6, 'souls');
    const events = run(sim, 90);
    expect(sim.ecs.has(e, Pickup)).toBe(false);
    expect(ofType(events, 'pickedUp')).toHaveLength(1);
    expect(sim.ecs.need(sim.player, Player).souls).toBe(souls + 5);
  });

  it('leaves loot outside the radius where it fell', () => {
    const sim = newSim();
    const e = dropAt(sim, radius + 10, 'souls');
    const x = sim.ecs.need(e, Body).x;
    run(sim, 90);
    expect(sim.ecs.need(e, Body).x).toBe(x);
    expect(sim.ecs.has(e, Magnetized)).toBe(false);
  });

  it('keeps pulling once caught, even if the player walks away', () => {
    const sim = newSim();
    const e = dropAt(sim, radius - 4, 'item', 'iron_scrap');
    run(sim, 40);
    expect(sim.ecs.has(e, Magnetized)).toBe(true);
    sim.ecs.need(sim.player, Body).x -= radius;
    run(sim, 90);
    expect(countItem(sim.ecs.need(sim.player, Inventory), 'iron_scrap')).toBe(5);
  });

  it('does not pull items the pack has no room for', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'ashwood', 99 * content.player.inventorySlots);
    const e = dropAt(sim, radius - 6, 'item', 'bone_shard');
    const x = sim.ecs.need(e, Body).x;
    run(sim, 90);
    expect(sim.ecs.need(e, Body).x).toBe(x);
  });
});
