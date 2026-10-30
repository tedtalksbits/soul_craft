import { describe, expect, it } from 'vitest';
import { compassWord } from '../../src/core/math';
import { Body, Facing, Sign } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { signText } from '../../src/sim/modules/interaction';
import { newSim, ofType, press, run } from '../helpers';

describe('compass words', () => {
  it('names the eight directions, with south down the screen', () => {
    expect(compassWord(0, -1)).toBe('north');
    expect(compassWord(1, -1)).toBe('north-east');
    expect(compassWord(1, 1)).toBe('south-east');
    expect(compassWord(-1, 0)).toBe('west');
  });
});

describe('signposts', () => {
  it('leaves ordinary sign text alone', () => {
    const sim = newSim();
    expect(signText(sim, 'Beware the knights.', { x: 0, y: 0 })).toBe('Beware the knights.');
  });

  it('points the way to the village from wherever the sign stands', () => {
    const sim = newSim();
    const home = sim.world.gen.originSpawn();
    const at = { x: home.x + 100 * TILE, y: home.y + 100 * TILE };
    expect(signText(sim, '{village}', at)).toBe('Ashen Village lies 141 paces to the north-west.');
  });

  it('says you are there when the sign is in the village', () => {
    const sim = newSim();
    expect(signText(sim, '{village}', sim.world.gen.originSpawn())).toBe('You stand in Ashen Village.');
  });

  it('fills the placeholder when the sign is read', () => {
    const sim = newSim();
    const pb = sim.ecs.need(sim.player, Body);
    const sign = sim.ecs.create();
    sim.ecs.add(sign, Body, { x: pb.x, y: pb.y + 12, w: 10, h: 6 });
    sim.ecs.add(sign, Sign, { lines: ['A waymarker.', '{village}'] });
    sim.ecs.need(sim.player, Facing).dir = 'down';
    run(sim, 1);
    const events = press(sim, ['use'], 1);
    const read = ofType(events, 'read')[0];
    expect(read?.lines[0]).toBe('A waymarker.');
    expect(read?.lines[1]).toMatch(
      /^(You stand in Ashen Village\.|Ashen Village lies \d+ paces to the [a-z-]+\.)$/,
    );
  });

  it('every wayshrine carries a signpost that points home', () => {
    const sim = newSim();
    const legend = sim.content.prefabs['wayshrine']?.legend ?? {};
    const signs = Object.values(legend).filter((e) => e.entity?.kind === 'sign');
    expect(signs.some((e) => e.entity?.kind === 'sign' && e.entity.lines.includes('{village}'))).toBe(true);
  });
});
