/**
 * Damage rules shared by every attacker: damage rolls, blocking, knockback,
 * hurt states, deaths and loot. Anything that hurts something goes through
 * {@link applyDamage}, so feedback (events, numbers, hitstop) stays consistent.
 */
import type { DropDef } from '../../content/schemas';
import type { Entity } from '../../core/ecs';
import { normalize, overlaps } from '../../core/math';
import type { Rng } from '../../core/rng';
import {
  Ai,
  Body,
  Boss,
  Brazier,
  ContactDamage,
  Dying,
  Enemy,
  Health,
  Invulnerable,
  Minion,
  Motion,
  Player,
  Spawned,
  Staggered,
} from '../components';
import type { SimModule } from '../module';
import { bodyBox } from '../physics';
import type { Simulation } from '../simulation';
import { gainEnergy } from './energy';
import { relicWanted } from './unlocks';
import { playerStats } from './items';
import { dropGear, dropSureGear } from './gear';
import { foeDropPower, scaleDealt, scaleTaken } from './power';
import { bossFactor, extendOnKill, wielding } from './supers';
import { countKill } from './objectives';
import { dropPickup } from './pickups';
import { onHurt, onKill } from './modifiers';
import { absorb } from './overshield';
import { afterHurt, catchesKillingBlow, keepsFooting, killBurst, onDodge, wardOff } from './perks';
import { heatOf, isRefight, openChest, settleRefight } from './wardens';
import { bleedBonus, hyperArmored, openFlow } from './weapons';
import { takeAmbush, unveil } from './stealth';

export interface Hit {
  amount: number;
  crit: boolean;
  /** Where the blow came from, for knockback direction. */
  fromX: number;
  fromY: number;
  knockback: number;
  /** Goes through shields (ability blasts, burning ground, dashes). */
  unblockable?: boolean;
  /** Fills the player's super energy (sword and ability hits; not the super's own). */
  charges?: boolean;
  /** The ability dealing it, so damage numbers can show its class color. */
  ability?: string;
  /** How much of its damage fills a Warden's poise (hammers 3, the rest 1). */
  poise?: number;
  /** A foe's blow on the player: the foe's Power, checked against the player's armor (modules/power.ts). */
  power?: number;
}

export type HitResult = 'hit' | 'blocked' | 'ignored';

/** Ticks a dying entity lingers for its death animation. */
export const DEATH_TICKS = 40;

export function rollDamage(
  rng: Rng,
  spec: { damage: number; variance: number; critChance: number; critMultiplier: number },
): { amount: number; crit: boolean } {
  const crit = rng.chance(spec.critChance);
  const base = spec.damage * (1 + rng.range(-spec.variance, spec.variance));
  return { amount: Math.max(1, Math.round(base * (crit ? spec.critMultiplier : 1))), crit };
}

export function applyDamage(sim: Simulation, target: Entity, hit: Hit): HitResult {
  const { ecs } = sim;
  if (!ecs.isAlive(target) || ecs.has(target, Dying)) return 'ignored';
  const health = ecs.get(target, Health);
  const body = ecs.get(target, Body);
  if (!health || !body) return 'ignored';
  const player = ecs.get(target, Player);
  return player
    ? damagePlayer(sim, target, player, health, body, hit)
    : damageEnemy(sim, target, health, body, hit);
}

function damagePlayer(
  sim: Simulation,
  e: Entity,
  player: Player,
  health: Health,
  body: Body,
  hit: Hit,
): HitResult {
  const { ecs } = sim;
  const def = sim.content.player;
  if (player.state === 'dead' || sim.state.cheats.god) return 'ignored';
  if ((ecs.get(e, Invulnerable)?.ticks ?? 0) > 0) {
    onDodge(sim);
    openFlow(sim);
    return 'ignored';
  }
  // A ring of embers raised by a roll turns the blow aside and bursts.
  if (wardOff(sim)) return 'blocked';

  // Armor and buffs absorb a fraction of every blow; something always gets through. A foe's blow is scaled by
  // its Power against the armor's first.
  const scaled = hit.power === undefined ? hit.amount : scaleTaken(sim, hit.amount, hit.power);
  const dealt = Math.max(1, Math.round(scaled * (1 - playerStats(sim, e).defense)));
  ecs.add(e, Invulnerable, { ticks: def.hurt.iframes });
  push(sim, e, body, hit, 1);
  unveil(sim);
  onHurt(sim, dealt);
  // An overshield takes the blow first. One that soaks all of it spares the player the flinch.
  const amount = absorb(sim, e, dealt);
  if (amount === 0) return 'hit';
  health.hp = Math.max(0, health.hp - amount);
  sim.events.emit({
    type: 'damaged',
    target: e,
    isPlayer: true,
    amount,
    crit: hit.crit,
    x: body.x,
    y: body.y,
    hp: health.hp,
    maxHp: health.max,
    ability: hit.ability ?? null,
  });

  if (health.hp <= 0 && !catchesKillingBlow(sim, health)) {
    const lost = Math.floor(player.souls * def.death.soulPenalty);
    player.souls -= lost;
    player.state = 'dead';
    player.t = 0;
    sim.state.lastDeath = { x: body.x, y: body.y };
    sim.events.emit({ type: 'playerDied', soulsLost: lost });
  } else {
    afterHurt(sim, health);
    // Hammer swings and full charges carry through a blow; so does poise, now and then.
    if (!hyperArmored(sim) && !keepsFooting(sim)) {
      player.state = 'hurt';
      player.t = 0;
    }
  }
  return 'hit';
}

function damageEnemy(sim: Simulation, e: Entity, health: Health, body: Body, hit: Hit): HitResult {
  const { ecs } = sim;
  const enemy = ecs.get(e, Enemy);
  const ai = ecs.get(e, Ai);
  if (!enemy) return 'ignored';
  const def = sim.content.enemy(enemy.archetype);

  // A boss's shield stops everything; only the arena's braziers bring it down.
  const boss = ecs.get(e, Boss);
  if (boss?.shielded) {
    sim.events.emit({ type: 'blocked', x: body.x, y: body.y - 4 });
    return 'blocked';
  }
  // The shield stops everything but abilities, and is down while stunned, staggered or charging.
  // A hit out of hiding (Vanish) strikes harder and finds its way past a raised shield.
  const ambush = takeAmbush(sim);
  const guarding = ai && ai.state !== 'stunned' && ai.state !== 'charge' && !ecs.has(e, Staggered);
  if (def.brain.type === 'shieldKnight' && guarding && !hit.unblockable && ambush === 0) {
    sim.events.emit({ type: 'blocked', x: body.x, y: body.y - 4 });
    return 'blocked';
  }
  // Every blow on a foe is the player's, so the weapon's Power against the foe's scales it.
  // A roaming super's blows on a boss are cut (docs/supers.md), so it can't simply delete one.
  const superCut = boss && wielding(sim) ? bossFactor(sim) : 1;
  const raw = scaleDealt(sim, hit.amount * (1 + ambush + bleedBonus(sim, e)) * superCut, enemy.power);
  const amount = hit.amount > 0 ? Math.max(1, Math.round(raw)) : 0;
  if (ambush > 0) sim.events.emit({ type: 'ambushed', x: body.x, y: body.y, bonus: ambush });

  health.hp = Math.max(0, health.hp - amount);
  if (boss && health.hp > 0) fillPoise(sim, e, boss, amount * (hit.poise ?? 1));
  // A blow that crosses a shield threshold stops there: the shield goes up instead.
  const shieldAt = def.brain.type === 'warden' && boss ? def.brain.shieldAt[boss.phase] : undefined;
  if (boss && shieldAt !== undefined && health.hp <= health.max * shieldAt) {
    health.hp = Math.max(1, Math.ceil(health.max * shieldAt));
    raiseShield(sim, e, boss);
  }
  push(sim, e, body, hit, def.knockbackTaken);
  const energy = sim.content.player.energy;
  if (hit.charges) gainEnergy(sim, amount * energy.perDamage + (health.hp <= 0 ? energy.perKill : 0));
  sim.events.emit({
    type: 'damaged',
    target: e,
    isPlayer: false,
    amount,
    crit: hit.crit,
    x: body.x,
    y: body.y,
    hp: health.hp,
    maxHp: health.max,
    ability: hit.ability ?? null,
  });

  if (health.hp <= 0) {
    onKill(sim, body);
    killEnemy(sim, e);
    // After the kill is recorded, so a burst that kills a neighbor can't set this one off again.
    killBurst(sim, body);
  } else if (ai && !boss && ai.state !== 'stunned' && !ecs.has(e, Staggered)) {
    if (def.recoilTicks > 0) {
      ai.state = 'recoil';
      ai.t = 0;
    } else if (ai.state === 'idle') ai.state = 'chase';
  }
  return 'hit';
}

/** A Warden's poise fills with damage while its shield is down; full, it staggers and empties. */
function fillPoise(sim: Simulation, e: Entity, boss: Boss, amount: number): void {
  const archetype = sim.ecs.need(e, Enemy).archetype;
  const poise = sim.content.enemy(archetype).boss?.poise;
  if (!poise || boss.shielded || sim.ecs.has(e, Staggered)) return;
  boss.poise = (boss.poise ?? 0) + amount;
  if (boss.poise < poise.max) return;
  boss.poise = 0;
  sim.ecs.add(e, Staggered, { ticks: poise.stagger });
  sim.events.emit({ type: 'bossStaggered', boss: archetype });
}

/** Puts a boss's shield up: it falls back to channel, and every brazier goes out to be lit again. */
export function raiseShield(sim: Simulation, e: Entity, boss: Boss): void {
  boss.phase++;
  boss.shielded = true;
  boss.addTimer = 0;
  const ai = sim.ecs.get(e, Ai);
  if (ai) Object.assign(ai, { state: 'channel', t: 0 });
  sim.ecs.remove(e, Staggered);
  for (const [, brazier] of sim.ecs.query(Brazier)) brazier.lit = false;
  const archetype = sim.ecs.need(e, Enemy).archetype;
  sim.events.emit({ type: 'bossShielded', boss: archetype, braziers: braziersInFight(sim) });
}

/** How many braziers the current fight's arena holds. */
export function braziersInFight(sim: Simulation): number {
  const fight = sim.state.bossFight;
  if (!fight) return 0;
  let n = 0;
  for (const [, , b] of sim.ecs.query(Brazier, Body))
    if (Math.abs(b.x - fight.x) <= fight.half && Math.abs(b.y - fight.y) <= fight.half) n++;
  return n;
}

function push(sim: Simulation, e: Entity, body: Body, hit: Hit, scale: number): void {
  const motion = sim.ecs.get(e, Motion);
  if (!motion || scale === 0) return;
  const [nx, ny] = normalize(body.x - hit.fromX, body.y - hit.fromY);
  motion.kx = nx * hit.knockback * scale;
  motion.ky = ny * hit.knockback * scale;
}

export function killEnemy(sim: Simulation, e: Entity): void {
  const { ecs } = sim;
  const enemy = ecs.need(e, Enemy);
  const body = ecs.need(e, Body);
  const def = sim.content.enemy(enemy.archetype);
  ecs.add(e, Dying, { t: 0 });
  ecs.remove(e, ContactDamage);

  // A Warden refight gives only items (its chest), never souls or its story drops again.
  const refight = def.boss !== undefined && isRefight(sim, enemy.archetype);
  const player = ecs.get(sim.player, Player);
  const souls = player && !refight ? Math.round(def.souls * playerStats(sim, sim.player).souls) : 0;
  if (player) player.souls += souls;
  const spawned = ecs.get(e, Spawned);
  if (spawned) sim.state.killed[spawned.spawnId] = true;
  if (!refight) rollDrops(sim, def.drops, body.x, body.y);
  // Bosses drop well above Max Power, elites above, the wild a little (modules/power.ts).
  const source = def.boss ? 'boss' : def.gear?.table === 'elite' ? 'elite' : 'wild';
  if (def.gear && sim.rng.chance(def.gear.chance))
    dropGear(sim, def.gear.table, foeDropPower(sim, source, enemy, body.x, body.y), body.x, body.y);
  if (def.sureGear && !refight) {
    const power = foeDropPower(sim, source, enemy, body.x, body.y);
    dropSureGear(sim, def.sureGear.slot, def.sureGear.tier, power, body.x, body.y);
  }
  countKill(sim, enemy.archetype);
  extendOnKill(sim);
  if (def.boss) {
    openChest(sim, e, enemy.archetype, !sim.state.bossesDefeated[enemy.archetype]);
    settleRefight(sim, enemy.archetype, heatOf(sim, e));
    // Felled for good: it never respawns (until rekindled), its fight ends and its callers go with it.
    sim.state.bossesDefeated[enemy.archetype] = true;
    sim.state.bossFight = null;
    for (const [m] of ecs.query(Minion)) if (!ecs.has(m, Dying)) killEnemy(sim, m);
    sim.events.emit({ type: 'bossDefeated', boss: enemy.archetype });
  }
  sim.events.emit({
    type: 'killed',
    target: e,
    archetype: enemy.archetype,
    x: body.x,
    y: body.y,
    souls,
  });
}

export function rollDrops(sim: Simulation, drops: readonly DropDef[], x: number, y: number): void {
  for (const drop of drops) {
    // Relics only drop while their slot is still locked and none is carried, so each is found once.
    const relic = drop.item !== undefined ? sim.content.items[drop.item] : undefined;
    if (relic?.kind === 'relic' && drop.item !== undefined && !relicWanted(sim, drop.item, relic.unlocks))
      continue;
    if (sim.rng.chance(drop.chance))
      dropPickup(sim, drop.kind, sim.rng.int(drop.amount[0], drop.amount[1]), x, y, drop.item ?? null);
  }
}

function contactDamage(sim: Simulation): void {
  const { ecs } = sim;
  const p = sim.player;
  const pb = ecs.need(p, Body);
  const playerBox = bodyBox(pb);
  for (const [e, cd, body] of ecs.query(ContactDamage, Body)) {
    if (cd.amount <= 0 || !overlaps(bodyBox(body), playerBox)) continue;
    const power = ecs.get(e, Enemy)?.power;
    applyDamage(sim, p, {
      amount: cd.amount,
      ...(power === undefined ? {} : { power }),
      crit: false,
      fromX: body.x,
      fromY: body.y,
      knockback: sim.content.player.hurt.knockback,
    });
  }
}

function tickTimers(sim: Simulation): void {
  const { ecs } = sim;
  for (const [e, dying] of ecs.query(Dying)) if (++dying.t >= DEATH_TICKS) ecs.destroy(e);
  for (const [e, inv] of ecs.query(Invulnerable)) if (--inv.ticks <= 0) ecs.remove(e, Invulnerable);
}

export const combatModule: SimModule = {
  id: 'combat',
  systems: [
    { phase: 'combat', run: contactDamage },
    { phase: 'cleanup', run: tickTimers },
  ],
};
