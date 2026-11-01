import { describe, expect, it } from 'vitest';
import { Body, Bonfire, Enemy, Equipment, Health, Player, Spawned } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { addItem } from '../../src/sim/modules/items';
import { interact, restAt } from '../../src/sim/modules/interaction';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run, spawnNear } from '../helpers';

const player = (sim: Simulation) => sim.ecs.need(sim.player, Player);
const where = (sim: Simulation, e: number) => {
  const b = sim.ecs.need(e, Body);
  return { x: b.x, y: b.y };
};

/** The bonfire nearest the player, with the player stood right beside it. */
function atBonfire(sim: Simulation): number {
  const pb = sim.ecs.need(sim.player, Body);
  const nearest = [...sim.ecs.query(Bonfire, Body)].sort(
    ([, , a], [, , c]) => Math.hypot(a.x - pb.x, a.y - pb.y) - Math.hypot(c.x - pb.x, c.y - pb.y),
  )[0];
  if (!nearest) throw new Error('no bonfire loaded');
  const [e, , b] = nearest;
  Object.assign(pb, { x: b.x, y: b.y + 10 });
  return e;
}

/** The nearest wayshrine (a lone bonfire out in the wild), with the player beside its bonfire. */
function atWayshrine(sim: Simulation): number {
  for (let r = 1; r < 12; r++)
    for (let ry = -r; ry <= r; ry++)
      for (let rx = -r; rx <= r; rx++) {
        const p = sim.world.gen.placementFor(rx, ry);
        if (p?.prefabId !== 'wayshrine') continue;
        const pb = sim.ecs.need(sim.player, Body);
        Object.assign(pb, { x: (p.x0 + p.w / 2) * TILE, y: (p.y0 + p.h / 2) * TILE });
        run(sim, 2);
        return atBonfire(sim);
      }
  throw new Error('no wayshrine near the origin for this seed');
}

/** Wild (biome-scattered) enemies standing in the world. */
function wildEnemies(sim: Simulation): { x: number; y: number }[] {
  const wild = new Set([...sim.world.loaded].flatMap((c) => c.spawns.filter((s) => s.wild).map((s) => s.id)));
  return [...sim.ecs.query(Enemy, Spawned, Body)]
    .filter(([, , s]) => wild.has(s.spawnId))
    .map(([, , , b]) => b);
}

describe('resting holds the world still', () => {
  it('nothing moves or lands a blow on a seated player', () => {
    const sim = newSim();
    const enemy = spawnNear(sim, 'hollow', 30, 0);
    player(sim).state = 'sit';
    const before = where(sim, enemy);
    const hp = sim.ecs.need(sim.player, Health).hp;
    const events = run(sim, 120);
    expect(where(sim, enemy)).toEqual(before);
    expect(sim.ecs.need(sim.player, Health).hp).toBe(hp);
    expect(ofType(events, 'damaged')).toHaveLength(0);
  });

  it('the player can still stand up and walk away', () => {
    const sim = newSim();
    player(sim).state = 'sit';
    run(sim, 1, inputFrame({ press: ['use'] }));
    expect(player(sim).state).toBe('free');
  });
});

describe('an open menu holds the world still', () => {
  it('freezes enemies and the player mid-roll', () => {
    const sim = newSim();
    const enemy = spawnNear(sim, 'hollow', 60, 0);
    run(sim, 1, inputFrame({ press: ['roll'], move: [1, 0] }));
    const p = player(sim);
    const [state, t] = [p.state, p.t];
    const before = where(sim, enemy);
    const pb = where(sim, sim.player);
    run(sim, 60, inputFrame({ menu: true }));
    expect([p.state, p.t]).toEqual([state, t]);
    expect(where(sim, enemy)).toEqual(before);
    expect(where(sim, sim.player)).toEqual(pb);
  });

  it("still applies the menu's actions", () => {
    const sim = newSim();
    addItem(sim, sim.player, 'iron_sword', 1); // the pack starts empty, so it is stack 0
    const events = run(sim, 1, inputFrame({ menu: true, actions: [{ type: 'equip', index: 0 }] }));
    expect(ofType(events, 'equipped')).toHaveLength(1);
  });
});

describe('no resting or changing gear with an enemy after you', () => {
  it('refuses to rest, but still lights the bonfire', () => {
    const sim = newSim();
    const bonfire = atBonfire(sim);
    sim.state.litBonfires = {};
    spawnNear(sim, 'hollow', 30, 0);
    sim.events.drain();
    interact(sim);
    const events = sim.events.drain();
    expect(ofType(events, 'restRefused')).toHaveLength(1);
    expect(player(sim).state).not.toBe('sit');
    expect(sim.state.litBonfires[sim.ecs.need(bonfire, Bonfire).id]).toBe(true);
  });

  it('rests once nothing is after you', () => {
    const sim = newSim();
    atBonfire(sim);
    interact(sim);
    expect(player(sim).state).toBe('sit');
  });

  it('locks gear while an enemy is after you', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'iron_sword', 1);
    spawnNear(sim, 'hollow', 30, 0);
    const equip: PlayerAction = { type: 'equip', index: 0 };
    const events = run(sim, 1, inputFrame({ menu: true, actions: [equip] }));
    expect(ofType(events, 'gearLocked')).toHaveLength(1);
    expect(sim.ecs.need(sim.player, Equipment).weapon?.item).toBe('chipped_sword');
  });
});

describe('respawns after a rest', () => {
  it('no wild enemy rises near the bonfire', () => {
    const sim = newSim(3);
    const bonfire = atWayshrine(sim);
    for (let i = 0; i < 5; i++) {
      restAt(sim, bonfire);
      const at = sim.ecs.need(bonfire, Body);
      expect(wildEnemies(sim).length).toBeGreaterThan(0);
      for (const b of wildEnemies(sim))
        expect(Math.hypot(b.x - at.x, b.y - at.y)).toBeGreaterThanOrEqual(content.world.restClearance * TILE);
    }
  });

  it('each rest puts wild enemies somewhere new', () => {
    const sim = newSim(3);
    const bonfire = atWayshrine(sim);
    restAt(sim, bonfire);
    const first = JSON.stringify(wildEnemies(sim));
    restAt(sim, bonfire);
    expect(JSON.stringify(wildEnemies(sim))).not.toBe(first);
  });

  it('a chunk that reloads between rests puts its enemies back where they were', () => {
    const sim = newSim(3);
    restAt(sim, atWayshrine(sim));
    const chunk = [...sim.world.loaded].find((c) => c.spawns.some((s) => s.wild));
    if (!chunk) throw new Error('no wild spawns loaded');
    const before = JSON.stringify(chunk.spawns);
    sim.world.unload(chunk.key);
    expect(JSON.stringify(sim.world.load(chunk.cx, chunk.cy).spawns)).toBe(before);
  });
});
