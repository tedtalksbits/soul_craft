import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import {
  Ai,
  Body,
  Boss,
  ContactDamage,
  Equipment,
  Health,
  Inventory,
  Motion,
  Pickup,
  Player,
  Staggered,
  type ItemStack,
} from '../../src/sim/components';
import { inputFrame, type PlayerAction } from '../../src/sim/input';
import { applyDamage, killEnemy } from '../../src/sim/modules/combat';
import { rollDrop } from '../../src/sim/modules/gear';
import { addItem, countItem } from '../../src/sim/modules/items';
import { bossEntity } from '../../src/sim/modules/bosses';
import { signatureChance, wardenHere, wardenHome } from '../../src/sim/modules/wardens';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, press, run, spawnNear, unarmored } from '../helpers';

const WARDEN = 'ashen_warden';
const loot = content.loot.wardens;
const warden = content.enemies[WARDEN]!.boss!.warden!;
const act = (sim: Simulation, ...actions: PlayerAction[]) => run(sim, 1, inputFrame({ actions }));
const player = (sim: Simulation) => sim.ecs.need(sim.player, Player);
const pickups = (sim: Simulation) => [...sim.ecs.query(Pickup)].map(([, p]) => p);

/** Kills a Warden where it stands and returns the events. */
function fell(sim: Simulation, e: Entity): ReturnType<typeof run> {
  killEnemy(sim, e);
  return sim.events.drain();
}

/** Rests the player at the Warden's bonfire (just outside its arena), with its chunk loaded. */
function atWardenBonfire(sim: Simulation): void {
  const home = wardenHome(sim, WARDEN)!;
  const pb = sim.ecs.need(sim.player, Body);
  pb.x = home.x;
  pb.y = home.y + (content.enemies[WARDEN]!.boss!.arenaTiles + 4) * 16;
  run(sim, 3);
  player(sim).state = 'sit';
}

describe('a Warden’s first fall', () => {
  it('keeps the story drops and bursts a chest with a Noble or better in it', () => {
    const sim = newSim();
    const e = spawnNear(sim, WARDEN, 60, 0);
    const events = fell(sim, e);
    expect(ofType(events, 'wardenChest')).toHaveLength(1);
    const items = pickups(sim).map((p) => p.item);
    expect(items).toContain('kindling_warden');
    expect(items).toContain(loot.mark);
    const gear = pickups(sim).flatMap((p) => (p.gear ? [p.gear.tier] : []));
    expect(gear.length).toBeGreaterThanOrEqual(loot.items);
    expect(gear.some((t) => t === 'noble' || t === 'legendary')).toBe(true);
    expect(sim.state.bossesDefeated[WARDEN]).toBe(true);
  });
});

describe('Rekindle', () => {
  it('brings a defeated Warden back from its bonfire, and a refight gives only items', () => {
    const sim = newSim();
    sim.state.bossesDefeated[WARDEN] = true;
    atWardenBonfire(sim);
    expect(wardenHere(sim)).toBe(WARDEN);
    act(sim, { type: 'rekindle', boss: WARDEN, heat: 1 });
    expect(sim.state.rekindled?.[WARDEN]).toBe(1);
    const e = bossEntity(sim, WARDEN);
    expect(e).toBeDefined();
    const souls = player(sim).souls;
    const events = fell(sim, e!);
    expect(ofType(events, 'wardenChest')).toHaveLength(1);
    expect(player(sim).souls).toBe(souls);
    expect(
      pickups(sim).some((p) => p.item === 'kindling_warden' || p.kind === 'souls' || p.kind === 'ember'),
    ).toBe(false);
    expect(sim.state.rekindled?.[WARDEN]).toBeUndefined();
  });

  it('brings the Warden back even inside the village’s widest ward', () => {
    const sim = newSim();
    sim.state.bossesDefeated[WARDEN] = true;
    sim.state.restored['palisade'] = true;
    sim.state.projectRanks = { palisade: content.restoration['palisade']!.ranks.length + 1 };
    atWardenBonfire(sim);
    act(sim, { type: 'rekindle', boss: WARDEN, heat: 1 });
    expect(bossEntity(sim, WARDEN)).toBeDefined();
  });

  it('needs the Warden’s bonfire', () => {
    const sim = newSim();
    sim.state.bossesDefeated[WARDEN] = true;
    player(sim).state = 'sit';
    const events = act(sim, { type: 'rekindle', boss: WARDEN, heat: 1 });
    expect(ofType(events, 'craftFailed')[0]?.reason).toMatch(/Warden’s bonfire/);
  });
});

describe('Heat', () => {
  it('costs a Sigil a step, makes the Warden tougher, and opens one step at a time', () => {
    const sim = newSim();
    sim.state.bossesDefeated[WARDEN] = true;
    atWardenBonfire(sim);
    const three = act(sim, { type: 'rekindle', boss: WARDEN, heat: 3 });
    expect(ofType(three, 'craftFailed')[0]?.reason).toMatch(/clear Heat 2/);
    const noSigil = act(sim, { type: 'rekindle', boss: WARDEN, heat: 2 });
    expect(ofType(noSigil, 'craftFailed')[0]?.reason).toMatch(/Sigil/);
    addItem(sim, sim.player, loot.sigil, 1);
    act(sim, { type: 'rekindle', boss: WARDEN, heat: 2 });
    const e = bossEntity(sim, WARDEN)!;
    expect(sim.ecs.need(e, Boss).heat).toBe(2);
    expect(sim.ecs.need(e, Health).max).toBe(Math.round(content.enemies[WARDEN]!.hp * (1 + loot.heat.hp)));
    expect(countItem(sim.ecs.need(sim.player, Inventory), loot.sigil)).toBe(0);
    fell(sim, e);
    expect(
      pickups(sim)
        .filter((p) => p.item === loot.mark)
        .reduce((n, p) => n + p.amount, 0),
    ).toBe(loot.marks + 1);
    expect(sim.state.heatCleared?.[WARDEN]).toBe(2);
  });
});

describe('the signature item', () => {
  it('starts at its base chance, and comes for sure by the last chest', () => {
    const sim = newSim();
    expect(signatureChance(sim, WARDEN)).toBeCloseTo(loot.signature.chance);
    sim.state.signaturePity = { [WARDEN]: loot.signature.sureBy - 1 };
    expect(signatureChance(sim, WARDEN)).toBe(1);
    fell(sim, spawnNear(sim, WARDEN, 60, 0));
    expect(pickups(sim).some((p) => p.item === warden.signature)).toBe(true);
    expect(sim.state.signaturePity[WARDEN]).toBe(0);
  });

  it('is swapped for the alternate when the Warden was baited onto its braziers', () => {
    const sim = newSim();
    sim.state.signaturePity = { [WARDEN]: loot.signature.sureBy - 1 };
    const e = spawnNear(sim, WARDEN, 60, 0);
    sim.ecs.need(e, Boss).brazierSlams = warden.alternate.slams;
    fell(sim, e);
    expect(pickups(sim).some((p) => p.item === warden.alternate.item)).toBe(true);
    expect(pickups(sim).some((p) => p.item === warden.signature)).toBe(false);
  });

  it('can be bought outright with Warden Marks at its bonfire', () => {
    const sim = newSim();
    sim.state.bossesDefeated[WARDEN] = true;
    atWardenBonfire(sim);
    addItem(sim, sim.player, loot.mark, loot.markPrice);
    act(sim, { type: 'buySignature', boss: WARDEN });
    const inv = sim.ecs.need(sim.player, Inventory);
    expect(countItem(inv, warden.signature)).toBe(1);
    expect(countItem(inv, loot.mark)).toBe(0);
  });

  it('never drops as an ordinary Legendary', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const item = rollDrop(content, 'legendary', 1, seed).item;
      expect([warden.signature, warden.alternate.item]).not.toContain(item);
    }
  });
});

describe('Warden poise', () => {
  it('a hammer fills it three times faster, and full it staggers the Warden', () => {
    const hit = (poise: number) => {
      const sim = newSim();
      const e = spawnNear(sim, WARDEN, 60, 0);
      Object.assign(sim.ecs.need(e, Health), { hp: 9999, max: 9999 });
      const pb = sim.ecs.need(sim.player, Body);
      applyDamage(sim, e, { amount: 50, crit: false, fromX: pb.x, fromY: pb.y, knockback: 0, poise });
      return sim.ecs.has(e, Staggered);
    };
    expect(hit(1)).toBe(false);
    expect(hit(3)).toBe(true);
  });
});

describe('the Warden Legendaries', () => {
  const worn = (item: string): ItemStack => ({
    item,
    count: 1,
    level: 0,
    gear: { tier: 'legendary', ilvl: 1, seed: 1, perks: [] },
  });

  it('the Aegis turns aside the first blow after a roll, burning what is close', () => {
    const sim = unarmored(newSim());
    sim.ecs.need(sim.player, Equipment).chest = worn(warden.signature);
    const foe = spawnNear(sim, 'hollow', 20, 0);
    sim.ecs.remove(foe, Ai);
    sim.ecs.remove(foe, ContactDamage);
    sim.ecs.remove(foe, Motion);
    press(sim, ['roll'], content.player.roll.duration + 1);
    const hp = sim.ecs.need(sim.player, Health).hp;
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, sim.player, { amount: 20, crit: false, fromX: pb.x, fromY: pb.y - 1, knockback: 0 });
    const events = sim.events.drain();
    expect(ofType(events, 'warded')).toHaveLength(1);
    expect(sim.ecs.need(sim.player, Health).hp).toBe(hp);
    expect(ofType(events, 'damaged').some((d) => d.target === foe)).toBe(true);
  });

  it('the Brand bursts every kill into embers', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Equipment).weapon = worn(warden.alternate.item);
    const victim = spawnNear(sim, 'hollow', 20, 0);
    const beside = spawnNear(sim, 'hollow', 30, 10);
    const pb = sim.ecs.need(sim.player, Body);
    applyDamage(sim, victim, { amount: 999, crit: false, fromX: pb.x, fromY: pb.y, knockback: 0 });
    expect(ofType(sim.events.drain(), 'damaged').some((d) => d.target === beside)).toBe(true);
  });
});
