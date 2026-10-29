import { describe, expect, it } from 'vitest';
import { Ai, Body, Facing, Motion } from '../../src/sim/components';
import { newSim, run, spawnNear } from '../helpers';

describe('chasing enemies', () => {
  it.each(['hollow', 'knight'])(
    'a %s stops at the player instead of jittering on top of them',
    (archetype) => {
      const sim = newSim();
      sim.state.cheats.god = true;
      const e = spawnNear(sim, archetype, 40, 0);
      // Keep it chasing: no lunge or charge while we watch.
      const ai = sim.ecs.need(e, Ai);
      const pb = sim.ecs.need(sim.player, Body);
      const directions: number[] = [];
      for (let i = 0; i < 120; i++) {
        ai.cooldown = 999;
        run(sim, 1);
        const vx = sim.ecs.need(e, Motion).vx;
        if (vx !== 0) directions.push(Math.sign(vx));
      }
      const flips = directions.filter((d, i) => i > 0 && d !== directions[i - 1]).length;
      expect(flips).toBe(0);
      const eb = sim.ecs.need(e, Body);
      expect(Math.abs(eb.x - pb.x)).toBeGreaterThan(5);
    },
  );
});

describe('archer', () => {
  it('recovers in a `loose` state after each shot before moving again', () => {
    const sim = newSim();
    sim.state.cheats.god = true;
    const e = spawnNear(sim, 'archer', 90, 0);
    const ai = sim.ecs.need(e, Ai);
    ai.cooldown = 0;
    const states: string[] = [];
    for (let i = 0; i < 80; i++) {
      run(sim, 1);
      if (states[states.length - 1] !== ai.state) states.push(ai.state);
    }
    expect(states).toEqual(expect.arrayContaining(['draw', 'loose', 'chase']));
    expect(states.indexOf('loose')).toBe(states.indexOf('draw') + 1);
  });

  it('keeps facing the player while backing away', () => {
    const sim = newSim();
    sim.state.cheats.god = true;
    const e = spawnNear(sim, 'archer', 30, 0);
    sim.ecs.need(e, Ai).cooldown = 999;
    run(sim, 10);
    expect(sim.ecs.need(e, Motion).vx).toBeGreaterThan(0);
    expect(sim.ecs.need(e, Facing).dir).toBe('left');
  });
});
