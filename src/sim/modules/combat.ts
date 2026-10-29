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
  ContactDamage,
  Dying,
  Enemy,
  Health,
  Invulnerable,
  Motion,
  Player,
  Spawned,
} from '../components';
import type { SimModule } from '../module';
import { bodyBox } from '../physics';
import type { Simulation } from '../simulation';
import { playerStats } from './items';
import { dropPickup } from './pickups';

export interface Hit {
  amount: number;
  crit: boolean;
  /** Where the blow came from, for knockback direction. */
  fromX: number;
  fromY: number;
  knockback: number;
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
  if (player.state === 'dead' || sim.state.cheats.god || (ecs.get(e, Invulnerable)?.ticks ?? 0) > 0)
    return 'ignored';

  // Armour and buffs absorb a fraction of every blow; something always gets through.
  const amount = Math.max(1, Math.round(hit.amount * (1 - playerStats(sim, e).defense)));
  health.hp = Math.max(0, health.hp - amount);
  ecs.add(e, Invulnerable, { ticks: def.hurt.iframes });
  push(sim, e, body, hit, 1);
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
  });

  if (health.hp <= 0) {
    const lost = Math.floor(player.souls * def.death.soulPenalty);
    player.souls -= lost;
    player.state = 'dead';
    player.t = 0;
    sim.events.emit({ type: 'playerDied', soulsLost: lost });
  } else {
    player.state = 'hurt';
    player.t = 0;
  }
  return 'hit';
}

function damageEnemy(sim: Simulation, e: Entity, health: Health, body: Body, hit: Hit): HitResult {
  const { ecs } = sim;
  const enemy = ecs.get(e, Enemy);
  const ai = ecs.get(e, Ai);
  if (!enemy) return 'ignored';
  const def = sim.content.enemy(enemy.archetype);

  if (def.brain.type === 'shieldKnight' && ai && ai.state !== 'stunned' && ai.state !== 'charge') {
    sim.events.emit({ type: 'blocked', x: body.x, y: body.y - 4 });
    return 'blocked';
  }

  health.hp = Math.max(0, health.hp - hit.amount);
  push(sim, e, body, hit, def.knockbackTaken);
  sim.events.emit({
    type: 'damaged',
    target: e,
    isPlayer: false,
    amount: hit.amount,
    crit: hit.crit,
    x: body.x,
    y: body.y,
    hp: health.hp,
    maxHp: health.max,
  });

  if (health.hp <= 0) killEnemy(sim, e);
  else if (ai && ai.state !== 'stunned') {
    if (def.recoilTicks > 0) {
      ai.state = 'recoil';
      ai.t = 0;
    } else if (ai.state === 'idle') ai.state = 'chase';
  }
  return 'hit';
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

  const player = ecs.get(sim.player, Player);
  if (player) player.souls += def.souls;
  const spawned = ecs.get(e, Spawned);
  if (spawned) sim.state.killed[spawned.spawnId] = true;
  rollDrops(sim, def.drops, body.x, body.y);
  sim.events.emit({
    type: 'killed',
    target: e,
    archetype: enemy.archetype,
    x: body.x,
    y: body.y,
    souls: def.souls,
  });
}

export function rollDrops(sim: Simulation, drops: readonly DropDef[], x: number, y: number): void {
  for (const drop of drops) {
    if (sim.rng.chance(drop.chance))
      dropPickup(sim, drop.kind, sim.rng.int(drop.amount[0], drop.amount[1]), x, y, drop.item ?? null);
  }
}

function contactDamage(sim: Simulation): void {
  const { ecs } = sim;
  const p = sim.player;
  const pb = ecs.need(p, Body);
  const playerBox = bodyBox(pb);
  for (const [, cd, body] of ecs.query(ContactDamage, Body)) {
    if (cd.amount <= 0 || !overlaps(bodyBox(body), playerBox)) continue;
    applyDamage(sim, p, {
      amount: cd.amount,
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
