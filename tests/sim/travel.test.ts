import { describe, expect, it } from 'vitest';
import { Body, Bonfire, Health, Player } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { inputFrame } from '../../src/sim/input';
import { restAt } from '../../src/sim/modules/interaction';
import { Simulation, type SimSnapshot } from '../../src/sim/simulation';
import { content, newSim, ofType, run } from '../helpers';

/** The nearest region with a wayshrine (a lone bonfire), as a tile position next to its bonfire. */
function findWayshrine(sim: Simulation): { x: number; y: number } {
  for (let r = 1; r < 12; r++) {
    for (let ry = -r; ry <= r; ry++) {
      for (let rx = -r; rx <= r; rx++) {
        const p = sim.world.gen.placementFor(rx, ry);
        if (p?.prefabId !== 'wayshrine') continue;
        return { x: (p.x0 + Math.floor(p.w / 2)) * TILE + TILE / 2, y: (p.y0 + Math.floor(p.h / 2)) * TILE };
      }
    }
  }
  throw new Error('no wayshrine near the origin for this seed');
}

/** Walks (teleports) to the wayshrine and rests there, lighting it. Returns its id. */
function lightWayshrine(sim: Simulation): string {
  const at = findWayshrine(sim);
  Object.assign(sim.ecs.need(sim.player, Body), at);
  run(sim, 2);
  const nearest = [...sim.ecs.query(Bonfire, Body)].sort(
    ([, , a], [, , b]) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y),
  )[0];
  if (!nearest) throw new Error('wayshrine bonfire did not load');
  restAt(sim, nearest[0]);
  run(sim, 1);
  return nearest[1].id;
}

const villageId = (sim: Simulation) => {
  const id = Object.keys(sim.state.bonfires).find((k) => k.includes('@origin#'));
  if (!id) throw new Error('village bonfire not registered');
  return id;
};

describe('bonfire travel', () => {
  it('starts every game with the village bonfire lit and on the travel list', () => {
    const sim = newSim();
    const id = villageId(sim);
    expect(sim.state.litBonfires[id]).toBe(true);
    expect(sim.state.bonfires[id]?.name).toBe('Ashen Village');
  });

  it('records a bonfire once it is lit, with its position, for when it is far away', () => {
    const sim = newSim();
    const id = lightWayshrine(sim);
    expect(sim.state.bonfires[id]).toMatchObject({ name: 'Wayshrine' });
  });

  it('warps a resting player home and rests them there', () => {
    const sim = newSim();
    const shrine = lightWayshrine(sim);
    sim.ecs.need(sim.player, Health).hp = 10;
    const home = villageId(sim);
    const events = run(sim, 1, inputFrame({ actions: [{ type: 'travel', bonfire: home }] }));
    expect(ofType(events, 'traveled')).toEqual([{ type: 'traveled', id: home, name: 'Ashen Village' }]);
    expect(sim.state.checkpoint?.id).toBe(home);
    expect(sim.ecs.need(sim.player, Player).state).toBe('sit');
    expect(sim.ecs.need(sim.player, Health).hp).toBe(sim.ecs.need(sim.player, Health).max);
    const target = sim.state.bonfires[home];
    const pb = sim.ecs.need(sim.player, Body);
    expect(Math.hypot(pb.x - (target?.x ?? 0), pb.y - (target?.y ?? 0))).toBeLessThan(40);
    expect(shrine).not.toBe(home);
  });

  it('only travels while resting, and only to lit bonfires', () => {
    const sim = newSim();
    const shrine = lightWayshrine(sim);
    sim.ecs.need(sim.player, Player).state = 'free';
    const walking = run(sim, 1, inputFrame({ actions: [{ type: 'travel', bonfire: villageId(sim) }] }));
    expect(ofType(walking, 'traveled')).toEqual([]);
    sim.ecs.need(sim.player, Player).state = 'sit';
    const unknown = run(sim, 1, inputFrame({ actions: [{ type: 'travel', bonfire: 'nowhere#0,0' }] }));
    expect(ofType(unknown, 'traveled')).toEqual([]);
    expect(sim.state.checkpoint?.id).toBe(shrine);
  });

  it('survives a save and restore: the far bonfire is still on the list', () => {
    const sim = newSim();
    const shrine = lightWayshrine(sim);
    const restored = Simulation.restore(JSON.parse(JSON.stringify(sim.snapshot())) as SimSnapshot, content);
    expect(restored.state.bonfires[shrine]).toEqual(sim.state.bonfires[shrine]);
  });
});
