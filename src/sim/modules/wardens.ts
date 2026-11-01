/**
 * Wardens after the story (docs/gear-and-loot.md, section 8): a chest every time one falls, a named signature
 * Legendary with pity and a Mark backstop, free refights from the arena bonfire, and Heat for those who want
 * a fiercer fight and a richer chest.
 *
 * The first kill keeps every story reward (killEnemy's drops) and adds a chest with a Noble or better in it. A
 * refight (Rekindle) gives only items, as the owner decided: the chest, never souls or story drops. There is no
 * chest art yet, so the chest bursts open where the Warden falls and spills its loot.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import { TIERS, type TierId } from '../../content/schemas';
import { Abilities, Body, Boss, Enemy, Health, Inventory, Player } from '../components';
import { TILE } from '../constants';
import type { PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import type { Check } from './crafting';
import { gambleItemLevel } from './gambler';
import { itemLevelAt, rollGear, rollForSlot } from './gear';
import { addStack, countItem, removeItem } from './items';
import { dropPickup } from './pickups';
import { resetEnemies } from './streaming';

const fail = (reason: string): Check => ({ ok: false, reason });

/** Where a Warden lives: the spawn point of its fixed arena, in world pixels. */
export function wardenHome(sim: Simulation, boss: string): { x: number; y: number } | null {
  for (const p of sim.world.gen.fixedPlacements()) {
    const char = Object.entries(p.prefab.legend).find(
      ([, l]) => l.entity?.kind === 'enemy' && l.entity.archetype === boss,
    )?.[0];
    if (!char) continue;
    for (let row = 0; row < p.prefab.rows.length; row++) {
      const col = p.prefab.rows[row]!.indexOf(char);
      if (col >= 0) return { x: (p.x0 + col) * TILE + TILE / 2, y: (p.y0 + row) * TILE + TILE / 2 };
    }
  }
  return null;
}

/**
 * The defeated Warden whose bonfire the player rests at, if any: one whose arena lies within a short walk of
 * the player.
 */
export function wardenHere(sim: Simulation): string | null {
  if (sim.ecs.need(sim.player, Player).state !== 'sit') return null;
  const pb = sim.ecs.need(sim.player, Body);
  for (const [id, def] of Object.entries(sim.content.enemies)) {
    if (!def.boss?.warden || !sim.state.bossesDefeated[id]) continue;
    const home = wardenHome(sim, id);
    if (home && Math.hypot(home.x - pb.x, home.y - pb.y) <= (def.boss.arenaTiles + 12) * TILE) return id;
  }
  return null;
}

// ------------------------------------------------------------------ heat

/** The Heat a Warden is (or would be) fought at: 1 normally, up to `heat.max` with Sigils. */
export function heatOf(sim: Simulation, boss: Entity): number {
  return sim.ecs.get(boss, Boss)?.heat ?? 1;
}

/** What a Warden's blows are multiplied by at its Heat. */
export function heatDamage(sim: Simulation, boss: Entity): number {
  return 1 + sim.content.loot.wardens.heat.damage * (heatOf(sim, boss) - 1);
}

/** The highest Heat a Warden can be rekindled at: one past the highest cleared, up to the max. */
export function heatOpen(sim: Simulation, boss: string): number {
  return Math.min(sim.content.loot.wardens.heat.max, (sim.state.heatCleared?.[boss] ?? 1) + 1);
}

/** Called as a rekindled Warden spawns: its Heat, and the health that comes with it. */
export function kindleHeat(sim: Simulation, e: Entity, archetype: string): void {
  const heat = sim.state.rekindled?.[archetype];
  const boss = sim.ecs.get(e, Boss);
  if (heat === undefined || !boss) return;
  boss.heat = heat;
  const health = sim.ecs.need(e, Health);
  health.max = Math.round(health.max * (1 + sim.content.loot.wardens.heat.hp * (heat - 1)));
  health.hp = health.max;
}

export function canRekindle(sim: Simulation, boss: string, heat: number): Check {
  if (wardenHere(sim) !== boss) return fail('rest at the Warden’s bonfire');
  if (sim.state.rekindled?.[boss] !== undefined) return fail('already rekindled');
  if (heat < 1 || heat > heatOpen(sim, boss)) return fail(`clear Heat ${heat - 1} first`);
  const sigils = heat - 1;
  const { sigil } = sim.content.loot.wardens;
  if (countItem(sim.ecs.need(sim.player, Inventory), sigil) < sigils)
    return fail(`needs ${sigils} ${sim.content.item(sigil).name}`);
  return { ok: true };
}

/** Brings a defeated Warden back for a refight at a Heat (spending a Sigil per step above 1). */
export function rekindle(sim: Simulation, boss: string, heat: number): boolean {
  const check = canRekindle(sim, boss, heat);
  if (!check.ok) {
    sim.events.emit({ type: 'craftFailed', recipe: 'rekindle', reason: check.reason });
    return false;
  }
  removeItem(sim.ecs.need(sim.player, Inventory), sim.content.loot.wardens.sigil, heat - 1);
  sim.state.rekindled = { ...sim.state.rekindled, [boss]: heat };
  // The arena fills again: its Warden rises (and the wild comes back, as after any rest).
  resetEnemies(sim);
  sim.events.emit({ type: 'rekindled', boss, heat });
  return true;
}

// ------------------------------------------------------------------ chests

/** The chance the next chest holds the signature: rising with every miss, sure by the last, more with Heat. */
export function signatureChance(sim: Simulation, boss: string, heat = 1): number {
  const { signature, heat: h } = sim.content.loot.wardens;
  const misses = sim.state.signaturePity?.[boss] ?? 0;
  if (misses + 1 >= signature.sureBy) return 1;
  return Math.min(1, signature.chance + signature.step * misses + h.signature * (heat - 1));
}

/** The chest's tier odds at a Heat: weight moves from Rare up to Noble and Legendary with each step. */
function chestTiers(sim: Simulation, heat: number): [TierId, number][] {
  const { tiers, heat: h } = sim.content.loot.wardens;
  const shift = h.shift * (heat - 1);
  return tiers.map(([tier, w]): [TierId, number] => {
    if (tier === 'rare') return [tier, Math.max(1, w - shift)];
    if (tier === 'noble') return [tier, w + (shift * 2) / 3];
    if (tier === 'legendary') return [tier, w + shift / 3];
    return [tier, w];
  });
}

/**
 * The Warden's chest, spilled where it fell: pieces at the player's band (a Noble or better first on the first
 * kill), materials, Marks, and the signature roll (or its alternate, if the Warden was baited onto its braziers).
 */
export function openChest(sim: Simulation, e: Entity, archetype: string, firstKill: boolean): void {
  const def = sim.content.enemy(archetype);
  const warden = def.boss?.warden;
  const body = sim.ecs.need(e, Body);
  if (!warden) return;
  const loot = sim.content.loot.wardens;
  const heat = heatOf(sim, e);
  const ilvl = Math.max(itemLevelAt(sim, body.x, body.y), gambleItemLevel(sim));
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  const tiers = chestTiers(sim, heat);
  const floor = TIERS.indexOf(loot.firstFloor);
  for (let i = 0; i < loot.items; i++) {
    const pool = firstKill && i === 0 ? tiers.filter(([t]) => TIERS.indexOf(t) >= floor) : tiers;
    const tier = sim.rng.weighted(pool);
    const slot = sim.rng.pick(['weapon', 'helmet', 'chest', 'legs', 'ring'] as const);
    const stack = rollForSlot(sim.content, slot, tier, ilvl, sim.rng.int(1, 0x7fffffff), cls);
    if (stack) dropPickup(sim, 'item', 1, body.x, body.y, stack.item, stack.gear ?? null);
  }
  for (const m of loot.materials) dropPickup(sim, 'item', m.count, body.x, body.y, m.item);
  const marks = loot.marks + (heat >= loot.heat.marksFrom ? heat - loot.heat.marksFrom + 1 : 0);
  if (marks > 0) dropPickup(sim, 'item', marks, body.x, body.y, loot.mark);

  // The signature: pity rises with each miss and resets when it comes.
  const slams = sim.ecs.get(e, Boss)?.brazierSlams ?? 0;
  const won = sim.rng.chance(signatureChance(sim, archetype, heat));
  const pity = { ...sim.state.signaturePity };
  pity[archetype] = won ? 0 : (pity[archetype] ?? 0) + 1;
  sim.state.signaturePity = pity;
  if (won) {
    const item = slams >= warden.alternate.slams ? warden.alternate.item : warden.signature;
    const stack = rollGear(sim.content, item, 'legendary', ilvl, sim.rng.int(1, 0x7fffffff), cls);
    dropPickup(sim, 'item', 1, body.x, body.y, stack.item, stack.gear ?? null);
  }
  sim.events.emit({
    type: 'wardenChest',
    boss: archetype,
    signature: won,
    stirring: !won && signatureChance(sim, archetype) >= 0.3,
    x: body.x,
    y: body.y,
  });
}

/** After a Warden falls: a cleared Heat opens the next, and a refight is used up. */
export function settleRefight(sim: Simulation, archetype: string, heat: number): void {
  if (sim.state.rekindled?.[archetype] === undefined) return;
  sim.state.rekindled = Object.fromEntries(
    Object.entries(sim.state.rekindled).filter(([id]) => id !== archetype),
  );
  sim.state.heatCleared = {
    ...sim.state.heatCleared,
    [archetype]: Math.max(sim.state.heatCleared?.[archetype] ?? 1, heat),
  };
}

/** Whether this Warden kill is a refight (it was rekindled), not the story's first kill. */
export function isRefight(sim: Simulation, archetype: string): boolean {
  return sim.state.rekindled?.[archetype] !== undefined;
}

// ------------------------------------------------------------------ the Mark backstop

export function canBuySignature(sim: Simulation, boss: string): Check {
  const warden = sim.content.enemies[boss]?.boss?.warden;
  if (!warden) return fail('no signature to buy');
  if (wardenHere(sim) !== boss) return fail('rest at the Warden’s bonfire');
  const { mark, markPrice } = sim.content.loot.wardens;
  const inv = sim.ecs.need(sim.player, Inventory);
  if (countItem(inv, mark) < markPrice) return fail(`needs ${markPrice} ${sim.content.item(mark).name}`);
  return { ok: true };
}

/** Trades Marks for a fresh copy of the signature (the token backstop: no chest goes for nothing). */
export function buySignature(sim: Simulation, boss: string): boolean {
  const check = canBuySignature(sim, boss);
  const warden = sim.content.enemies[boss]?.boss?.warden;
  if (!check.ok || !warden) {
    sim.events.emit({ type: 'craftFailed', recipe: 'signature', reason: check.ok ? 'cannot' : check.reason });
    return false;
  }
  const { mark, markPrice } = sim.content.loot.wardens;
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  const stack = rollGear(
    sim.content,
    warden.signature,
    'legendary',
    gambleItemLevel(sim),
    sim.rng.int(1, 0x7fffffff),
    cls,
  );
  if (!addStack(sim, sim.player, stack)) {
    sim.events.emit({ type: 'craftFailed', recipe: 'signature', reason: 'inventory is full' });
    return false;
  }
  removeItem(sim.ecs.need(sim.player, Inventory), mark, markPrice);
  sim.events.emit({ type: 'gambled', item: stack.item, tier: 'legendary' });
  return true;
}

// ------------------------------------------------------------------ the alternate kill

/** A Warden's charge ending on a brazier counts toward its alternate kill. */
export function countBrazierSlam(sim: Simulation, e: Entity): void {
  const boss = sim.ecs.get(e, Boss);
  const enemy = sim.ecs.get(e, Enemy);
  if (!boss || !enemy || !sim.content.enemies[enemy.archetype]?.boss?.warden) return;
  boss.brazierSlams = (boss.brazierSlams ?? 0) + 1;
  const body = sim.ecs.need(e, Body);
  sim.events.emit({ type: 'brazierSlam', x: body.x, y: body.y, count: boss.brazierSlams });
}

function processActions(sim: Simulation): void {
  if (sim.ecs.need(sim.player, Player).state === 'dead') return;
  for (const action of sim.input.actions ?? []) applyAction(sim, action);
}

function applyAction(sim: Simulation, action: PlayerAction): void {
  if (action.type === 'rekindle') rekindle(sim, action.boss, action.heat);
  else if (action.type === 'buySignature') buySignature(sim, action.boss);
}

const commands: SimCommand[] = [
  {
    name: 'rekindle',
    description: 'Rekindle a defeated Warden from anywhere, at a Heat (no Sigils needed).',
    args: [
      {
        name: 'boss',
        type: 'string',
        options: ({ sim }) =>
          Object.keys(sim.content.enemies).filter((id) => sim.content.enemies[id]?.boss?.warden),
      },
      { name: 'heat', type: 'number', integer: true, optional: true },
    ],
    run: ({ sim }, a) => {
      const boss = a.string('boss');
      if (!sim.state.bossesDefeated[boss]) throw new CommandError(`${boss} has not been defeated yet`);
      const heat = Math.max(1, Math.min(sim.content.loot.wardens.heat.max, a.optNumber('heat') ?? 1));
      sim.state.rekindled = { ...sim.state.rekindled, [boss]: heat };
      resetEnemies(sim);
      return `${boss} rekindled at Heat ${heat}`;
    },
  },
];

export const wardensModule: SimModule = {
  id: 'wardens',
  systems: [{ phase: 'control', run: processActions, menu: true }],
  commands,
};
