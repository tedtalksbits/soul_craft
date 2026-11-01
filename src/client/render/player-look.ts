/**
 * What the player's gear looks like on them (docs/gear-and-loot.md, section 10). The body sheet follows the
 * chest's weight; layers on the same frame layout stack on it: the legs' color, the chest's trim, the helmet (its
 * shape from its weight) and its trim, and the weapon of the wielded type. Trims and legs are drawn in grays and
 * tinted with the piece's tier color, so five tiers cost no extra art. Pure presentation.
 */
import type { ItemStack } from '../../sim/components';
import { Equipment } from '../../sim/components';
import { gearOf } from '../../sim/modules/gear';
import type { Simulation } from '../../sim/simulation';

export interface Layer {
  sheet: string;
  tint: number;
}

export interface PlayerLook {
  body: string;
  layers: Layer[];
  /** A Legendary ring shows as a faint ember shimmer at the hand. */
  shimmer: boolean;
}

const BODY = { cloth: 'player', leather: 'player_leather', plate: 'player_plate' } as const;
const HELM = { cloth: 'hood', leather: 'cap', plate: 'helm' } as const;
/** Trim on bare cloth (no chest worn): undyed. */
const PLAIN = 0x9a8c74;
/** Legs are a muted version of their tier's color, so trousers never shout. */
const LEGS_BASE = 0x46484e;

const tierColor = (sim: Simulation, stack: ItemStack): number =>
  Number.parseInt(sim.content.loot.tiers[gearOf(stack).tier].color.slice(1), 16);

function mix(a: number, b: number, t: number): number {
  const ch = (shift: number) =>
    Math.round(((a >> shift) & 255) * (1 - t) + ((b >> shift) & 255) * t) << shift;
  return ch(16) | ch(8) | ch(0);
}

function armorWeight(sim: Simulation, stack: ItemStack | null): 'cloth' | 'leather' | 'plate' | null {
  if (!stack) return null;
  const def = sim.content.items[stack.item];
  return def?.kind === 'armor' ? def.armor.weight : null;
}

export function playerLook(sim: Simulation, showHelmet: boolean): PlayerLook {
  const eq = sim.ecs.get(sim.player, Equipment);
  const chest = armorWeight(sim, eq?.chest ?? null);
  const layers: Layer[] = [];
  if (eq?.legs) layers.push({ sheet: 'player_legs', tint: mix(tierColor(sim, eq.legs), LEGS_BASE, 0.55) });
  layers.push({
    sheet: `player_trim_${chest ?? 'cloth'}`,
    tint: eq?.chest ? tierColor(sim, eq.chest) : PLAIN,
  });
  const helm = armorWeight(sim, eq?.helmet ?? null);
  if (helm && eq?.helmet && showHelmet) {
    layers.push({ sheet: `player_${HELM[helm]}`, tint: 0xffffff });
    layers.push({ sheet: `player_${HELM[helm]}_trim`, tint: tierColor(sim, eq.helmet) });
  }
  const weapon = eq?.weapon ? sim.content.items[eq.weapon.item] : undefined;
  if (weapon?.kind === 'weapon') layers.push({ sheet: `player_${weapon.weapon.type}`, tint: 0xffffff });
  const shimmer = [eq?.ring0, eq?.ring1].some((r) => r?.gear?.tier === 'legendary');
  return { body: BODY[chest ?? 'cloth'], layers, shimmer };
}
