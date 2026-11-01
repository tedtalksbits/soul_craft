/** Shared fixtures for headless simulation tests. */
import type { Entity } from '../src/core/ecs';
import type { Dir } from '../src/core/math';
import { Body, Equipment, Facing, Health } from '../src/sim/components';
import type { SimEvent } from '../src/sim/events';
import { inputFrame, NO_INPUT, type ActionName, type InputFrame } from '../src/sim/input';
import { spawnEnemy } from '../src/sim/modules/enemies';
import { syncVitals } from '../src/sim/modules/items';
import { Simulation } from '../src/sim/simulation';
import { loadContent } from '../scripts/lib/load-content';

export const content = loadContent();

export function newSim(seed = 1): Simulation {
  return Simulation.create({ seed, content });
}

/** Takes off the starting armor, for tests that count damage without Armor's cut. */
export function unarmored(sim: Simulation): Simulation {
  Object.assign(sim.ecs.need(sim.player, Equipment), { helmet: null, chest: null, legs: null });
  syncVitals(sim, sim.player);
  const health = sim.ecs.need(sim.player, Health);
  health.hp = health.max;
  return sim;
}

/** Steps `ticks` times with the same input and returns every event emitted. */
export function run(sim: Simulation, ticks: number, input: InputFrame = NO_INPUT): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    sim.step(input);
    events.push(...sim.events.drain());
  }
  return events;
}

/** One tick with the given actions pressed, then `after` idle ticks. */
export function press(
  sim: Simulation,
  actions: ActionName[],
  after = 0,
  move?: readonly [number, number],
): SimEvent[] {
  const events = run(sim, 1, inputFrame({ press: actions, ...(move ? { move } : {}) }));
  return events.concat(run(sim, after));
}

export function face(sim: Simulation, dir: Dir): void {
  sim.ecs.need(sim.player, Facing).dir = dir;
}

/** Spawns an enemy at an offset (in pixels) from the player. */
export function spawnNear(sim: Simulation, archetype: string, dx: number, dy: number): Entity {
  const pb = sim.ecs.need(sim.player, Body);
  return spawnEnemy(sim, archetype, pb.x + dx, pb.y + dy);
}

export const ofType = <T extends SimEvent['type']>(events: SimEvent[], type: T) =>
  events.filter((e): e is Extract<SimEvent, { type: T }> => e.type === type);
