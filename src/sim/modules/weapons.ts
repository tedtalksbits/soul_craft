/**
 * Weapon types (docs/gear-and-loot.md, section 5): every type follows the same input rules, so learning
 * one teaches the rest. Tap for the light chain (its last hit is the finisher), hold for a charged
 * attack with a payoff at full charge, and attack out of a roll for a dash-strike. Each type adds one
 * signature rule: the sword's Flow, the spear's Tipper, the hammer's Break, the daggers' Flank and Bleed,
 * the bow's Pin and Perfect Shot, the staff's Embers. A bow's or staff's charged move fires a shot instead of
 * swinging; drawing a bow burns stamina, and a staff's fireballs spend the Embers its melee hits store.
 *
 * The moves are data (`content/weapons.json`) multiplying the equipped weapon's own numbers. The player
 * controller owns the states; this module decides which move comes next, what it hits and how hard.
 */
import type { MoveDef, WeaponTypeDef, WeaponTypeId } from '../../content/schemas';
import type { Box } from '../../core/math';
import { DIR_VEC, normalize, overlaps } from '../../core/math';
import type { Entity } from '../../core/ecs';
import {
  Abilities,
  Ai,
  Ambush,
  Bleed,
  Boss,
  Burning,
  Coating,
  Motion,
  Pinned,
  Projectile,
  Body,
  Decoy,
  Dying,
  Facing,
  Invulnerable,
  Enemy,
  Equipment,
  Health,
  Marked,
  Player,
  Stamina,
  Staggered,
  Swing,
} from '../components';
import { TICK_RATE } from '../constants';
import { Action } from '../input';
import type { SimModule } from '../module';
import { bodyBox } from '../physics';
import type { Simulation } from '../simulation';
import { stagger } from './abilities';
import { TELEGRAPH_STATES } from './brains';
import { applyDamage, rollDamage } from './combat';
import { gainEnergy } from './energy';
import { gearEffects, gearTotals } from './gear';
import { playerStats } from './items';
import { onWeaponHit } from './perks';
import { spawnProjectile } from './projectiles';

/** The equipped weapon's type and its moves. Bare hands fight like a sword. */
export function weaponType(sim: Simulation): { id: WeaponTypeId; def: WeaponTypeDef } {
  const stack = sim.ecs.get(sim.player, Equipment)?.weapon;
  const item = stack ? sim.content.items[stack.item] : undefined;
  const id = item?.kind === 'weapon' ? item.weapon.type : 'sword';
  return { id, def: sim.content.weapons.types[id] };
}

export function swingOf(sim: Simulation): Swing {
  return (
    sim.ecs.get(sim.player, Swing) ??
    sim.ecs.add(sim.player, Swing, {
      move: 'chain',
      step: 0,
      charge: 0,
      comboTicks: 0,
      nextStep: 0,
      rollEndedAt: -1000,
      flowUntil: -1,
      shockwave: false,
      held: false,
    })
  );
}

/** The move under way (or the last one). */
export function currentMove(sim: Simulation): MoveDef {
  const { def } = weaponType(sim);
  const s = swingOf(sim);
  if (s.move === 'charged') return def.charged;
  if (s.move === 'dash') return def.dash;
  return def.chain[Math.min(s.step, def.chain.length - 1)] ?? def.chain[0]!;
}

const fullCharge = (s: Swing) => s.move === 'charged' && s.charge >= 1;

/** The chain's last hit (when the chain has more than one). */
export function isFinisher(sim: Simulation): boolean {
  const s = swingOf(sim);
  const chain = weaponType(sim).def.chain;
  return s.move === 'chain' && chain.length > 1 && s.step === chain.length - 1;
}

/**
 * Picks the move an attack starts with: a dash-strike right out of a roll (an attack pressed during
 * one replays as it ends), else the next step of the chain while its window is open, else the first.
 */
export function chooseMove(sim: Simulation): void {
  const s = swingOf(sim);
  const { def } = weaponType(sim);
  if (sim.tick - s.rollEndedAt <= def.dashWindow) {
    s.move = 'dash';
    s.step = 0;
  } else {
    s.move = 'chain';
    s.step = s.comboTicks > 0 ? s.nextStep % def.chain.length : 0;
  }
  s.charge = 0;
  s.comboTicks = 0;
  s.shockwave = false;
  s.held = (sim.input.held & Action.attack) !== 0;
}

/** Turns the move under way into the charged attack, `charge` full (0..1), let go in the Perfect window or not. */
export function releaseCharge(sim: Simulation, charge: number, perfect = false): void {
  const s = swingOf(sim);
  s.move = 'charged';
  s.charge = charge;
  s.shockwave = false;
  s.perfect = perfect;
}

/** Whether letting go of a charge `t` ticks in lands in the bow's Perfect window. */
export function inPerfectWindow(sim: Simulation, t: number): boolean {
  const sig = weaponType(sim).def.signature;
  if (sig.type !== 'pin') return false;
  const needed = chargeTicks(sim);
  const extra = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment)).perfectWindow;
  return t >= needed && t < needed + sig.window + extra;
}

/** After a move ends: a light attack opens the window for the chain's next step. */
export function endMove(sim: Simulation): void {
  const s = swingOf(sim);
  const { def } = weaponType(sim);
  if (s.move !== 'chain') return;
  s.nextStep = (s.step + 1) % def.chain.length;
  s.comboTicks = def.chainWindow;
}

export function rollEnded(sim: Simulation): void {
  swingOf(sim).rollEndedAt = sim.tick;
}

/** Ticks a charged attack takes to fill, after perks that speed it up. */
export function chargeTicks(sim: Simulation): number {
  const totals = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment));
  return Math.max(1, Math.round(weaponType(sim).def.charged.chargeTicks / (1 + totals.chargeSpeed)));
}

export interface MoveNumbers {
  damage: number;
  staminaCost: number;
  reach: number;
  width: number;
  knockback: number;
  stagger: number;
}

/** The move under way, worked out from the weapon, the player's stats, perks and class affinity. */
export function moveNumbers(sim: Simulation, move: MoveDef = currentMove(sim)): MoveNumbers {
  const stats = playerStats(sim, sim.player);
  const totals = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment));
  const { def } = weaponType(sim);
  const s = swingOf(sim);
  const cls = sim.ecs.get(sim.player, Abilities)?.class;
  const affinity =
    cls !== undefined && def.affinity.includes(cls) ? 1 + sim.content.weapons.affinityBonus : 1;
  const partial = move === def.charged && s.move === 'charged' && s.charge < 1 ? def.charged.partial : 1;
  const finisher =
    move !== def.charged && move !== def.dash && isFinisher(sim) ? 1 + totals.finisherDamage : 1;
  return {
    damage: stats.damage * move.damage * affinity * partial * finisher,
    staminaCost: stats.staminaCost * move.stamina,
    reach: stats.reach * move.reach * (1 + totals.reach),
    width: stats.width * move.width,
    knockback: stats.knockback * move.knockback,
    stagger: Math.round(move.stagger * (1 + totals.stagger)),
  };
}

/**
 * Whether a lunge should hold here: a living foe right in front, so the move's step forward never
 * carries the player onto its body (and its contact damage).
 */
export function lungeBlocked(sim: Simulation, p: Player): boolean {
  if (currentMove(sim).through) return false;
  const body = sim.ecs.need(sim.player, Body);
  for (const [target, , tb] of sim.ecs.query(Enemy, Body)) {
    if (sim.ecs.has(target, Dying)) continue;
    const dx = tb.x - body.x;
    const dy = tb.y - body.y;
    if (dx * p.dirX + dy * p.dirY > 0 && Math.hypot(dx, dy) < (body.w + tb.w) / 2 + 4) return true;
  }
  return false;
}

/** Whether blows taken now leave the player standing: hammer swings and full charges, until they land. */
export function hyperArmored(sim: Simulation): boolean {
  const p = sim.ecs.need(sim.player, Player);
  if (p.state !== 'attack') return false;
  const move = currentMove(sim);
  const s = swingOf(sim);
  if (!move.hyperArmor || (s.move === 'charged' && !fullCharge(s))) return false;
  return p.t <= move.activeTo;
}

/** The move's hit box while it is active, else null. A sweep covers a square around the player. */
export function attackBox(sim: Simulation, e: Entity): Box | null {
  const p = sim.ecs.get(e, Player);
  const body = sim.ecs.get(e, Body);
  if (!p || !body || p.state !== 'attack') return null;
  const move = currentMove(sim);
  if (move.shot || p.t < move.activeFrom || p.t > move.activeTo) return null;
  const { reach, width } = moveNumbers(sim, move);
  if (move.around) {
    const r = reach + Math.max(body.w, body.h) / 2;
    return { x: body.x - r, y: body.y - r, w: r * 2, h: r * 2 };
  }
  const ax = Math.abs(p.dirX);
  const ay = Math.abs(p.dirY);
  const w = ax * reach + ay * width;
  const h = ax * width + ay * reach;
  const cx = body.x + p.dirX * (body.w / 2 + reach / 2);
  const cy = body.y + p.dirY * (body.h / 2 + reach / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * A roll whose i-frames took a blow opens Flow for a sword: until `window` ticks after the roll ends,
 * the next light hit or dash-strike crits and refunds the roll's stamina.
 */
export function openFlow(sim: Simulation): void {
  const p = sim.ecs.need(sim.player, Player);
  const { def } = weaponType(sim);
  if (p.state !== 'roll' || def.signature.type !== 'flow') return;
  const left = Math.max(0, sim.content.player.roll.duration - p.t);
  swingOf(sim).flowUntil = sim.tick + left + def.signature.window;
}

/** Whether the player stands behind a foe: more than `turned` away from where it faces. */
function fromBehind(sim: Simulation, target: Entity, tb: Body, body: Body, turned: number): boolean {
  const dir = sim.ecs.get(target, Facing)?.dir;
  if (!dir) return false;
  const [fx, fy] = DIR_VEC[dir];
  const [nx, ny] = normalize(body.x - tb.x, body.y - tb.y);
  return fx * nx + fy * ny < -turned;
}

/** What one weapon hit does on top of the swing's own numbers: the type's signature rule and type perks. */
function shapeHit(
  sim: Simulation,
  target: Entity,
  tb: Body,
  body: Body,
  p: Player,
  move: MoveDef,
): { bonus: number; crit: boolean; knockback: number; mark: boolean; kind: string | null } {
  const { def } = weaponType(sim);
  const s = swingOf(sim);
  const totals = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment));
  const midAttack = TELEGRAPH_STATES.has(sim.ecs.get(target, Ai)?.state ?? '');
  let bonus = midAttack ? totals.midAttackDamage : 0;
  // A Warden's Bane coating bites harder into bosses.
  const coat = sim.ecs.get(sim.player, Coating)?.coating;
  if (coat?.kind === 'warden' && sim.ecs.has(target, Boss)) bonus += coat.bonus;
  let crit = false;
  let knockback = 1;
  let mark = false;
  let kind: string | null = null;
  const sig = def.signature;
  // A dash-strike out of the roll is the natural counter, so it flows as well as a light hit.
  if (sig.type === 'flow' && s.move !== 'charged' && sim.tick <= s.flowUntil) {
    crit = true;
    kind = 'flow';
  } else if (sig.type === 'tipper') {
    if (midAttack) bonus += sig.midAttack;
    if (!move.around) {
      const { reach } = moveNumbers(sim, move);
      const along = (tb.x - body.x) * p.dirX + (tb.y - body.y) * p.dirY - body.w / 2;
      const at = along / reach;
      if (at >= 1 - sig.outer) {
        bonus += sig.bonus + totals.tipperDamage;
        knockback = sig.knockback;
        mark = true;
        kind = 'tipper';
      } else if (at < 1 / 3) knockback = sig.close;
    }
  } else if (sig.type === 'break' && sim.ecs.has(target, Staggered)) {
    crit = true;
    bonus += totals.crushDamage;
    kind = 'crush';
  } else if (sig.type === 'flank') {
    // A Stalker's tricks (out of Vanish, or with a decoy drawing eyes away) count as being behind.
    const cls = sim.ecs.get(sim.player, Abilities)?.class;
    const trick =
      cls === 'stalker' && (sim.ecs.has(sim.player, Ambush) || [...sim.ecs.query(Decoy)].length > 0);
    if (trick || fromBehind(sim, target, tb, body, sig.behind)) {
      crit = true;
      bonus += sig.bonus + totals.flankDamage;
      kind = 'flank';
    }
  }
  return { bonus, crit, knockback, mark, kind };
}

/**
 * The move's hits this tick. Returns the body of a shield that turned the blow, if one did, so the
 * controller can bounce the player off it.
 */
export function strikeWith(sim: Simulation, e: Entity, p: Player): Body | null {
  const { ecs } = sim;
  const box = attackBox(sim, e);
  if (!box) return null;
  const move = currentMove(sim);
  const numbers = moveNumbers(sim, move);
  const stats = playerStats(sim, e);
  const body = ecs.need(e, Body);
  const def = sim.content.player;
  const s = swingOf(sim);
  const sig = weaponType(sim).def.signature;
  const totals = gearTotals(sim.content, ecs.get(e, Equipment));
  for (const [target, , tb] of ecs.query(Enemy, Body, Health)) {
    if (p.struck.includes(target) || ecs.has(target, Dying) || !overlaps(box, bodyBox(tb))) continue;
    if (
      move.around &&
      Math.hypot(tb.x - body.x, tb.y - body.y) > numbers.reach + Math.max(body.w, body.h) / 2 + tb.w / 2
    )
      continue;
    p.struck.push(target);
    const ambushed = ecs.has(e, Ambush);
    const shape = shapeHit(sim, target, tb, body, p, move);
    const roll = rollDamage(sim.rng, {
      ...def.attack,
      damage: numbers.damage * (1 + shape.bonus),
      critChance: shape.crit ? 1 : stats.critChance,
      critMultiplier: stats.critMultiplier,
    });
    const result = applyDamage(sim, target, {
      ...roll,
      fromX: body.x,
      fromY: body.y,
      knockback: numbers.knockback * shape.knockback,
      charges: true,
    });
    if (result === 'blocked') return tb;
    if (result !== 'hit') continue;
    sim.hitstop = Math.max(sim.hitstop, move.hitstop);
    if (numbers.stagger > 0) stagger(sim, target, numbers.stagger);
    onWeaponHit(sim, target);
    if (shape.kind) sim.events.emit({ type: 'weaponRule', rule: shape.kind, x: tb.x, y: tb.y });
    if (shape.kind === 'flow') {
      // One Flow per roll: the crit, the roll's stamina back, and any super energy perks promise.
      s.flowUntil = -1;
      const stamina = ecs.need(e, Stamina);
      stamina.value = Math.min(stamina.max, stamina.value + stats.rollStamina);
      const energy = gearTotals(sim.content, ecs.get(e, Equipment)).flowEnergy;
      if (energy > 0) gainEnergy(sim, energy);
    }
    if (shape.mark) markFoe(sim, target);
    if (sig.type === 'embers') storeEmber(sim, sig.max);
    if (sig.type === 'embers' && totals.bonkKnockback > 0)
      push(sim, target, body, numbers.knockback * totals.bonkKnockback);
    if (sig.type === 'flank') addBleed(sim, target, sig.bleed, numbers.damage, ambushed && roll.crit);
    applyCoating(sim, target, numbers.damage);
  }
  return null;
}

/**
 * A dagger hit adds a Bleed stack (a crit out of hiding fills them all, with the right perk); a full
 * set bursts for a heavy unblockable hit and a stagger.
 */
function addBleed(
  sim: Simulation,
  target: Entity,
  bleed: { stacks: number; ticks: number; damage: number; stagger: number },
  damage: number,
  ambushCrit: boolean,
): void {
  if (!sim.ecs.isAlive(target) || sim.ecs.has(target, Dying)) return;
  const totals = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment));
  const b = sim.ecs.get(target, Bleed) ?? sim.ecs.add(target, Bleed, { stacks: 0, ticks: 0 });
  b.stacks = ambushCrit && totals.ambushBleed > 0 ? bleed.stacks : b.stacks + 1;
  b.ticks = bleed.ticks;
  if (b.stacks < bleed.stacks) return;
  sim.ecs.remove(target, Bleed);
  const tb = sim.ecs.need(target, Body);
  const result = applyDamage(sim, target, {
    amount: Math.max(1, Math.round(damage * bleed.damage)),
    crit: false,
    fromX: tb.x,
    fromY: tb.y,
    knockback: 0,
    unblockable: true,
    charges: true,
  });
  if (result === 'hit') stagger(sim, target, bleed.stagger);
  if (totals.bleedStamina > 0) {
    const stamina = sim.ecs.need(sim.player, Stamina);
    stamina.value = Math.min(stamina.max, stamina.value + totals.bleedStamina);
  }
  sim.events.emit({ type: 'weaponRule', rule: 'bleed', x: tb.x, y: tb.y });
}

/** A coated weapon's hit: the foe catches fire or bleeds (a Warden's Bane works in `shapeHit`). */
function applyCoating(sim: Simulation, target: Entity, damage: number): void {
  const coat = sim.ecs.get(sim.player, Coating)?.coating;
  if (!coat || !sim.ecs.isAlive(target) || sim.ecs.has(target, Dying)) return;
  if (coat.kind === 'fire') {
    const burning = sim.ecs.get(target, Burning);
    const ticks = Math.round(coat.seconds * TICK_RATE);
    if (burning) Object.assign(burning, { damage: Math.max(burning.damage, coat.damage), ticks });
    else sim.ecs.add(target, Burning, { damage: coat.damage, ticks });
  } else if (coat.kind === 'bleed') addBleed(sim, target, coat, damage, false);
}

/** Extra damage a bleeding foe takes from everything, with the perk for it. */
export function bleedBonus(sim: Simulation, target: Entity): number {
  if (!sim.ecs.has(target, Bleed)) return 0;
  return gearTotals(sim.content, sim.ecs.get(sim.player, Equipment)).bleedVulnerability;
}

/** A move that lunges through foes leaves the player untouchable until it has passed. */
export function throughGrace(sim: Simulation, e: Entity, p: Player): void {
  const move = currentMove(sim);
  if (!move.through || p.t !== 1) return;
  const ticks = move.activeTo;
  const inv = sim.ecs.get(e, Invulnerable);
  if (!inv) sim.ecs.add(e, Invulnerable, { ticks });
  else inv.ticks = Math.max(inv.ticks, ticks);
}

/**
 * What the swing starting now costs: every fifth is free with the perk for it, and so is a bow shot out
 * of a roll with its perk.
 */
export function swingCost(sim: Simulation): number {
  const s = swingOf(sim);
  s.swings = (s.swings ?? 0) + 1;
  const totals = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment));
  const free =
    (totals.freeFifth > 0 && s.swings % 5 === 0) ||
    (totals.freeDashShot > 0 && s.move === 'dash' && currentMove(sim).shot !== undefined);
  return free ? 0 : moveNumbers(sim).staminaCost;
}

/** The next roll is free once (a Legendary bow's reward for a Perfect Shot); true if this one was. */
export function takeFreeRoll(sim: Simulation): boolean {
  const s = sim.ecs.get(sim.player, Swing);
  if (!s?.freeRoll) return false;
  s.freeRoll = false;
  return true;
}

/**
 * A bow move looses its arrow (or three, split, on a charged shot with the perk). A Perfect Shot carries
 * its bonus with it. A quick shot with a foe right in front kicks it away first, with the perk.
 */
export function fireShot(sim: Simulation, e: Entity, p: Player): void {
  const move = currentMove(sim);
  if (!move.shot || p.t !== move.activeFrom) return;
  const s = swingOf(sim);
  const { def } = weaponType(sim);
  const sig = def.signature;
  const totals = gearTotals(sim.content, sim.ecs.get(e, Equipment));
  const body = sim.ecs.need(e, Body);
  const perfect = s.move === 'charged' && s.perfect === true && sig.type === 'pin';
  const numbers = moveNumbers(sim, move);
  let damage = numbers.damage * (perfect ? 1 + sig.bonus : 1);
  // A staff's fireball spends an Ember; with none, it is only a spark. A full set bursts, with the perk.
  let explode = 0;
  if (sig.type === 'embers') {
    const embers = s.embers ?? 0;
    if (embers === 0) damage *= sig.spark;
    else {
      if (embers >= sig.max && totals.fullEmberBlast > 0) explode = sig.explode;
      spendEmber(sim);
    }
  }
  const angles = s.move === 'charged' && totals.splitShot > 0 ? [-0.2, 0, 0.2] : [0];
  const base = Math.atan2(p.dirY, p.dirX);
  for (const a of angles) {
    spawnProjectile(sim, {
      kind: sig.type === 'embers' ? 'fireball' : 'arrow',
      team: 'player',
      x: body.x + p.dirX * 6,
      y: body.y + p.dirY * 6,
      dirX: Math.cos(base + a),
      dirY: Math.sin(base + a),
      speed: move.shot.speed,
      damage,
      life: Math.round(move.shot.range / move.shot.speed),
      perfect,
      pierce: sig.type === 'embers' && totals.piercingFire > 0,
      explode,
    });
  }
  if (perfect) {
    sim.events.emit({ type: 'weaponRule', rule: 'perfect', x: body.x, y: body.y });
    const cls = sim.ecs.get(e, Abilities)?.class ?? null;
    if (gearEffects(sim.content, sim.ecs.get(e, Equipment), cls).some((fx) => fx.type === 'perfectRefund'))
      s.freeRoll = true;
  }
  if (s.move === 'chain' && totals.bowKick > 0) kickAway(sim, body, p, numbers.damage);
}

/** Shoves a foe right in front of the player away, for a little damage. */
function kickAway(sim: Simulation, body: Body, p: Player, damage: number): void {
  for (const [target, , tb] of sim.ecs.query(Enemy, Body, Health)) {
    if (sim.ecs.has(target, Dying)) continue;
    const dx = tb.x - body.x;
    const dy = tb.y - body.y;
    if (dx * p.dirX + dy * p.dirY <= 0 || Math.hypot(dx, dy) > (body.w + tb.w) / 2 + 8) continue;
    applyDamage(sim, target, {
      amount: Math.max(1, Math.round(damage * 0.5)),
      crit: false,
      fromX: body.x,
      fromY: body.y,
      knockback: 5,
      charges: true,
    });
  }
}

/**
 * The player's arrows in flight: a hit lodges a pin and stops; a Perfect Shot pierces, staggers, and
 * rips out every pin for extra damage. A raised shield stops any arrow.
 */
function updateArrows(sim: Simulation): void {
  const { ecs } = sim;
  const { def } = weaponType(sim);
  const sig = def.signature;
  const totals = gearTotals(sim.content, ecs.get(sim.player, Equipment));
  for (const [arrow, proj, body] of ecs.query(Projectile, Body)) {
    if (!proj.bow) continue;
    const point = { x: body.x - 1, y: body.y - 1, w: 2, h: 2 };
    for (const [target, , tb] of ecs.query(Enemy, Body, Health)) {
      if (proj.bow.hit.includes(target) || ecs.has(target, Dying) || !overlaps(point, bodyBox(tb))) continue;
      proj.bow.hit.push(target);
      const result = applyDamage(sim, target, {
        amount: Math.max(1, Math.round(proj.damage)),
        crit: proj.bow.perfect,
        fromX: body.x - proj.vx * 4,
        fromY: body.y - proj.vy * 4,
        knockback: proj.bow.perfect ? 2.5 : 0.5,
        charges: true,
      });
      if (result === 'blocked') {
        ecs.destroy(arrow);
        break;
      }
      if (result !== 'hit') continue;
      sim.hitstop = Math.max(sim.hitstop, proj.bow.perfect ? 4 : 1);
      onWeaponHit(sim, target);
      applyCoating(sim, target, proj.damage);
      if (proj.bow.explode) burst(sim, body.x, body.y, proj.bow.explode, proj.damage * 0.6, proj.bow.hit);
      if (sig.type !== 'pin') {
        if (proj.bow.pierce) continue;
        ecs.destroy(arrow);
        break;
      }
      if (proj.bow.perfect) {
        stagger(sim, target, sig.stagger);
        ripPins(sim, target, proj.damage * sig.rip * (1 + totals.pinDamage));
        continue; // a Perfect Shot flies on
      }
      const pins = ecs.get(target, Pinned) ?? ecs.add(target, Pinned, { count: 0, ticks: 0 });
      pins.count = Math.min(sig.pins, pins.count + 1);
      pins.ticks = sig.ticks;
      ecs.destroy(arrow);
      break;
    }
  }
}

/** A fireball's burst: everything else within `radius` takes `damage`. */
function burst(
  sim: Simulation,
  x: number,
  y: number,
  radius: number,
  damage: number,
  spared: Entity[],
): void {
  for (const [target, , tb] of sim.ecs.query(Enemy, Body, Health)) {
    if (spared.includes(target) || sim.ecs.has(target, Dying)) continue;
    if (Math.hypot(tb.x - x, tb.y - y) > radius + tb.w / 2) continue;
    applyDamage(sim, target, {
      amount: Math.max(1, Math.round(damage)),
      crit: false,
      fromX: x,
      fromY: y,
      knockback: 2,
      unblockable: true,
      charges: true,
    });
  }
  sim.events.emit({ type: 'weaponRule', rule: 'emberBurst', x, y });
}

/** Shoves a foe away from the player (an Ember staff's bonk, with its perk). */
function push(sim: Simulation, target: Entity, body: Body, strength: number): void {
  const motion = sim.ecs.get(target, Motion);
  const tb = sim.ecs.get(target, Body);
  if (!motion || !tb) return;
  const [nx, ny] = normalize(tb.x - body.x, tb.y - body.y);
  motion.kx += nx * strength;
  motion.ky += ny * strength;
}

/** How many Embers the staff holds. */
export function embersHeld(sim: Simulation): number {
  return sim.ecs.get(sim.player, Swing)?.embers ?? 0;
}

/** Stores an Ember, up to the staff's limit. */
function storeEmber(sim: Simulation, max: number): void {
  const s = swingOf(sim);
  const before = s.embers ?? 0;
  s.embers = Math.min(max, before + 1);
  if (s.embers > before) sim.events.emit({ type: 'embers', count: s.embers });
}

/** Spends an Ember: a Legendary staff warms the player with it. */
function spendEmber(sim: Simulation): void {
  const s = swingOf(sim);
  s.embers = Math.max(0, (s.embers ?? 0) - 1);
  sim.events.emit({ type: 'embers', count: s.embers });
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  const health = sim.ecs.need(sim.player, Health);
  for (const fx of gearEffects(sim.content, sim.ecs.get(sim.player, Equipment), cls)) {
    if (fx.type !== 'emberHeal' || health.hp <= 0) continue;
    const amount = Math.min(health.max - health.hp, Math.round(fx.amount));
    if (amount <= 0) continue;
    health.hp += amount;
    sim.events.emit({ type: 'healed', amount });
  }
}

/**
 * After the player uses an ability: with a staff, the Ashcaller (its affinity) and anyone with the perk
 * for it store an Ember.
 */
export function onAbilityUsed(sim: Simulation): void {
  const sig = weaponType(sim).def.signature;
  if (sig.type !== 'embers') return;
  const cls = sim.ecs.get(sim.player, Abilities)?.class;
  const perk = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment)).abilityEmbers > 0;
  if (cls === 'ashcaller' || perk) storeEmber(sim, sig.max);
}

/** Extra ability damage from Embers held, with the perk for it. */
export function emberAbilityBonus(sim: Simulation): number {
  if (weaponType(sim).def.signature.type !== 'embers') return 0;
  return embersHeld(sim) * gearTotals(sim.content, sim.ecs.get(sim.player, Equipment)).emberPower;
}

/** Tears every pin out of a foe, `each` damage apiece. */
function ripPins(sim: Simulation, target: Entity, each: number): void {
  const pins = sim.ecs.get(target, Pinned);
  if (!pins || !sim.ecs.isAlive(target) || sim.ecs.has(target, Dying)) return;
  sim.ecs.remove(target, Pinned);
  const tb = sim.ecs.need(target, Body);
  applyDamage(sim, target, {
    amount: Math.max(1, Math.round(each * pins.count)),
    crit: false,
    fromX: tb.x,
    fromY: tb.y,
    knockback: 0,
    unblockable: true,
    charges: true,
  });
  sim.events.emit({ type: 'weaponRule', rule: 'rip', x: tb.x, y: tb.y });
}

/** A sworn spear's tipper marks the foe; the next ability hit on it staggers it outright. */
function markFoe(sim: Simulation, target: Entity): void {
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  for (const fx of gearEffects(sim.content, sim.ecs.get(sim.player, Equipment), cls)) {
    if (fx.type !== 'tipperMark') continue;
    sim.ecs.add(target, Marked, { ticks: Math.round(fx.seconds * TICK_RATE), stagger: fx.stagger });
  }
}

/** After an ability hits `target`: a mark there is spent, staggering it. */
export function spendMark(sim: Simulation, target: Entity): void {
  const mark = sim.ecs.get(target, Marked);
  if (!mark) return;
  sim.ecs.remove(target, Marked);
  stagger(sim, target, mark.stagger);
  const tb = sim.ecs.get(target, Body);
  if (tb) sim.events.emit({ type: 'weaponRule', rule: 'markSpent', x: tb.x, y: tb.y });
}

/**
 * A full-charge hammer slam, as its active window closes: where it lands, foes are pulled in (a
 * Legendary's toll) and a shockwave goes out, hit or miss, sparing what the slam itself struck.
 */
export function slamShockwave(sim: Simulation, e: Entity, p: Player): void {
  const s = swingOf(sim);
  const { def } = weaponType(sim);
  const move = currentMove(sim);
  if (s.shockwave || !fullCharge(s) || def.signature.type !== 'break' || p.t !== move.activeTo) return;
  s.shockwave = true;
  const body = sim.ecs.need(e, Body);
  const { reach, damage } = moveNumbers(sim, move);
  const x = body.x + p.dirX * (body.w / 2 + reach * 0.6);
  const y = body.y + p.dirY * (body.h / 2 + reach * 0.6);
  const cls = sim.ecs.get(sim.player, Abilities)?.class ?? null;
  for (const fx of gearEffects(sim.content, sim.ecs.get(e, Equipment), cls)) {
    if (fx.type !== 'slamPull') continue;
    for (const [target, , tb] of sim.ecs.query(Enemy, Body)) {
      const d = Math.hypot(tb.x - x, tb.y - y);
      if (d > fx.radius || d < 1 || sim.ecs.has(target, Dying)) continue;
      // Drawn most of the way in, so the shockwave catches them.
      const [nx, ny] = normalize(x - tb.x, y - tb.y);
      const pull = Math.max(0, d - 8) * 0.8;
      tb.x += nx * pull;
      tb.y += ny * pull;
    }
  }
  const wave = def.signature.shockwave;
  for (const [target, , tb] of sim.ecs.query(Enemy, Body, Health)) {
    if (p.struck.includes(target) || sim.ecs.has(target, Dying)) continue;
    if (Math.hypot(tb.x - x, tb.y - y) > wave.radius + tb.w / 2) continue;
    const roll = rollDamage(sim.rng, {
      ...sim.content.player.attack,
      damage: damage * wave.damage,
      critChance: 0,
    });
    if (
      applyDamage(sim, target, {
        ...roll,
        fromX: x,
        fromY: y,
        knockback: 3,
        unblockable: true,
        charges: true,
      }) === 'hit'
    )
      stagger(sim, target, wave.stagger);
  }
  sim.events.emit({ type: 'shockwave', x, y, radius: wave.radius });
}

function tickWeapons(sim: Simulation): void {
  const s = sim.ecs.get(sim.player, Swing);
  if (s && s.comboTicks > 0) s.comboTicks--;
  for (const [e, mark] of sim.ecs.query(Marked)) if (--mark.ticks <= 0) sim.ecs.remove(e, Marked);
  for (const [e, bleed] of sim.ecs.query(Bleed)) if (--bleed.ticks <= 0) sim.ecs.remove(e, Bleed);
  for (const [e, pins] of sim.ecs.query(Pinned)) if (--pins.ticks <= 0) sim.ecs.remove(e, Pinned);
  // Burning foes (a fire coating) take their damage once a second.
  for (const [e, burning, tb] of sim.ecs.query(Burning, Body)) {
    if (--burning.ticks <= 0) sim.ecs.remove(e, Burning);
    if (burning.ticks % TICK_RATE !== 0 || sim.ecs.has(e, Dying)) continue;
    applyDamage(sim, e, {
      amount: Math.max(1, Math.round(burning.damage)),
      crit: false,
      fromX: tb.x,
      fromY: tb.y,
      knockback: 0,
      unblockable: true,
      charges: true,
    });
  }
  // Burning pins, with the bow perk: each lodged arrow scorches its foe once a second.
  const burn = gearTotals(sim.content, sim.ecs.get(sim.player, Equipment)).pinBurn;
  if (burn > 0 && sim.tick % TICK_RATE === 0) {
    for (const [e, pins, tb] of sim.ecs.query(Pinned, Body)) {
      if (sim.ecs.has(e, Dying)) continue;
      applyDamage(sim, e, {
        amount: Math.max(1, Math.round(burn * pins.count)),
        crit: false,
        fromX: tb.x,
        fromY: tb.y,
        knockback: 0,
        unblockable: true,
        charges: true,
      });
    }
  }
}

export const weaponsModule: SimModule = {
  id: 'weapons',
  systems: [
    { phase: 'combat', run: updateArrows },
    { phase: 'cleanup', run: tickWeapons },
  ],
};
