import { describe, expect, it } from 'vitest';
import { castFrame, selectAnim } from '../../src/client/render/anim-select';
import { Abilities, Ai, Body, Dying, Player } from '../../src/sim/components';
import { inputFrame } from '../../src/sim/input';
import { face, newSim, press, run, spawnNear } from '../helpers';

const all = () => true;

describe('selectAnim', () => {
  it('faces an aimed attack along the swing, not the facing or movement', () => {
    const sim = newSim();
    face(sim, 'up');
    const pb = sim.ecs.need(sim.player, Body);
    run(sim, 1, inputFrame({ press: ['attack'], aim: { x: pb.x + 20, y: pb.y + 20 }, move: [-1, 0] }));
    const choice = selectAnim(sim, sim.player, 'left', all);
    expect(choice.key).toBe('attack_down_right');
    expect(choice.dir8).toBe('down_right');
  });

  it('times one-shot actions from the state timer, so repeated attacks restart', () => {
    const sim = newSim();
    press(sim, ['attack'], 14);
    const late = selectAnim(sim, sim.player, undefined, all).elapsedMs ?? 0;
    expect(late).toBeCloseTo((sim.ecs.need(sim.player, Player).t * 1000) / 60);
    run(sim, 3);
    press(sim, ['attack'], 1);
    const fresh = selectAnim(sim, sim.player, undefined, all).elapsedMs ?? Infinity;
    expect(sim.ecs.need(sim.player, Player).state).toBe('attack');
    expect(fresh).toBeLessThan(late);
  });

  it('runs ambient loops on wall-clock time', () => {
    const sim = newSim();
    run(sim, 2, inputFrame({ move: [1, 0] }));
    const choice = selectAnim(sim, sim.player, undefined, all);
    expect(choice.key).toBe('walk_right');
    expect(choice.elapsedMs).toBeUndefined();
  });

  it('falls back from 8-way to 4-way to undirected names', () => {
    const sim = newSim();
    run(sim, 2, inputFrame({ move: [1, 1] }));
    expect(selectAnim(sim, sim.player, undefined, all).key).toBe('walk_down_right');
    const fourWay = (k: string) => !k.includes('_down_right');
    expect(selectAnim(sim, sim.player, undefined, fourWay).key).toBe('walk_right');
  });

  it('shows a dying enemy as dead, timed from its death timer', () => {
    const sim = newSim();
    const e = spawnNear(sim, 'hollow', 60, 0);
    sim.ecs.add(e, Dying, { t: 12 });
    const choice = selectAnim(sim, e, undefined, all);
    expect(choice.key).toBe('dead_down');
    expect(choice.elapsedMs).toBeCloseTo(200);
    // Sheets without a dead pose (placeholders) fall back to hurt.
    expect(selectAnim(sim, e, undefined, (k) => !k.startsWith('dead')).key).toBe('hurt_down');
  });

  it('faces an enemy winding up towards the player in 8 directions', () => {
    const sim = newSim();
    const e = spawnNear(sim, 'hollow', -20, -20);
    Object.assign(sim.ecs.need(e, Ai), { state: 'windup', t: 5 });
    expect(selectAnim(sim, e, 'left', all).key).toBe('windup_down_right');
  });

  it('faces a lunging enemy along its committed direction', () => {
    const sim = newSim();
    const e = spawnNear(sim, 'hollow', 30, 0);
    Object.assign(sim.ecs.need(e, Ai), { state: 'lunge', t: 2, dirX: -0.7, dirY: 0.7 });
    expect(selectAnim(sim, e, 'up', all).key).toBe('attack_down_left');
  });
});

describe('selectAnim: archers', () => {
  it('walks backwards, still facing the player, when backing away', () => {
    const sim = newSim();
    sim.state.cheats.god = true;
    const e = spawnNear(sim, 'archer', 30, 0);
    sim.ecs.need(e, Ai).cooldown = 999;
    run(sim, 10);
    const choice = selectAnim(sim, e, undefined, all);
    expect(choice.key).toBe('walk_left');
    expect(choice.reverse).toBe(true);
  });

  it('shows the release as its attack after a shot', () => {
    const sim = newSim();
    const e = spawnNear(sim, 'archer', -60, -60);
    Object.assign(sim.ecs.need(e, Ai), { state: 'loose', t: 3 });
    const choice = selectAnim(sim, e, undefined, all);
    expect(choice.key).toBe('attack_down_right');
    expect(choice.elapsedMs).toBeCloseTo(50);
  });
});

describe('cast poses', () => {
  const slam = { release: 10, ticks: 20, loopAfterRelease: false };

  it('lands the release frame exactly on the release tick, whatever the cast length', () => {
    expect(castFrame({ ...slam, t: 9 }, 5, 2, 15)).toBe(1);
    expect(castFrame({ ...slam, t: 10 }, 5, 2, 15)).toBe(2);
    const superCast = { release: 16, ticks: 30, loopAfterRelease: false };
    expect(castFrame({ ...superCast, t: 15 }, 5, 2, 15)).toBe(1);
    expect(castFrame({ ...superCast, t: 16 }, 5, 2, 15)).toBe(2);
  });

  it('plays the frames before and after the release in order, ending on the last', () => {
    const frames = Array.from({ length: 21 }, (_, t) => castFrame({ ...slam, t }, 5, 2, 15));
    expect(frames[0]).toBe(0);
    expect(frames).toEqual([...frames].sort((a, b) => a - b));
    expect(frames[20]).toBe(4);
  });

  it('loops the run frames after the release for a dash', () => {
    const charge = { release: 2, ticks: 16, loopAfterRelease: true };
    const run = Array.from({ length: 14 }, (_, i) => castFrame({ ...charge, t: 2 + i }, 3, 1, 12));
    expect(new Set(run)).toEqual(new Set([1, 2]));
    expect(castFrame({ ...charge, t: 0 }, 3, 1, 12)).toBe(0);
  });

  it('casts play their ability’s pose, timed from the sim', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Abilities).class = 'vanguard';
    run(sim, 1, inputFrame({ press: ['aoe'] }));
    run(sim, 4);
    const choice = selectAnim(sim, sim.player, undefined, (k) => k.startsWith('cast_slam'));
    expect(choice.key.startsWith('cast_slam')).toBe(true);
    expect(choice.cast).toMatchObject({ release: 10, ticks: 20, loopAfterRelease: false });
  });
});
