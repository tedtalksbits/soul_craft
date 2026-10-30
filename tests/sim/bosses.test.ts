import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import { Ai, Body, Boss, Brazier, Health, Minion, Pickup, Player, Staggered } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { bossEntity } from '../../src/sim/modules/bosses';
import { applyDamage } from '../../src/sim/modules/combat';
import { resetEnemies } from '../../src/sim/modules/streaming';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run } from '../helpers';

const WARDEN = 'ashen_warden';
const brain = (() => {
  const b = content.enemy(WARDEN).brain;
  if (b.type !== 'warden') throw new Error('the Warden needs the warden brain');
  return b;
})();

function keep(sim: Simulation) {
  const p = sim.world.gen.fixedPlacements().find((f) => f.prefabId === 'warden_arena');
  if (!p) throw new Error('no Warden keep');
  return p;
}

/** Puts the player inside the keep, between the gate and the Warden, and lets the fight start. */
function enterKeep(sim: Simulation): { warden: Entity; events: ReturnType<typeof run> } {
  sim.state.cheats.god = true;
  const p = keep(sim);
  Object.assign(sim.ecs.need(sim.player, Body), { x: (p.x0 + 12.5) * TILE, y: (p.y0 + 17.5) * TILE });
  const events = run(sim, 2);
  const warden = bossEntity(sim, WARDEN);
  if (warden === undefined) throw new Error('the Warden did not spawn');
  return { warden, events };
}

function hit(sim: Simulation, target: Entity, amount: number) {
  const b = sim.ecs.need(target, Body);
  return applyDamage(sim, target, { amount, crit: false, fromX: b.x, fromY: b.y + 10, knockback: 0 });
}

/** Steps on every brazier in turn and returns the events. */
function lightBraziers(sim: Simulation) {
  const pb = sim.ecs.need(sim.player, Body);
  const events = [];
  for (const [, , b] of [...sim.ecs.query(Brazier, Body)]) {
    Object.assign(pb, { x: b.x, y: b.y });
    events.push(...run(sim, 1));
  }
  return events;
}

describe('the Ashen Warden', () => {
  it('waits in a keep north of the village in every world', () => {
    for (const seed of [1, 2, 3]) {
      const p = keep(newSim(seed));
      expect(p.prefab.marker).toBe('arena');
      expect(p.y0 + p.h).toBeLessThan(-content.world.origin.safeRadius);
    }
  });

  it('starts the fight when the player walks in, and holds them inside', () => {
    const sim = newSim();
    const { events } = enterKeep(sim);
    expect(ofType(events, 'bossFightStarted')).toEqual([{ type: 'bossFightStarted', boss: WARDEN }]);
    const fight = sim.state.bossFight;
    expect(fight).not.toBeNull();
    const pb = sim.ecs.need(sim.player, Body);
    pb.y = fight!.y + fight!.half + 3 * TILE;
    run(sim, 1);
    expect(pb.y).toBeLessThanOrEqual(fight!.y + fight!.half);
  });

  it('raises a shield at two thirds health that only the braziers break', () => {
    const sim = newSim();
    const { warden } = enterKeep(sim);
    const health = sim.ecs.need(warden, Health);
    const events = [hit(sim, warden, health.max)];
    // The blow stops at the threshold instead of killing.
    expect(health.hp).toBe(Math.ceil(health.max * brain.shieldAt[0]!));
    expect(sim.ecs.need(warden, Boss)).toMatchObject({ phase: 1, shielded: true });
    events.push(hit(sim, warden, 50));
    expect(events).toEqual(['hit', 'blocked']);
    expect(health.hp).toBe(Math.ceil(health.max * brain.shieldAt[0]!));

    const lit = lightBraziers(sim);
    expect(ofType(lit, 'brazierLit').map((e) => e.left)).toEqual([2, 1, 0]);
    expect(ofType(lit, 'bossShieldBroken')).toHaveLength(1);
    expect(sim.ecs.need(warden, Boss).shielded).toBe(false);
    expect(sim.ecs.has(warden, Staggered)).toBe(true);
    expect(hit(sim, warden, 10)).toBe('hit');
  });

  it('calls adds while shielded, no more than its limit', () => {
    const sim = newSim();
    const { warden } = enterKeep(sim);
    hit(sim, warden, sim.ecs.need(warden, Health).max);
    run(sim, brain.adds.every * (brain.adds.max + 2));
    const adds = [...sim.ecs.query(Minion)].length;
    expect(adds).toBeGreaterThan(0);
    expect(adds).toBeLessThanOrEqual(brain.adds.max);
  });

  it('slams the ground around itself after raising its weapon', () => {
    const sim = newSim();
    const { warden } = enterKeep(sim);
    sim.state.cheats.god = false;
    const wb = sim.ecs.need(warden, Body);
    Object.assign(sim.ecs.need(sim.player, Body), { x: wb.x, y: wb.y + 20 });
    Object.assign(sim.ecs.need(warden, Ai), { state: 'raise', t: brain.slamWindupTicks - 1 });
    const hp = sim.ecs.need(sim.player, Health).hp;
    const events = run(sim, 1);
    expect(ofType(events, 'bossSlam')).toHaveLength(1);
    expect(sim.ecs.need(sim.player, Health).hp).toBeLessThan(hp);
  });

  it('falls for good, drops the Kindling and the Sovereign Ember, and its adds go with it', () => {
    const sim = newSim();
    const { warden } = enterKeep(sim);
    const health = sim.ecs.need(warden, Health);
    hit(sim, warden, health.max);
    run(sim, brain.adds.every + 1);
    lightBraziers(sim);
    hit(sim, warden, health.max);
    lightBraziers(sim);
    const events = [hit(sim, warden, health.max)];
    expect(events).toEqual(['hit']);
    expect(sim.state.bossesDefeated).toEqual({ [WARDEN]: true });
    expect(sim.state.bossFight).toBeNull();
    const items = [...sim.ecs.query(Pickup)].map(([, p]) => p.item);
    expect(items).toContain('kindling_warden');
    expect(items).toContain('relic_sovereign');
    run(sim, 60);
    expect([...sim.ecs.query(Minion)]).toHaveLength(0);
    // Resting brings every enemy back, but not a felled boss.
    resetEnemies(sim);
    expect(bossEntity(sim, WARDEN)).toBeUndefined();
  });

  it('ends the fight when the player dies, and returns whole after respawn', () => {
    const sim = newSim();
    const { warden } = enterKeep(sim);
    hit(sim, warden, 100);
    sim.state.cheats.god = false;
    hit(sim, sim.player, 10_000);
    const events = run(sim, 1);
    expect(ofType(events, 'bossFightEnded')).toHaveLength(1);
    expect(sim.state.bossFight).toBeNull();
    // Respawn resets every loaded enemy.
    run(sim, 600);
    expect(sim.ecs.need(sim.player, Player).state).not.toBe('dead');
    const p = keep(sim);
    Object.assign(sim.ecs.need(sim.player, Body), { x: (p.x0 + 12.5) * TILE, y: (p.y0 + 17.5) * TILE });
    run(sim, 2);
    const again = bossEntity(sim, WARDEN);
    expect(again).toBeDefined();
    const h = sim.ecs.need(again!, Health);
    expect(h.hp).toBe(h.max);
  });
});
