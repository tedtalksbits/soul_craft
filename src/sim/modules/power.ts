/**
 * Power (docs/power-and-stash.md, section 2): a level on every piece of gear, from 10 to 1000. The player's Power is
 * the average of what they wear; enemies take theirs from how far they stand from the village (in rings) or, for a
 * boss, from its own. In a fight only the gap matters: the weapon's Power against the foe's sets the blows dealt,
 * the armor's sets the blows taken (`player.json → power.gap`). Item numbers never scale with Power.
 *
 * Drops come in a little above Max Power, the average of the best piece per slot the player owns (worn,
 * carried or stashed), so wearing junk never farms better loot and a better piece always lifts the next drop.
 */
import { CommandError } from '../../core/commands';
import { gearSlotOf, type Content } from '../../content/content';
import { Body, Equipment, Inventory, type Enemy, type EquipSlot, type ItemStack } from '../components';
import { TILE } from '../constants';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';

/** The six slots Power averages over. */
const SLOTS: readonly EquipSlot[] = ['weapon', 'helmet', 'chest', 'legs', 'ring0', 'ring1'];
const ARMOR: readonly EquipSlot[] = ['helmet', 'chest', 'legs'];

/** A piece's Power; an empty slot counts as 0, so wearing something always beats wearing nothing. */
export function gearPower(stack: ItemStack | null | undefined): number {
  return stack?.gear?.power ?? 0;
}

const average = (powers: readonly number[]) =>
  powers.length ? Math.floor(powers.reduce((a, b) => a + b, 0) / powers.length) : 0;

/** The player's Power: the average of the six pieces worn. */
export function characterPower(eq: Equipment | undefined): number {
  return average(SLOTS.map((s) => gearPower(eq?.[s])));
}

/** The Power the player's blows are checked at: the weapon's. */
export function weaponPower(eq: Equipment | undefined): number {
  return gearPower(eq?.weapon);
}

/** The Power the player is hit at: the average of helmet, chest and legs. */
export function armorPower(eq: Equipment | undefined): number {
  return average(ARMOR.map((s) => gearPower(eq?.[s])));
}

export function playerPower(sim: Simulation): number {
  return characterPower(sim.ecs.get(sim.player, Equipment));
}

/**
 * Max Power: the average of the best piece the player owns for each slot, worn, carried or stashed (the two best rings
 * for the two ring slots). Drops are based on it.
 */
/** The Power of the best piece owned for a slot ('ring': the best ring), worn, carried or stashed. */
export function bestOwnedPower(sim: Simulation, slot: string): number {
  return ownedPowers(sim)[slot]?.[0] ?? 0;
}

/** Every owned piece's Power by slot, highest first. */
function ownedPowers(sim: Simulation): Record<string, number[]> {
  const eq = sim.ecs.get(sim.player, Equipment);
  const owned = [
    ...SLOTS.map((s) => eq?.[s] ?? null),
    ...(sim.ecs.get(sim.player, Inventory)?.stacks ?? []),
    ...(sim.state.stash ?? []),
  ];
  const best: Record<string, number[]> = {};
  for (const stack of owned) {
    if (!stack?.gear) continue;
    const slot = gearSlotOf(sim.content.item(stack.item));
    if (slot) (best[slot] ??= []).push(stack.gear.power);
  }
  for (const list of Object.values(best)) list.sort((a, b) => b - a);
  return best;
}

export function maxPower(sim: Simulation): number {
  const best = ownedPowers(sim);
  const top = (slot: string) => best[slot]?.[0] ?? 0;
  const rings = best['ring'] ?? [];
  return average([top('weapon'), top('helmet'), top('chest'), top('legs'), rings[0] ?? 0, rings[1] ?? 0]);
}

// ------------------------------------------------------------------ rings

/** Which ring of `world.rings` a point (world pixels) lies in, by its distance in tiles from the village. */
function ringAt(content: Content, x: number, y: number): number {
  const d = Math.hypot(x, y) / TILE;
  const rings = content.world.rings;
  let i = 0;
  while (i + 1 < rings.length && d >= rings[i + 1]!.from) i++;
  return i;
}

/** Enemy Power at a point: rising smoothly from each ring's Power at its inner edge to the next one's. */
export function enemyPowerAt(content: Content, x: number, y: number): number {
  const rings = content.world.rings;
  const i = ringAt(content, x, y);
  const ring = rings[i]!;
  const next = rings[i + 1];
  if (!next) return ring.power;
  const t = (Math.hypot(x, y) / TILE - ring.from) / (next.from - ring.from);
  return Math.round(ring.power + (next.power - ring.power) * t);
}

/** The highest Power a wild drop can have at a point: its ring's cap. */
export function dropCapAt(content: Content, x: number, y: number): number {
  return content.world.rings[ringAt(content, x, y)]!.cap;
}

// ------------------------------------------------------------------ the gap

/** The multiplier on damage dealt (`dealt`) or taken (`taken`) at a Power gap of `gap` (yours minus theirs). */
export function gapMultiplier(content: Content, gap: number, side: 'dealt' | 'taken'): number {
  const rows = content.player.power.gap;
  const col = side === 'dealt' ? 1 : 2;
  const first = rows[0]!;
  if (gap <= first[0]) return first[col];
  for (let i = 1; i < rows.length; i++) {
    const [a, b] = [rows[i - 1]!, rows[i]!];
    if (gap <= b[0]) return a[col] + ((b[col] - a[col]) * (gap - a[0])) / (b[0] - a[0]);
  }
  return rows[rows.length - 1]![col];
}

/** A blow from the player on a foe: scaled by the weapon's Power against the foe's. */
export function scaleDealt(sim: Simulation, amount: number, foePower: number): number {
  const gap = weaponPower(sim.ecs.get(sim.player, Equipment)) - foePower;
  return amount * gapMultiplier(sim.content, gap, 'dealt');
}

/** A blow from a foe of `foePower` on the player: scaled by the armor's Power against it. */
export function scaleTaken(sim: Simulation, amount: number, foePower: number): number {
  const gap = armorPower(sim.ecs.get(sim.player, Equipment)) - foePower;
  return amount * gapMultiplier(sim.content, gap, 'taken');
}

// ------------------------------------------------------------------ drops

export type DropSource = 'wild' | 'elite' | 'boss' | 'warden' | 'gambler';

/**
 * The Power a new piece comes in at: Max Power plus its source's offset roll, never below `floor` (the foe's own
 * Power, so a harder place catches the player up at once) and never above `cap`.
 */
export function dropPower(sim: Simulation, source: DropSource, floor: number, cap: number): number {
  const { offsets, max, start } = sim.content.loot.power;
  const [lo, hi] = offsets[source];
  const rolled = maxPower(sim) + sim.rng.int(lo, hi);
  const top = Math.min(max, Math.max(cap, floor));
  return Math.max(start, Math.min(top, Math.max(floor, rolled)));
}

/** Where wild loot from a foe lands in Power: at least its own Power, at most its ring's cap. */
export function foeDropPower(sim: Simulation, source: DropSource, foe: Enemy, x: number, y: number): number {
  return dropPower(sim, source, foe.power, dropCapAt(sim.content, x, y));
}

const commands: SimCommand[] = [
  {
    name: 'power',
    description: 'Print Power: worn, max, weapon, armor, and enemy Power and drop cap here.',
    run: ({ sim }) => {
      const eq = sim.ecs.get(sim.player, Equipment);
      const b = sim.ecs.need(sim.player, Body);
      return [
        `power ${characterPower(eq)}  max ${maxPower(sim)}  weapon ${weaponPower(eq)}  armor ${armorPower(eq)}`,
        `here: enemies ${enemyPowerAt(sim.content, b.x, b.y)}  drop cap ${dropCapAt(sim.content, b.x, b.y)}`,
      ].join('\n');
    },
  },
  {
    name: 'setpower',
    description: 'Set the Power of every piece worn (for playtesting a ring).',
    args: [{ name: 'power', type: 'number', integer: true }],
    run: ({ sim }, a) => {
      const power = a.number('power');
      const { max } = sim.content.loot.power;
      if (power < 1 || power > max) throw new CommandError(`power must be 1-${max}`);
      const eq = sim.ecs.need(sim.player, Equipment);
      for (const s of SLOTS) {
        const stack = eq[s];
        if (stack) stack.gear = { ...(stack.gear ?? { tier: 'common', seed: 0, perks: [] }), power };
      }
      return `worn gear set to Power ${power}`;
    },
  },
];

export const powerModule: SimModule = { id: 'power', commands };
