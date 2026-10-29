import { describe, expect, it } from 'vitest';
import { Ai, Body, Motion } from '../../src/sim/components';
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
