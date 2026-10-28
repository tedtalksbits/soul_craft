import { describe, expect, it } from 'vitest';
import { Rng } from '../../src/core/rng';
import { Body } from '../../src/sim/components';
import { Action, type InputFrame } from '../../src/sim/input';
import { Simulation, type SimSnapshot } from '../../src/sim/simulation';
import { content, newSim, run } from '../helpers';

/** A reproducible stream of plausible player input. */
function scriptedInput(seed: number, ticks: number): InputFrame[] {
  const rng = new Rng(seed);
  const frames: InputFrame[] = [];
  let moveX = 0;
  let moveY = 0;
  for (let i = 0; i < ticks; i++) {
    if (i % 40 === 0) [moveX, moveY] = [rng.int(-1, 1), rng.int(-1, 1)];
    const pressed = rng.chance(0.05) ? rng.pick([Action.attack, Action.roll, Action.attack]) : 0;
    frames.push({ moveX, moveY, aim: null, pressed, held: pressed });
  }
  return frames;
}

const play = (sim: Simulation, frames: InputFrame[]) => {
  for (const f of frames) {
    sim.step(f);
    sim.events.drain();
  }
};

describe('determinism', () => {
  it('same seed and input produce the same world', () => {
    const input = scriptedInput(5, 1500);
    const a = newSim(77);
    const b = newSim(77);
    play(a, input);
    play(b, input);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it('a restored snapshot continues exactly like the original', () => {
    const input = scriptedInput(9, 2000);
    const original = newSim(31);
    play(original, input.slice(0, 900));
    const restored = Simulation.restore(
      JSON.parse(JSON.stringify(original.snapshot())) as SimSnapshot,
      content,
    );
    play(original, input.slice(900));
    play(restored, input.slice(900));
    expect(restored.snapshot()).toEqual(original.snapshot());
  });

  it('streams chunks as the player travels and keeps kills across reloads', () => {
    const sim = newSim(3);
    sim.state.cheats.noclip = true;
    const start = sim.world.loadedKeys.sort();
    const firstEnemySpawn = sim.world.loadedKeys
      .flatMap((k) => sim.world.getChunk(k)!.spawns)
      .find((s) => s.entity.kind === 'enemy');
    expect(firstEnemySpawn).toBeDefined();
    sim.state.killed[firstEnemySpawn!.id] = true;

    const pb = sim.ecs.need(sim.player, Body);
    pb.x += 32 * 16 * 4;
    run(sim, 2);
    expect(sim.world.loadedKeys.sort()).not.toEqual(start);
    expect(sim.world.loadedKeys).toHaveLength(9);

    pb.x -= 32 * 16 * 4;
    run(sim, 2);
    expect(sim.world.loadedKeys.sort()).toEqual(start);
    expect(sim.state.killed[firstEnemySpawn!.id]).toBe(true);
  });
});
