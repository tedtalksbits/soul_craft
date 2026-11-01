import { describe, expect, it } from 'vitest';
import {
  Abilities,
  Attributes,
  Equipment,
  Health,
  Inventory,
  Pickup,
  Player,
  Stamina,
} from '../../src/sim/components';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { killEnemy } from '../../src/sim/modules/combat';
import { gainEnergy } from '../../src/sim/modules/energy';
import { countItem, playerStats } from '../../src/sim/modules/items';
import { abilityPower, levelCost, playerLevel } from '../../src/sim/modules/progression';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run, spawnNear } from '../helpers';

const leveling = content.player.leveling;
const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const player = (sim: Simulation) => sim.ecs.need(sim.player, Player);
const attrs = (sim: Simulation) => sim.ecs.need(sim.player, Attributes);

/** Seated at a bonfire with plenty of souls. */
function resting(souls = 10_000): Simulation {
  const sim = newSim();
  const p = player(sim);
  p.state = 'sit';
  p.souls = souls;
  return sim;
}

/** Kills a knight next to the player and lets the magnet bring in what it dropped. */
function killKnight(sim: Simulation) {
  sim.state.cheats.god = true;
  const knight = spawnNear(sim, 'knight', 30, 0);
  killEnemy(sim, knight);
  const dropped = [...sim.ecs.query(Pickup)].map(([, p]) => p.item).filter((i) => i?.startsWith('relic_'));
  const events = run(sim, 180);
  return { dropped, events };
}

describe('leveling', () => {
  it('costs more souls each level', () => {
    const sim = resting();
    expect(levelCost(sim)).toBe(leveling.cost.base);
    act(sim, { type: 'levelUp', attribute: 'vigor' });
    expect(playerLevel(attrs(sim))).toBe(2);
    expect(levelCost(sim)).toBe(Math.round(leveling.cost.base * leveling.cost.growth));
  });

  it('spends souls at a bonfire, and nowhere else', () => {
    const sim = newSim();
    player(sim).souls = 10_000;
    act(sim, { type: 'levelUp', attribute: 'might' });
    expect(attrs(sim).might).toBe(0);

    player(sim).state = 'sit';
    const events = act(sim, { type: 'levelUp', attribute: 'might' });
    expect(attrs(sim).might).toBe(1);
    expect(player(sim).souls).toBe(10_000 - leveling.cost.base);
    expect(ofType(events, 'leveledUp')).toEqual([{ type: 'leveledUp', attribute: 'might', level: 2 }]);
  });

  it('needs the souls for it', () => {
    const sim = resting(leveling.cost.base - 1);
    act(sim, { type: 'levelUp', attribute: 'vigor' });
    expect(attrs(sim).vigor).toBe(0);
    expect(player(sim).souls).toBe(leveling.cost.base - 1);
  });

  it('Vigor raises max health and Endurance max stamina', () => {
    const sim = resting();
    const [hp, stamina] = [sim.ecs.need(sim.player, Health).max, sim.ecs.need(sim.player, Stamina).max];
    act(sim, { type: 'levelUp', attribute: 'vigor' });
    act(sim, { type: 'levelUp', attribute: 'endurance' });
    expect(sim.ecs.need(sim.player, Health).max).toBe(hp + leveling.perLevel.vigor.maxHp[0]);
    expect(sim.ecs.need(sim.player, Stamina).max).toBe(stamina + leveling.perLevel.endurance.maxStamina[0]);
  });

  it('Might raises weapon damage; Attunement raises ability damage and super charge', () => {
    const sim = resting();
    const sword = playerStats(sim, sim.player).damage;
    act(sim, { type: 'levelUp', attribute: 'might' });
    expect(playerStats(sim, sim.player).damage).toBeCloseTo(sword * (1 + leveling.perLevel.might.damage[0]));

    const power = abilityPower(sim);
    act(sim, { type: 'levelUp', attribute: 'attunement' });
    expect(abilityPower(sim)).toBeCloseTo(power + leveling.perLevel.attunement.abilityDamage[0]);
    const a = sim.ecs.need(sim.player, Abilities);
    a.unlocked.super = true;
    a.energy = 0;
    gainEnergy(sim, 10);
    expect(a.energy).toBeCloseTo(10 * (1 + leveling.perLevel.attunement.energy[0]));
  });

  it('points past each soft cap give less, gear points included', () => {
    const sim = newSim();
    const [first, second] = leveling.softCaps;
    const gains = leveling.perLevel.vigor.maxHp;
    const maxHp = (points: number) => {
      attrs(sim).vigor = points;
      return playerStats(sim, sim.player).maxHp;
    };
    expect(maxHp(first) - maxHp(first - 1)).toBe(gains[0]);
    expect(maxHp(first + 1) - maxHp(first)).toBe(gains[1]);
    expect(maxHp(second + 1) - maxHp(second)).toBe(gains[2]);
    // A helmet's +2 Vigor lands on the same breakpoints as 2 more levels would.
    const eq = sim.ecs.need(sim.player, Equipment);
    const helm = (perks: { perk: string; value: number }[]) => ({
      item: 'iron_helm',
      count: 1,
      level: 0,
      gear: { tier: 'standard' as const, ilvl: 1, seed: 1, perks },
    });
    eq.helmet = helm([]);
    const leveled = maxHp(first + 2);
    eq.helmet = helm([{ perk: 'vigor', value: 2 }]);
    expect(maxHp(first)).toBe(leveled);
    expect(playerStats(sim, sim.player).attributes.vigor).toBe(first + 2);
  });
});

describe('ability unlocks', () => {
  it('a new game knows only its AoE: the class ability and super are locked', () => {
    const sim = newSim();
    const a = sim.ecs.need(sim.player, Abilities);
    expect(a.unlocked).toEqual({ class: false, super: false });
    const events = run(sim, 1, inputFrame({ press: ['classAbility'] }));
    expect(ofType(events, 'abilityLocked')).toEqual([{ type: 'abilityLocked', slot: 'class' }]);
    expect(player(sim).state).not.toBe('cast');
    gainEnergy(sim, 50);
    expect(a.energy).toBe(0);
  });

  it('the first guardian knight drops the Oath Ember, which the player carries to Maren', () => {
    const sim = newSim();
    const { dropped, events } = killKnight(sim);
    expect(dropped).toEqual(['relic_oath']);
    // Beating a knight awakens nothing by itself: Maren takes the oath (see objectives.test.ts).
    expect(ofType(events, 'abilityUnlocked')).toEqual([]);
    expect(sim.ecs.need(sim.player, Abilities).unlocked).toEqual({ class: false, super: false });
    expect(countItem(sim.ecs.need(sim.player, Inventory), 'relic_oath')).toBe(1);
  });

  it('no knight drops a second oath while one is carried, or once the class ability is awake', () => {
    const sim = newSim();
    killKnight(sim);
    expect(killKnight(sim).dropped).toEqual([]);
    sim.ecs.need(sim.player, Inventory).stacks = [];
    sim.ecs.need(sim.player, Abilities).unlocked.class = true;
    expect(killKnight(sim).dropped).toEqual([]);
  });
});
