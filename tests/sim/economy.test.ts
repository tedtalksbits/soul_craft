import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Ai,
  Equipment,
  Bleed,
  Body,
  Boss,
  Burning,
  Coating,
  ContactDamage,
  Health,
  Inventory,
  Motion,
  Pickup,
  Player,
  Project,
} from '../../src/sim/components';
import { TICK_RATE, TILE } from '../../src/sim/constants';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { gamblePrice } from '../../src/sim/modules/gambler';
import { addItem, countItem } from '../../src/sim/modules/items';
import { rebuild } from '../../src/sim/modules/restoration';
import { inventoryCapacity, projectRank, restoredEffects } from '../../src/sim/modules/restored-effects';
import { strikeTiles } from '../../src/sim/modules/terrain';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run, spawnNear } from '../helpers';

const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const inv = (sim: Simulation) => sim.ecs.need(sim.player, Inventory);
const player = (sim: Simulation) => sim.ecs.need(sim.player, Player);

function dummy(sim: Simulation, dx: number, dy: number, archetype = 'hollow'): Entity {
  const e = spawnNear(sim, archetype, dx, dy);
  sim.ecs.remove(e, Ai);
  sim.ecs.remove(e, ContactDamage);
  sim.ecs.remove(e, Motion);
  Object.assign(sim.ecs.need(e, Health), { hp: 9999, max: 9999 });
  return e;
}

/** Drinks a consumable and waits out the drink. */
function drink(sim: Simulation, item: string): ReturnType<typeof run> {
  addItem(sim, sim.player, item, 1);
  const events = act(sim, { type: 'use', item });
  events.push(...run(sim, content.player.flask.duration));
  return events;
}

const hitsOn = (events: ReturnType<typeof run>, e: Entity) =>
  ofType(events, 'damaged').filter((d) => d.target === e);

describe('coatings', () => {
  it('fire oil sets what the weapon hits burning, once a second', () => {
    const sim = newSim();
    expect(ofType(drink(sim, 'fire_oil'), 'coated')).toHaveLength(1);
    face(sim, 'right');
    const foe = dummy(sim, 14, 0);
    press(sim, ['attack'], 16);
    expect(sim.ecs.has(foe, Burning)).toBe(true);
    const burns = hitsOn(run(sim, TICK_RATE * 2), foe);
    expect(burns.length).toBeGreaterThanOrEqual(2);
  });

  it('bleeding oil makes what the weapon hits bleed', () => {
    const sim = newSim();
    drink(sim, 'bleeding_oil');
    face(sim, 'right');
    const foe = dummy(sim, 14, 0);
    press(sim, ['attack'], 16);
    expect(sim.ecs.get(foe, Bleed)?.stacks).toBe(1);
  });

  it('a Warden’s Bane bites harder into bosses', () => {
    const hit = (coated: boolean) => {
      const sim = newSim();
      if (coated) drink(sim, 'wardens_bane');
      face(sim, 'right');
      const boss = dummy(sim, 18, 0, 'ashen_warden');
      expect(sim.ecs.has(boss, Boss)).toBe(true);
      return hitsOn(press(sim, ['attack'], 16), boss)[0]?.amount ?? 0;
    };
    expect(hit(true)).toBeGreaterThan(hit(false));
  });

  it('wears off, and a new coating replaces the old', () => {
    const sim = newSim();
    drink(sim, 'fire_oil');
    drink(sim, 'bleeding_oil');
    expect(sim.ecs.need(sim.player, Coating).coating.kind).toBe('bleed');
    const events = run(sim, 90 * TICK_RATE);
    expect(ofType(events, 'coatingEnded')).toHaveLength(1);
    expect(sim.ecs.has(sim.player, Coating)).toBe(false);
  });
});

describe('gathering tools', () => {
  /** Puts `tile` just right of the player and returns a box over it. */
  function tileBeside(sim: Simulation, tile: string) {
    const pb = sim.ecs.need(sim.player, Body);
    const tx = Math.floor(pb.x / TILE) + 1;
    const ty = Math.floor(pb.y / TILE);
    sim.world.setTile(tx, ty, tile);
    return { tx, ty, box: { x: tx * TILE + 2, y: ty * TILE + 2, w: 4, h: 4 } };
  }

  it('an axe brings a tree down in fewer swings', () => {
    const swings = (withAxe: boolean) => {
      const sim = newSim();
      if (withAxe) addItem(sim, sim.player, 'iron_axe', 1);
      const { tx, ty, box } = tileBeside(sim, 'tree');
      let n = 0;
      while (sim.world.tileAt(tx, ty)?.id === 'tree' && n < 10) {
        strikeTiles(sim, box);
        n++;
      }
      return n;
    };
    expect(swings(false)).toBe(3);
    expect(swings(true)).toBe(2);
  });

  it('a pickaxe turns up iron in rock, which bare hands never find', () => {
    const iron = (withPick: boolean) => {
      const sim = newSim();
      if (withPick) addItem(sim, sim.player, 'iron_pickaxe', 1);
      for (let i = 0; i < 30; i++) {
        const { tx, ty, box } = tileBeside(sim, 'rock');
        while (sim.world.tileAt(tx, ty)?.id === 'rock') strikeTiles(sim, box);
      }
      return [...sim.ecs.query(Pickup)].filter(([, p]) => p.item === 'iron_scrap').length;
    };
    expect(iron(false)).toBe(0);
    expect(iron(true)).toBeGreaterThan(3);
  });

  it('the best tool of a kind carried is the one that counts', () => {
    const sim = newSim();
    addItem(sim, sim.player, 'iron_axe', 1);
    addItem(sim, sim.player, 'steel_axe', 1);
    const { tx, ty, box } = tileBeside(sim, 'tree');
    strikeTiles(sim, box);
    // Steel's two extra hits on top of the swing fell a three-hit tree at once.
    expect(sim.world.tileAt(tx, ty)?.id).not.toBe('tree');
  });
});

describe('ranked projects', () => {
  it('a rebuilt project rises to rank II and III, the last needing a Warden Mark', () => {
    const sim = newSim();
    rebuild(sim, 'well', { anywhere: true, free: true });
    const flasks = player(sim).maxFlasks;
    rebuild(sim, 'well', { anywhere: true, free: true });
    expect(projectRank(sim, 'well')).toBe(2);
    expect(player(sim).maxFlasks).toBe(flasks + 1);
    const rankThree = content.restoration['well']!.ranks[1]!;
    expect(rankThree.cost.items.map((c) => c.item)).toContain('warden_mark');
    rebuild(sim, 'well', { anywhere: true, free: true });
    expect(projectRank(sim, 'well')).toBe(3);
    expect(rebuild(sim, 'well', { anywhere: true, free: true })).toBe(false);
  });

  it('a rank’s effects add to the ones before', () => {
    const sim = newSim();
    rebuild(sim, 'storehouse', { anywhere: true, free: true });
    rebuild(sim, 'storehouse', { anywhere: true, free: true });
    expect(inventoryCapacity(sim)).toBe(content.player.inventorySlots + 16);
    expect(restoredEffects(sim).some((fx) => fx.type === 'gambler')).toBe(true);
  });
});

describe('the Ember Gambler', () => {
  function atStorehouse(sim: Simulation): void {
    const site = [...sim.ecs.query(Project, Body)].find(([, p]) => p.project === 'storehouse');
    if (!site) throw new Error('no storehouse loaded');
    const pb = sim.ecs.need(sim.player, Body);
    pb.x = site[2].x;
    pb.y = site[2].y + 14;
  }

  it('sells an unidentified piece for the slot chosen, once the storehouse brings them back', () => {
    const sim = newSim();
    atStorehouse(sim);
    player(sim).souls = 5000;
    const closed = act(sim, { type: 'gamble', slot: 'ring' });
    expect(ofType(closed, 'craftFailed')[0]?.reason).toMatch(/Gambler/);
    rebuild(sim, 'storehouse', { anywhere: true, free: true });
    rebuild(sim, 'storehouse', { anywhere: true, free: true });
    const price = gamblePrice(sim);
    const events = act(sim, { type: 'gamble', slot: 'ring' });
    const sold = ofType(events, 'gambled')[0];
    expect(sold).toBeDefined();
    expect(content.item(sold!.item).kind).toBe('ring');
    expect(sold!.tier).not.toBe('common');
    expect(player(sim).souls).toBe(5000 - price);
    expect(countItem(inv(sim), sold!.item)).toBe(1);
  });

  it('charges more as Max Power rises', () => {
    const sim = newSim();
    const low = gamblePrice(sim);
    const worn = sim.ecs.need(sim.player, Equipment);
    for (const slot of ['weapon', 'helmet', 'chest', 'legs'] as const) {
      const gear = worn[slot]?.gear;
      if (gear) gear.power = 300;
    }
    expect(gamblePrice(sim)).toBeGreaterThan(low);
  });
});
