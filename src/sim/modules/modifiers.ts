/**
 * Class modifiers: passive bonuses worn in a few slots that tie a class's abilities together
 * (kills in your fire cool the next pot, blows taken feed the super). Each class has its own, in
 * content/modifiers.json; most are learned with souls, a Warden's are free once it falls, and every
 * defeated Warden opens another slot. Changes happen while resting at a bonfire.
 *
 * Other modules call the hooks here at their moment (a kill, a blow taken, a cast, an ambush), so
 * this module imports only what the rewards need.
 */
import { CommandError } from '../../core/commands';
import type { AbilitySlot, ModifierEffect } from '../../content/schemas';
import { Abilities, Body, Health, Player, Zone } from '../components';
import { TICK_RATE } from '../constants';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { gainEnergy } from './energy';
import { grantOvershield } from './overshield';

/** How many modifiers the player can wear: the base slots plus those each defeated Warden adds. */
export function modifierSlots(sim: Simulation): number {
  const { base, perWarden } = sim.content.modifiers.slots;
  const wardens = Object.keys(sim.state.bossesDefeated).filter((b) => sim.content.enemies[b]?.boss);
  return base + perWarden * wardens.length;
}

/** The modifiers the player wears for their current class. */
export function wornModifiers(sim: Simulation): readonly string[] {
  const a = sim.ecs.get(sim.player, Abilities);
  return a ? (a.modifiers[a.class] ?? []) : [];
}

/** The modifiers a class can wear, in file order. */
export function modifiersOf(sim: Simulation, cls: string): string[] {
  return Object.entries(sim.content.modifiers.modifiers)
    .filter(([, def]) => def.class === cls)
    .map(([id]) => id);
}

/** Every effect of the modifiers worn, of one kind. */
function effects<T extends ModifierEffect['type']>(
  sim: Simulation,
  type: T,
): Extract<ModifierEffect, { type: T }>[] {
  return wornModifiers(sim)
    .flatMap((id) => sim.content.modifiers.modifiers[id]?.effects ?? [])
    .filter((fx): fx is Extract<ModifierEffect, { type: T }> => fx.type === type);
}

// ------------------------------------------------------------------ hooks

/** A slot's cooldown in ticks, after any modifier that shortens it. */
export function modifiedCooldown(sim: Simulation, slot: 'aoe' | 'class', seconds: number): number {
  const factor = effects(sim, 'cooldown')
    .filter((fx) => fx.slot === slot)
    .reduce((f, fx) => f * fx.factor, 1);
  return Math.round(seconds * factor * TICK_RATE);
}

/** After the player uses the ability in `slot`. */
export function onCast(sim: Simulation, slot: AbilitySlot): void {
  for (const fx of effects(sim, 'castShield'))
    if (fx.slot === slot) grantOvershield(sim, fx.amount, fx.amount, fx.seconds);
}

/** The extra damage a blow out of hiding gets from modifiers, on top of the ability's own. */
export function ambushBonus(sim: Simulation): number {
  return effects(sim, 'ambush').reduce((n, fx) => n + fx.bonus, 0);
}

/** After the player takes `amount` damage (before any overshield soaks it). */
export function onHurt(sim: Simulation, amount: number): void {
  for (const fx of effects(sim, 'hurt')) gainEnergy(sim, amount * fx.energy);
}

/** After the player kills an enemy standing at `body`. */
export function onKill(sim: Simulation, body: Body): void {
  const kills = effects(sim, 'kill');
  if (kills.length === 0) return;
  const inZone = [...sim.ecs.query(Zone, Body)].some(
    ([, z, zb]) => Math.hypot(body.x - zb.x, body.y - zb.y) <= z.radius + Math.max(body.w, body.h) / 2,
  );
  const a = sim.ecs.need(sim.player, Abilities);
  for (const fx of kills) {
    if (fx.where === 'zone' && !inZone) continue;
    if (fx.cooldown) {
      // Never to 0 here: the abilities module announces a slot coming ready as it counts down.
      const left = a.cooldowns[fx.cooldown.slot];
      if (left > 0)
        a.cooldowns[fx.cooldown.slot] = Math.max(1, left - Math.round(fx.cooldown.seconds * TICK_RATE));
    }
    if (fx.energy > 0) gainEnergy(sim, fx.energy);
    const health = sim.ecs.get(sim.player, Health);
    if (fx.heal > 0 && health && health.hp > 0 && health.hp < health.max) {
      const amount = Math.min(fx.heal, health.max - health.hp);
      health.hp += amount;
      sim.events.emit({ type: 'healed', amount });
    }
  }
}

// ------------------------------------------------------------------ wearing

export type ModifierCheck = { ok: true; cost: number } | { ok: false; reason: string };

/**
 * Whether the player can put on (`on`) or take off a modifier now, and what it costs: nothing once
 * learned, else its souls. A Warden's modifier is free but needs that Warden defeated.
 */
export function canWear(sim: Simulation, id: string, on: boolean): ModifierCheck {
  const a = sim.ecs.need(sim.player, Abilities);
  const p = sim.ecs.need(sim.player, Player);
  const def = sim.content.modifiers.modifiers[id];
  if (!def || def.class !== a.class) return { ok: false, reason: 'not one of your class' };
  if (p.state !== 'sit') return { ok: false, reason: 'rest at a bonfire to change' };
  const worn = wornModifiers(sim).includes(id);
  if (!on) return worn ? { ok: true, cost: 0 } : { ok: false, reason: 'not worn' };
  if (worn) return { ok: false, reason: 'already worn' };
  if (def.boss !== undefined && !sim.state.bossesDefeated[def.boss])
    return { ok: false, reason: `defeat the ${sim.content.enemy(def.boss).name}` };
  if (wornModifiers(sim).length >= modifierSlots(sim)) return { ok: false, reason: 'no free slot' };
  const cost = a.learned[id] ? 0 : (def.souls ?? 0);
  if (p.souls < cost) return { ok: false, reason: `needs ${cost} souls` };
  return { ok: true, cost };
}

/** Learns (if needed) and puts on, or takes off, a modifier. No checks: callers check first. */
function wear(sim: Simulation, id: string, on: boolean, cost: number): void {
  const a = sim.ecs.need(sim.player, Abilities);
  const worn = a.modifiers[a.class] ?? [];
  if (on) {
    if (!a.learned[id]) {
      sim.ecs.need(sim.player, Player).souls -= cost;
      a.learned[id] = true;
      sim.events.emit({ type: 'modifierLearned', modifier: id });
    }
    a.modifiers[a.class] = [...worn, id];
  } else a.modifiers[a.class] = worn.filter((m) => m !== id);
  sim.events.emit({ type: 'modifierWorn', modifier: id, on });
}

function processActions(sim: Simulation): void {
  for (const action of sim.input.actions ?? []) {
    if (action.type !== 'wearModifier') continue;
    const check = canWear(sim, action.modifier, action.on);
    if (check.ok) wear(sim, action.modifier, action.on, check.cost);
  }
}

const commands: SimCommand[] = [
  {
    name: 'modifier',
    description: 'Put on or take off a class modifier (free, anywhere, ignoring slots).',
    args: [
      {
        name: 'id',
        type: 'string',
        options: ({ sim }) => Object.keys(sim.content.modifiers.modifiers),
      },
    ],
    run: ({ sim }, args) => {
      const id = args.string('id');
      const def = sim.content.modifiers.modifiers[id];
      const a = sim.ecs.need(sim.player, Abilities);
      if (!def) throw new CommandError(`unknown modifier "${id}"`);
      if (def.class !== a.class) throw new CommandError(`"${id}" is a ${def.class} modifier`);
      const on = !wornModifiers(sim).includes(id);
      wear(sim, id, on, 0);
      return `${def.name} ${on ? 'on' : 'off'}`;
    },
  },
];

export const modifiersModule: SimModule = {
  id: 'modifiers',
  systems: [{ phase: 'control', run: processActions }],
  commands,
};
