import { describe, expect, it } from 'vitest';
import { selectAnim } from '../../src/client/render/anim-select';
import { Body, Dying, Player } from '../../src/sim/components';
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

  it('times a dying enemy from its death timer', () => {
    const sim = newSim();
    const e = spawnNear(sim, 'hollow', 60, 0);
    sim.ecs.add(e, Dying, { t: 12 });
    const choice = selectAnim(sim, e, undefined, all);
    expect(choice.key).toBe('hurt_down');
    expect(choice.elapsedMs).toBeCloseTo(200);
  });
});
