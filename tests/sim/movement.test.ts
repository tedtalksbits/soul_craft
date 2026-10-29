import { describe, expect, it } from 'vitest';
import { Body } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { moveBody } from '../../src/sim/physics';
import type { Simulation } from '../../src/sim/simulation';
import { newSim } from '../helpers';

/**
 * Builds a wall one tile to the right of the player with a one-tile gap in it,
 * and puts a 12x10 body `offset` px below the gap's center line.
 */
function gapAhead(sim: Simulation, offset: number): { body: Body; wallX: number } {
  const pb = sim.ecs.need(sim.player, Body);
  const tx = Math.floor(pb.x / TILE) + 2;
  const gy = Math.floor(pb.y / TILE);
  for (let ty = gy - 3; ty <= gy + 3; ty++) sim.world.setTile(tx, ty, ty === gy ? 'flagstone' : 'wall');
  for (let ty = gy - 3; ty <= gy + 3; ty++) sim.world.setTile(tx - 1, ty, 'flagstone');
  const body: Body = { x: (tx - 1) * TILE + TILE / 2, y: gy * TILE + TILE / 2 + offset, w: 12, h: 10 };
  return { body, wallX: tx * TILE };
}

const walkRight = (sim: Simulation, body: Body, slide: number) => {
  for (let i = 0; i < 90; i++) moveBody(sim.world, body, 1.075, 0, slide);
};

describe('corner sliding', () => {
  it('threads a one-tile gap when slightly off-center', () => {
    const sim = newSim();
    const { body, wallX } = gapAhead(sim, 5);
    walkRight(sim, body, 5);
    expect(body.x).toBeGreaterThan(wallX + TILE);
  });

  it('is what makes the difference: without it the same body stops at the wall', () => {
    const sim = newSim();
    const { body, wallX } = gapAhead(sim, 5);
    walkRight(sim, body, 0);
    expect(body.x + body.w / 2).toBeLessThanOrEqual(wallX);
  });

  it('does not steer around obstacles the body overlaps by more than the slide distance', () => {
    const sim = newSim();
    const { body, wallX } = gapAhead(sim, 13);
    walkRight(sim, body, 5);
    expect(body.x + body.w / 2).toBeLessThanOrEqual(wallX);
  });
});
