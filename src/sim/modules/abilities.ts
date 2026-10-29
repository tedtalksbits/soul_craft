/**
 * Classes and their three abilities (AoE on F, class ability on C, super on V).
 * Every ability is data: a cast (lock time and release tick) plus a list of
 * effects from content/abilities.json. This module turns those effects into
 * blasts, burning zones, dashes and super modes, and owns cooldowns and super
 * energy. Costs are paid at the release tick, so a cast interrupted by a hit
 * costs nothing.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import { DIR_VEC, dirFromVec, normalize, overlaps } from '../../core/math';
import { ABILITY_SLOTS, type AbilityEffect, type AbilitySlot } from '../../content/schemas';
import {
  Abilities,
  Blast,
  Body,
  Dying,
  Empowered,
  Enemy,
  Facing,
  Health,
  Invulnerable,
  Motion,
  Player,
  Staggered,
  Zone,
  type AbilityHit,
} from '../components';
import { TICK_RATE } from '../constants';
import { Action, type PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import { bodyBox } from '../physics';
import type { Simulation } from '../simulation';
import { applyDamage, rollDamage } from './combat';
import { FULL_ENERGY, gainEnergy } from './energy';

/** Which input action fires which slot. */
export const SLOT_ACTION: Readonly<Record<AbilitySlot, number>> = {
  aoe: Action.aoe,
  class: Action.classAbility,
  super: Action.super,
};

/** Hitstop when an ability blast connects: a beat shorter than a sword hit's feels right for AoE. */
const BLAST_HITSTOP = 2;

/** Gives a freshly spawned player their starting class, all abilities ready and an empty super. */
export function giveStartingClass(sim: Simulation, e: Entity): void {
  sim.ecs.add(e, Abilities, {
    class: sim.content.player.start.class,
    cooldowns: { aoe: 0, class: 0 },
    energy: 0,
    casting: null,
  });
}

/** The ability id the player's class has in a slot. */
export function abilityIn(sim: Simulation, slot: AbilitySlot): string {
  const a = sim.ecs.need(sim.player, Abilities);
  return sim.content.playerClass(a.class).abilities[slot];
}

/** Whether a slot can fire now: off cooldown, or for the super, a full bar. */
export function slotReady(a: Abilities, slot: AbilitySlot): boolean {
  return slot === 'super' ? a.energy >= FULL_ENERGY : a.cooldowns[slot] <= 0;
}

/** The first ability key pressed this tick, in slot order, or null. */
export function pressedSlot(pressed: number): AbilitySlot | null {
  return ABILITY_SLOTS.find((s) => (pressed & SLOT_ACTION[s]) !== 0) ?? null;
}

/**
 * Starts casting the ability in a slot, from the player's `free` state. The aim is fixed
 * now: the cursor if the click/key carried one, else the way the player faces.
 */
export function startCast(sim: Simulation, slot: AbilitySlot): boolean {
  const { ecs } = sim;
  const e = sim.player;
  const a = ecs.need(e, Abilities);
  if (!slotReady(a, slot)) {
    sim.events.emit({ type: 'abilityNotReady', slot });
    return false;
  }
  const p = ecs.need(e, Player);
  const body = ecs.need(e, Body);
  const facing = ecs.need(e, Facing);
  const aim = sim.input.aim;
  const [dx, dy] =
    aim && (aim.x !== body.x || aim.y !== body.y)
      ? normalize(aim.x - body.x, aim.y - body.y)
      : DIR_VEC[facing.dir];
  p.dirX = dx;
  p.dirY = dy;
  facing.dir = dirFromVec(dx, dy, facing.dir);
  p.struck = [];
  p.state = 'cast';
  p.t = 0;
  a.casting = {
    ability: abilityIn(sim, slot),
    slot,
    aimX: aim?.x ?? body.x + dx * 1000,
    aimY: aim?.y ?? body.y + dy * 1000,
  };
  return true;
}

/** The player's `cast` state, one tick. Called from the player state machine. */
export function updateCast(sim: Simulation): void {
  const { ecs } = sim;
  const e = sim.player;
  const p = ecs.need(e, Player);
  const a = ecs.need(e, Abilities);
  const motion = ecs.need(e, Motion);
  const casting = a.casting;
  if (!casting) {
    p.state = 'free';
    p.t = 0;
    return;
  }
  const def = sim.content.ability(casting.ability);
  motion.vx = motion.vy = 0;
  if (p.t === def.cast.release) release(sim, e, a, casting.slot, casting.ability);

  // A dash carries the player from the release tick for its own duration.
  const dash = def.effects.find((fx) => fx.type === 'dash');
  if (dash && p.t >= def.cast.release && p.t < def.cast.release + dash.ticks) {
    const speed = dash.distance / dash.ticks;
    motion.vx = p.dirX * speed;
    motion.vy = p.dirY * speed;
    if (dash.damage > 0 || dash.stagger > 0) dashHits(sim, e, p, casting.ability, dash);
  }
  if (p.t >= def.cast.ticks) {
    a.casting = null;
    p.state = 'free';
    p.t = 0;
  }
}

/** The release tick: pay the cost, then apply every effect in order. */
function release(sim: Simulation, e: Entity, a: Abilities, slot: AbilitySlot, ability: string): void {
  const def = sim.content.ability(ability);
  const body = sim.ecs.need(e, Body);
  if (slot === 'super') a.energy = 0;
  else a.cooldowns[slot] = Math.round(def.cooldown * TICK_RATE);
  const charges = slot !== 'super';
  const casting = a.casting;
  const aim = casting ? { x: casting.aimX, y: casting.aimY } : { x: body.x, y: body.y };
  let tx = body.x;
  let ty = body.y;
  for (const fx of def.effects) {
    const hit = { ability, charges };
    switch (fx.type) {
      case 'blast': {
        [tx, ty] = targetOf(body, aim, fx.at, fx.range);
        const blast = { ...hit, damage: fx.damage, knockback: fx.knockback, stagger: fx.stagger };
        if (fx.fuse > 0) spawnBlast(sim, tx, ty, { ...blast, radius: fx.radius, fuse: fx.fuse });
        else detonate(sim, tx, ty, fx.radius, blast);
        break;
      }
      case 'zone': {
        [tx, ty] = targetOf(body, aim, fx.at, fx.range);
        const z = sim.ecs.create();
        sim.ecs.add(z, Body, { x: tx, y: ty, w: fx.radius * 2, h: fx.radius * 2 });
        sim.ecs.add(z, Zone, {
          ...hit,
          damage: fx.damage,
          knockback: 0,
          stagger: 0,
          radius: fx.radius,
          t: 0,
          delay: fx.delay,
          duration: fx.duration,
          interval: fx.interval,
        });
        break;
      }
      case 'dash':
        if (fx.iframes) {
          const inv = sim.ecs.get(e, Invulnerable);
          if (!inv) sim.ecs.add(e, Invulnerable, { ticks: fx.ticks + 2 });
          else inv.ticks = Math.max(inv.ticks, fx.ticks + 2);
        }
        tx = body.x + sim.ecs.need(e, Player).dirX * fx.distance;
        ty = body.y + sim.ecs.need(e, Player).dirY * fx.distance;
        break;
      case 'empower':
        sim.ecs.add(e, Empowered, {
          ability,
          ticks: Math.round(fx.seconds * TICK_RATE),
          damage: fx.damage,
          defense: fx.defense,
          crit: fx.crit,
          staminaFree: fx.staminaFree,
        });
        sim.events.emit({ type: 'empowered', ability, seconds: fx.seconds });
        break;
    }
  }
  sim.events.emit({ type: 'abilityUsed', ability, slot, x: body.x, y: body.y, tx, ty });
}

/** Where an effect lands: on the caster, or toward the aim point but no further than `range`. */
function targetOf(
  body: Body,
  aim: { x: number; y: number },
  at: 'self' | 'aim',
  range: number,
): [number, number] {
  if (at === 'self') return [body.x, body.y];
  const dx = aim.x - body.x;
  const dy = aim.y - body.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= range) return [aim.x, aim.y];
  return [body.x + (dx / dist) * range, body.y + (dy / dist) * range];
}

function spawnBlast(sim: Simulation, x: number, y: number, blast: Blast): void {
  const e = sim.ecs.create();
  sim.ecs.add(e, Body, { x, y, w: 4, h: 4 });
  sim.ecs.add(e, Blast, blast);
}

/** Hits every enemy whose body reaches into the circle. */
function detonate(sim: Simulation, x: number, y: number, radius: number, hit: AbilityHit): void {
  let any = false;
  for (const [target, , body] of sim.ecs.query(Enemy, Body, Health)) {
    if (sim.ecs.has(target, Dying)) continue;
    const reach = radius + Math.max(body.w, body.h) / 2;
    if (Math.hypot(body.x - x, body.y - y) > reach) continue;
    if (abilityDamage(sim, target, x, y, hit) === 'hit') any = true;
  }
  if (any) sim.hitstop = Math.max(sim.hitstop, BLAST_HITSTOP);
  sim.events.emit({ type: 'blast', ability: hit.ability, x, y, radius });
}

function dashHits(
  sim: Simulation,
  e: Entity,
  p: Player,
  ability: string,
  dash: Extract<AbilityEffect, { type: 'dash' }>,
): void {
  const body = sim.ecs.need(e, Body);
  const box = bodyBox({ ...body, w: Math.max(body.w, dash.width), h: Math.max(body.h, dash.width) });
  for (const [target, , tb] of sim.ecs.query(Enemy, Body, Health)) {
    if (p.struck.includes(target) || sim.ecs.has(target, Dying) || !overlaps(box, bodyBox(tb))) continue;
    p.struck.push(target);
    const hit = {
      ability,
      damage: dash.damage,
      knockback: dash.knockback,
      stagger: dash.stagger,
      charges: true,
    };
    abilityDamage(sim, target, body.x - p.dirX * 4, body.y - p.dirY * 4, hit);
  }
}

/** Ability damage: rolls like the sword (no crits), ignores shields, then staggers. */
function abilityDamage(sim: Simulation, target: Entity, fromX: number, fromY: number, hit: AbilityHit) {
  const attack = sim.content.player.attack;
  const roll =
    hit.damage > 0
      ? rollDamage(sim.rng, {
          damage: hit.damage,
          variance: attack.variance,
          critChance: 0,
          critMultiplier: 1,
        })
      : { amount: 0, crit: false };
  const result = applyDamage(sim, target, {
    ...roll,
    fromX,
    fromY,
    knockback: hit.knockback,
    unblockable: true,
    charges: hit.charges,
  });
  if (result === 'hit' && hit.stagger > 0) stagger(sim, target, hit.stagger);
  return result;
}

/** Staggers an enemy, never shortening a stagger already running. */
export function stagger(sim: Simulation, e: Entity, ticks: number): void {
  if (!sim.ecs.isAlive(e) || sim.ecs.has(e, Dying)) return;
  const s = sim.ecs.get(e, Staggered);
  if (s) s.ticks = Math.max(s.ticks, ticks);
  else sim.ecs.add(e, Staggered, { ticks });
}

// ------------------------------------------------------------------ systems

/** Cooldowns, passive super energy and the super's timed mode. */
function tickAbilities(sim: Simulation): void {
  const { ecs } = sim;
  const e = sim.player;
  const a = ecs.get(e, Abilities);
  if (!a) return;
  for (const slot of ['aoe', 'class'] as const) {
    if (a.cooldowns[slot] > 0 && --a.cooldowns[slot] === 0) sim.events.emit({ type: 'abilityReady', slot });
  }
  if (ecs.need(e, Player).state !== 'dead') gainEnergy(sim, sim.content.player.energy.perSecond / TICK_RATE);
  // A cast that was interrupted (hurt, death) never reached `updateCast`'s end.
  if (a.casting && ecs.need(e, Player).state !== 'cast') a.casting = null;

  const emp = ecs.get(e, Empowered);
  if (emp && --emp.ticks <= 0) {
    ecs.remove(e, Empowered);
    sim.events.emit({ type: 'empowerEnded', ability: emp.ability });
  }
}

/** Fuses burning down, and burning ground. */
function tickAreas(sim: Simulation): void {
  const { ecs } = sim;
  for (const [e, blast, body] of ecs.query(Blast, Body)) {
    if (--blast.fuse > 0) continue;
    detonate(sim, body.x, body.y, blast.radius, blast);
    ecs.destroy(e);
  }
  for (const [e, zone, body] of ecs.query(Zone, Body)) {
    zone.t++;
    const since = zone.t - zone.delay;
    if (since >= 0 && since % zone.interval === 0) {
      for (const [target, , tb] of ecs.query(Enemy, Body, Health)) {
        if (ecs.has(target, Dying)) continue;
        if (Math.hypot(tb.x - body.x, tb.y - body.y) <= zone.radius + Math.max(tb.w, tb.h) / 2)
          abilityDamage(sim, target, body.x, body.y, zone);
      }
    }
    if (since >= zone.duration) ecs.destroy(e);
  }
}

/** Class changes, from the bonfire menu. */
function processActions(sim: Simulation): void {
  for (const action of sim.input.actions ?? []) if (action.type === 'setClass') setClass(sim, action);
}

function setClass(
  sim: Simulation,
  action: Extract<PlayerAction, { type: 'setClass' }>,
  anywhere = false,
): boolean {
  const p = sim.ecs.need(sim.player, Player);
  const a = sim.ecs.need(sim.player, Abilities);
  if (!(action.class in sim.content.classes) || (!anywhere && p.state !== 'sit')) return false;
  if (a.class === action.class) return true;
  a.class = action.class;
  a.cooldowns = { aoe: 0, class: 0 };
  sim.events.emit({ type: 'classChanged', class: action.class });
  return true;
}

/**
 * Resting or respawning readies the AoE and class abilities and ends any super mode
 * and burning ground. Super energy is earned, so it is kept.
 */
export function refreshAbilities(sim: Simulation): void {
  const { ecs } = sim;
  const a = ecs.get(sim.player, Abilities);
  if (a) {
    a.cooldowns = { aoe: 0, class: 0 };
    a.casting = null;
  }
  ecs.remove(sim.player, Empowered);
  for (const [e] of ecs.query(Blast)) ecs.destroy(e);
  for (const [e] of ecs.query(Zone)) ecs.destroy(e);
}

// ------------------------------------------------------------------ dev commands

const commands: SimCommand[] = [
  {
    name: 'class',
    description: 'Show or change the player class (anywhere, not just at a bonfire).',
    args: [
      { name: 'id', type: 'string', optional: true, options: ({ sim }) => Object.keys(sim.content.classes) },
    ],
    run: ({ sim }, args) => {
      const id = args.optString('id');
      const a = sim.ecs.need(sim.player, Abilities);
      if (id === undefined) {
        const cls = sim.content.playerClass(a.class);
        return `${cls.name}: ${ABILITY_SLOTS.map((s) => sim.content.ability(cls.abilities[s]).name).join(', ')}`;
      }
      if (!setClass(sim, { type: 'setClass', class: id }, true))
        throw new CommandError(`unknown class "${id}"`);
      return `class: ${sim.content.playerClass(id).name}`;
    },
  },
  {
    name: 'charge',
    description: 'Ready every ability, super included.',
    run: ({ sim }) => {
      const a = sim.ecs.need(sim.player, Abilities);
      a.cooldowns = { aoe: 0, class: 0 };
      gainEnergy(sim, FULL_ENERGY);
      return 'abilities ready';
    },
  },
];

export const abilitiesModule: SimModule = {
  id: 'abilities',
  systems: [
    { phase: 'control', run: processActions },
    { phase: 'cleanup', run: tickAbilities },
    { phase: 'combat', run: tickAreas },
  ],
  commands,
};
