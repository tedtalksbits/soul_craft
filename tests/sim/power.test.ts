import { describe, expect, it } from 'vitest';
import type { TierId } from '../../src/content/schemas';
import { Body, Enemy, Equipment, Health, Inventory, type ItemStack } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { applyDamage } from '../../src/sim/modules/combat';
import { spawnEnemy } from '../../src/sim/modules/enemies';
import {
  armorPower,
  dropCapAt,
  dropPower,
  enemyPowerAt,
  gapMultiplier,
  maxPower,
  playerPower,
  weaponPower,
} from '../../src/sim/modules/power';
import { spawnProjectile } from '../../src/sim/modules/projectiles';
import { kindleHeat } from '../../src/sim/modules/wardens';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run, spawnNear } from '../helpers';

const { rings } = content.world;
const piece = (item: string, power: number, tier: TierId = 'common'): ItemStack => ({
  item,
  count: 1,
  level: 0,
  gear: { tier, power, seed: 1, perks: [] },
});
const eq = (sim: Simulation) => sim.ecs.need(sim.player, Equipment);
const at = (tiles: number) => tiles * TILE;

/** Every piece worn at one Power, rings included. */
function wearAt(sim: Simulation, power: number) {
  Object.assign(eq(sim), {
    weapon: piece('iron_sword', power),
    helmet: piece('iron_helm', power),
    chest: piece('iron_mail', power),
    legs: piece('iron_greaves', power),
    ring0: piece('ring_of_vigor', power),
    ring1: piece('ring_of_breath', power),
  });
}

describe('the player’s Power', () => {
  it('averages the six pieces worn; the weapon is checked alone and the armor as its three pieces', () => {
    const sim = newSim();
    wearAt(sim, 100);
    eq(sim).weapon = piece('iron_sword', 220);
    eq(sim).legs = piece('iron_greaves', 40);
    expect(playerPower(sim)).toBe(Math.floor((220 + 100 + 100 + 40 + 100 + 100) / 6));
    expect(weaponPower(eq(sim))).toBe(220);
    expect(armorPower(eq(sim))).toBe(80);
  });

  it('Max Power takes the best piece per slot the player owns, carried or worn, and the two best rings', () => {
    const sim = newSim();
    wearAt(sim, 100);
    const stacks = sim.ecs.need(sim.player, Inventory).stacks;
    stacks.push(piece('bone_cleaver', 160), piece('iron_sword', 130), piece('ring_of_vigor', 190));
    stacks.push(piece('ring_of_breath', 170));
    // Weapon 160 (not 130), rings 190 and 170, the rest worn at 100.
    expect(maxPower(sim)).toBe(Math.floor((160 + 100 + 100 + 100 + 190 + 170) / 6));
    expect(playerPower(sim)).toBe(100);
  });
});

describe('enemy Power', () => {
  it('rises smoothly with distance from the village, ring by ring, and holds past the last', () => {
    const [r0, r1, r2] = [rings[0]!, rings[1]!, rings[2]!];
    expect(enemyPowerAt(content, 0, 0)).toBe(r0.power);
    expect(enemyPowerAt(content, at(r1.from), 0)).toBe(r1.power);
    const halfway = enemyPowerAt(content, 0, at((r1.from + r2.from) / 2));
    expect(halfway).toBe(Math.round((r1.power + r2.power) / 2));
    const last = rings[rings.length - 1]!;
    expect(enemyPowerAt(content, at(last.from + 5000), 0)).toBe(last.power);
    // Wild drops stop at the cap of the ring they fall in.
    expect(dropCapAt(content, at(r1.from - 1), 0)).toBe(r0.cap);
    expect(dropCapAt(content, at(r1.from + 1), 0)).toBe(r1.cap);
  });

  it('is set as an enemy rises: its ring’s, or a boss’s own wherever its arena lies', () => {
    const sim = newSim();
    const far = spawnEnemy(sim, 'hollow', at(400), 0);
    expect(sim.ecs.need(far, Enemy).power).toBe(enemyPowerAt(content, at(400), 0));
    const warden = spawnNear(sim, 'ashen_warden', 60, 0);
    expect(sim.ecs.need(warden, Enemy).power).toBe(content.enemies['ashen_warden']!.boss!.power);
  });

  it('climbs with a rekindled Warden’s Heat', () => {
    const sim = newSim();
    sim.state.rekindled = { ashen_warden: 3 };
    const warden = spawnNear(sim, 'ashen_warden', 60, 0);
    kindleHeat(sim, warden, 'ashen_warden');
    const base = content.enemies['ashen_warden']!.boss!.power;
    expect(sim.ecs.need(warden, Enemy).power).toBe(base + 2 * content.loot.wardens.heat.power);
  });
});

describe('the Power gap', () => {
  it('blends between the rows and holds past the ends', () => {
    const gap = content.player.power.gap;
    expect(gapMultiplier(content, 0, 'dealt')).toBe(1);
    expect(gapMultiplier(content, 0, 'taken')).toBe(1);
    expect(gapMultiplier(content, -1000, 'dealt')).toBe(gap[0]![1]);
    expect(gapMultiplier(content, 1000, 'taken')).toBe(gap[gap.length - 1]![2]);
    const [a, b] = [gap[2]!, gap[3]!];
    expect(gapMultiplier(content, (a[0] + b[0]) / 2, 'dealt')).toBeCloseTo((a[1] + b[1]) / 2);
  });

  it('scales the player’s blows by the weapon’s Power against the foe’s', () => {
    const sim = newSim();
    const foe = spawnNear(sim, 'hollow', 30, 0);
    Object.assign(sim.ecs.need(foe, Health), { hp: 9999, max: 9999 });
    const blow = (foePower: number) => {
      sim.ecs.need(foe, Enemy).power = foePower;
      sim.events.drain();
      const b = sim.ecs.need(foe, Body);
      applyDamage(sim, foe, { amount: 100, crit: false, fromX: b.x - 5, fromY: b.y, knockback: 0 });
      return ofType(sim.events.drain(), 'damaged')[0]!.amount;
    };
    const start = content.loot.power.start;
    expect(blow(start)).toBe(100);
    expect(blow(start + 100)).toBe(Math.round(100 * gapMultiplier(content, -100, 'dealt')));
    expect(blow(start + 100)).toBeLessThan(100);
  });

  it('scales a foe’s blows, touch and shot alike, by its Power against the armor’s', () => {
    const taken = (foePower: number | undefined, shot: boolean) => {
      const sim = newSim();
      wearAt(sim, 100);
      const health = sim.ecs.need(sim.player, Health);
      Object.assign(health, { hp: 999, max: 999 });
      const pb = sim.ecs.need(sim.player, Body);
      if (shot) {
        spawnProjectile(sim, {
          kind: 'arrow',
          team: 'enemy',
          x: pb.x - 6,
          y: pb.y,
          dirX: 1,
          dirY: 0,
          speed: 2,
          damage: 40,
          ...(foePower === undefined ? {} : { power: foePower }),
        });
        run(sim, 6);
      } else {
        const foe = spawnNear(sim, 'hollow', 0, 0);
        sim.ecs.need(foe, Enemy).power = foePower ?? 100;
        run(sim, 1);
      }
      return 999 - health.hp;
    };
    for (const shot of [false, true]) {
      const even = taken(100, shot);
      expect(even).toBeGreaterThan(0);
      expect(taken(250, shot)).toBeGreaterThan(even);
    }
  });
});

describe('drops', () => {
  it('come in a little above Max Power, at least the foe’s own Power, at most the cap', () => {
    const sim = newSim();
    wearAt(sim, 100);
    const [lo, hi] = content.loot.power.offsets.wild;
    for (let i = 0; i < 50; i++) {
      const p = dropPower(sim, 'wild', 20, 300);
      expect(p).toBeGreaterThanOrEqual(100 + lo);
      expect(p).toBeLessThanOrEqual(100 + hi);
    }
    // A harder place catches the player up at once.
    expect(dropPower(sim, 'wild', 250, 300)).toBe(250);
    // And a ring's cap stops the climb.
    expect(dropPower(sim, 'wild', 20, 101)).toBeLessThanOrEqual(101);
  });

  it('from a Warden’s chest, pass the ring’s cap, up to the Warden’s Power and its headroom', () => {
    const sim = newSim();
    wearAt(sim, rings[0]!.cap);
    const warden = content.enemies['ashen_warden']!.boss!.power;
    const top = warden + content.loot.power.wardenHeadroom;
    const p = dropPower(sim, 'warden', warden, top);
    expect(p).toBeGreaterThan(rings[0]!.cap);
    expect(p).toBeLessThanOrEqual(top);
  });
});
