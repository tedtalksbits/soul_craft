/**
 * The effects only gear brings: chest and leg perks and the Legendary powers (a shield after resting,
 * keeping your footing, the Last Ember, a refund for rolling through a blow, a burning streak, charging
 * the super by standing still). Combat, the player controller and resting call the hooks here at their
 * moment; the effects themselves come from `activeEffects`, which also serves class modifiers.
 */
import type { Entity } from '../../core/ecs';
import { Body, Motion, PerkState, Player, Stamina, Zone, type Health } from '../components';
import { TICK_RATE } from '../constants';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import { gainEnergy } from './energy';
import { playerStats } from './items';
import { activeEffects } from './modifiers';
import { grantOvershield } from './overshield';

function perkState(sim: Simulation): PerkState {
  return (
    sim.ecs.get(sim.player, PerkState) ??
    sim.ecs.add(sim.player, PerkState, {
      cooldowns: {},
      streak: 0,
      streakTicks: 0,
      emberSpent: false,
      refundedRoll: -1,
    })
  );
}

/** Starts a once-in-a-while effect's wait, if it is ready; false while it is still coming round. */
function takeTurn(sim: Simulation, type: string, seconds: number): boolean {
  const s = perkState(sim);
  if ((s.cooldowns[type] ?? 0) > 0) return false;
  s.cooldowns[type] = Math.round(seconds * TICK_RATE);
  return true;
}

/** After resting at a bonfire: the Last Ember is lit again, and rest shields go up. */
export function onRest(sim: Simulation): void {
  perkState(sim).emberSpent = false;
  for (const fx of activeEffects(sim, 'restShield')) grantOvershield(sim, fx.amount, fx.amount, fx.seconds);
}

/** Whether a blow that would make the player flinch is shrugged off (poise). Spends the turn if so. */
export function keepsFooting(sim: Simulation): boolean {
  const poise = activeEffects(sim, 'poise');
  if (poise.length === 0) return false;
  const kept = takeTurn(sim, 'poise', Math.min(...poise.map((fx) => fx.seconds)));
  if (kept) sim.events.emit({ type: 'keptFooting' });
  return kept;
}

/**
 * Whether the Last Ember catches a killing blow: once per rest, the player stays at 1 HP with full
 * stamina instead of dying.
 */
export function catchesKillingBlow(sim: Simulation, health: Health): boolean {
  const s = perkState(sim);
  if (s.emberSpent || activeEffects(sim, 'lastEmber').length === 0) return false;
  s.emberSpent = true;
  health.hp = 1;
  const stamina = sim.ecs.get(sim.player, Stamina);
  if (stamina) stamina.value = stamina.max;
  sim.events.emit({ type: 'lastEmber' });
  return true;
}

/** After the player loses health: a low-health shield goes up once they drop far enough. */
export function afterHurt(sim: Simulation, health: Health): void {
  if (health.hp <= 0) return;
  for (const fx of activeEffects(sim, 'lowHealthShield')) {
    if (health.hp > health.max * fx.below || !takeTurn(sim, 'lowHealthShield', fx.cooldown)) continue;
    grantOvershield(sim, fx.amount, fx.amount, fx.seconds);
  }
}

/** A blow that a roll's i-frames let through: refunds that roll's stamina, once per roll. */
export function onDodge(sim: Simulation): void {
  const p = sim.ecs.need(sim.player, Player);
  if (p.state !== 'roll' || activeEffects(sim, 'dodgeRefund').length === 0) return;
  const s = perkState(sim);
  const rollStart = sim.tick - p.t;
  if (s.refundedRoll === rollStart) return;
  s.refundedRoll = rollStart;
  const stamina = sim.ecs.need(sim.player, Stamina);
  stamina.value = Math.min(stamina.max, stamina.value + playerStats(sim, sim.player).rollStamina);
  sim.events.emit({ type: 'dodged' });
}

/** After a weapon hit on the enemy at `target`: counts the streak, and sets the ground alight on the last hit. */
export function onWeaponHit(sim: Simulation, target: Entity): void {
  const bursts = activeEffects(sim, 'streakBurst');
  if (bursts.length === 0) return;
  const s = perkState(sim);
  s.streak = s.streakTicks > 0 ? s.streak + 1 : 1;
  s.streakTicks = Math.round(Math.max(...bursts.map((fx) => fx.window)) * TICK_RATE);
  const tb = sim.ecs.get(target, Body);
  for (const fx of bursts) {
    if (s.streak % fx.hits !== 0 || !tb) continue;
    const z = sim.ecs.create();
    sim.ecs.add(z, Body, { x: tb.x, y: tb.y, w: fx.radius * 2, h: fx.radius * 2 });
    sim.ecs.add(z, Zone, {
      ability: fx.ability,
      charges: true,
      damage: fx.damage,
      knockback: 0,
      stagger: 0,
      radius: fx.radius,
      heal: 0,
      shield: null,
      t: 0,
      delay: 0,
      duration: fx.duration,
      interval: fx.interval,
      follow: false,
    });
    sim.events.emit({ type: 'streakBurst', x: tb.x, y: tb.y });
  }
}

function tickPerks(sim: Simulation): void {
  const s = sim.ecs.get(sim.player, PerkState);
  if (s) {
    for (const type of Object.keys(s.cooldowns)) if ((s.cooldowns[type] ?? 0) > 0) s.cooldowns[type]!--;
    if (s.streakTicks > 0 && --s.streakTicks === 0) s.streak = 0;
  }
  // Standing still (free, not moving, not asked to move) charges the super.
  const still = activeEffects(sim, 'stillEnergy');
  if (still.length === 0) return;
  const p = sim.ecs.need(sim.player, Player);
  const motion = sim.ecs.need(sim.player, Motion);
  const idle =
    p.state === 'free' &&
    sim.input.moveX === 0 &&
    sim.input.moveY === 0 &&
    motion.vx === 0 &&
    motion.vy === 0;
  if (idle) gainEnergy(sim, still.reduce((n, fx) => n + fx.perSecond, 0) / TICK_RATE);
}

export const perksModule: SimModule = {
  id: 'perks',
  systems: [{ phase: 'cleanup', run: tickPerks }],
};
