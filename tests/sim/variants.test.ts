import { describe, expect, it } from 'vitest';
import { Abilities, Player } from '../../src/sim/components';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { abilityIn } from '../../src/sim/modules/abilities';
import { canChoose, versionsOf } from '../../src/sim/modules/variants';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, press, run } from '../helpers';

const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const choose = (sim: Simulation, base: string, ability: string) =>
  act(sim, { type: 'chooseVariant', base, ability });
const abilities = (sim: Simulation) => sim.ecs.need(sim.player, Abilities);
const souls = content.ability('shockwave').souls ?? 0;

/** A Vanguard seated at a bonfire with `souls` to spend and every slot awake. */
function resting(amount = 10_000): Simulation {
  const sim = newSim();
  const p = sim.ecs.need(sim.player, Player);
  p.state = 'sit';
  p.souls = amount;
  abilities(sim).unlocked = { class: true, super: true };
  return sim;
}

describe('ability variants', () => {
  it('every class ability with variants lists its base first', () => {
    expect(versionsOf(content, 'ground_slam').map(([id]) => id)).toEqual(['ground_slam', 'shockwave']);
  });

  it('learning a variant at a bonfire costs souls once and puts it in the slot', () => {
    const sim = resting();
    const events = choose(sim, 'ground_slam', 'shockwave');
    expect(ofType(events, 'variantLearned')).toEqual([{ type: 'variantLearned', ability: 'shockwave' }]);
    expect(sim.ecs.need(sim.player, Player).souls).toBe(10_000 - souls);
    expect(abilityIn(sim, 'aoe')).toBe('shockwave');

    // Back to the base and back again: free, it is already learned.
    choose(sim, 'ground_slam', 'ground_slam');
    expect(abilityIn(sim, 'aoe')).toBe('ground_slam');
    choose(sim, 'ground_slam', 'shockwave');
    expect(sim.ecs.need(sim.player, Player).souls).toBe(10_000 - souls);
    expect(abilityIn(sim, 'aoe')).toBe('shockwave');
  });

  it('the chosen variant is what the key casts', () => {
    const sim = resting();
    choose(sim, 'ground_slam', 'shockwave');
    sim.ecs.need(sim.player, Player).state = 'free';
    const events = press(sim, ['aoe'], 20);
    expect(ofType(events, 'abilityUsed').map((e) => e.ability)).toEqual(['shockwave']);
  });

  it('needs a bonfire, the souls, and an awakened slot of your own class', () => {
    const away = resting();
    away.ecs.need(away.player, Player).state = 'free';
    expect(canChoose(away, 'ground_slam', 'shockwave')).toEqual({
      ok: false,
      reason: 'rest at a bonfire to change',
    });

    const poor = resting(souls - 1);
    choose(poor, 'ground_slam', 'shockwave');
    expect(abilityIn(poor, 'aoe')).toBe('ground_slam');

    const locked = resting();
    abilities(locked).unlocked.class = false;
    expect(canChoose(locked, 'shield_charge', 'bulwark_rush')).toEqual({
      ok: false,
      reason: 'not yet awakened',
    });

    // Another class's ability, or a variant of something else.
    expect(canChoose(resting(), 'ash_bomb', 'twin_charge').ok).toBe(false);
    expect(canChoose(resting(), 'ground_slam', 'bulwark_rush').ok).toBe(false);
  });

  it('a class changed and changed back keeps its choices', () => {
    const sim = resting();
    choose(sim, 'ground_slam', 'shockwave');
    act(sim, { type: 'setClass', class: 'stalker' });
    expect(abilityIn(sim, 'aoe')).toBe('ash_bomb');
    act(sim, { type: 'setClass', class: 'vanguard' });
    expect(abilityIn(sim, 'aoe')).toBe('shockwave');
  });
});
