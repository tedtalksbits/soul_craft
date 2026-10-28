import { Body, Health, Pickup, Player, Sprite, type PickupKind } from '../components';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';

/** Ticks before a fresh drop can be collected, so it visibly pops out first. */
const COLLECT_DELAY = 20;
const LIFETIME = 600;
const COLLECT_RADIUS = 10;

export function dropPickup(sim: Simulation, kind: PickupKind, amount: number, x: number, y: number): void {
  const e = sim.ecs.create();
  const angle = sim.rng.range(0, Math.PI * 2);
  const scatter = sim.rng.range(2, 8);
  sim.ecs.add(e, Body, { x: x + Math.cos(angle) * scatter, y: y + Math.sin(angle) * scatter, w: 6, h: 6 });
  sim.ecs.add(e, Pickup, { kind, amount, age: 0, z: 6, vz: 1.2 });
  sim.ecs.add(e, Sprite, { sheet: 'props' });
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

    if (
      pickup.age > COLLECT_DELAY &&
      player.state !== 'dead' &&
      Math.hypot(body.x - pb.x, body.y - pb.y) < COLLECT_RADIUS
    ) {
      if (pickup.kind === 'souls') player.souls += pickup.amount;
      else health.hp = Math.min(health.max, health.hp + pickup.amount);
      sim.events.emit({ type: 'pickedUp', kind: pickup.kind, amount: pickup.amount });
      ecs.destroy(e);
    } else if (pickup.age > LIFETIME) ecs.destroy(e);
  }
}

export const pickupsModule: SimModule = {
  id: 'pickups',
  systems: [{ phase: 'combat', run: updatePickups }],
};
