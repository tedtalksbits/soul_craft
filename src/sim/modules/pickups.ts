import { Body, Health, Pickup, Player, Sprite, type PickupKind } from '../components';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import { addItem } from './items';

/** Ticks before a fresh drop can be collected, so it visibly pops out first. */
const COLLECT_DELAY = 20;
const COLLECT_RADIUS = 10;
/** Souls and embers fade quickly; materials wait a minute so a full pack can be sorted out. */
const LIFETIME: Readonly<Record<PickupKind, number>> = { souls: 600, ember: 600, item: 3600 };
/** When the pack is full, try again (and tell the player again) after this many ticks. */
const FULL_RETRY = 60;

export function dropPickup(
  sim: Simulation,
  kind: PickupKind,
  amount: number,
  x: number,
  y: number,
  item: string | null = null,
): void {
  const e = sim.ecs.create();
  const angle = sim.rng.range(0, Math.PI * 2);
  const scatter = sim.rng.range(2, 8);
  sim.ecs.add(e, Body, { x: x + Math.cos(angle) * scatter, y: y + Math.sin(angle) * scatter, w: 6, h: 6 });
  sim.ecs.add(e, Pickup, { kind, amount, item, age: 0, z: 6, vz: 1.2 });
  sim.ecs.add(e, Sprite, { sheet: kind === 'item' ? 'items' : 'props' });
}

function updatePickups(sim: Simulation): void {
  const { ecs } = sim;
  const p = sim.player;
  const player = ecs.need(p, Player);
  const pb = ecs.need(p, Body);
  const health = ecs.need(p, Health);
  for (const [e, pickup, body] of ecs.query(Pickup, Body)) {
    pickup.age++;
    pickup.vz -= 0.1;
    pickup.z = Math.max(0, pickup.z + pickup.vz);
    if (pickup.z === 0) pickup.vz = 0;

    const reachable =
      pickup.age > COLLECT_DELAY &&
      player.state !== 'dead' &&
      Math.hypot(body.x - pb.x, body.y - pb.y) < COLLECT_RADIUS;
    if (reachable) {
      if (pickup.kind === 'item' && pickup.item !== null) {
        const left = addItem(sim, p, pickup.item, pickup.amount);
        const taken = pickup.amount - left;
        if (taken > 0) sim.events.emit({ type: 'itemGained', item: pickup.item, count: taken });
        if (left > 0) {
          pickup.amount = left;
          pickup.age = COLLECT_DELAY - FULL_RETRY;
          sim.events.emit({ type: 'inventoryFull', item: pickup.item });
          continue;
        }
      } else if (pickup.kind === 'souls') player.souls += pickup.amount;
      else health.hp = Math.min(health.max, health.hp + pickup.amount);
      if (pickup.kind !== 'item')
        sim.events.emit({ type: 'pickedUp', kind: pickup.kind, amount: pickup.amount });
      ecs.destroy(e);
    } else if (pickup.age > LIFETIME[pickup.kind]) ecs.destroy(e);
  }
}

export const pickupsModule: SimModule = {
  id: 'pickups',
  systems: [{ phase: 'combat', run: updatePickups }],
};
