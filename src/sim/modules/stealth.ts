/**
 * The Stalker's tricks: decoys enemies chase instead of the player, and the veil that hides the
 * player until they strike (with a bonus on that first hit). Enemies ask {@link enemyTarget} what
 * to go after; combat asks {@link takeAmbush} for the bonus.
 */
import type { EnemyDef } from '../../content/schemas';
import { Ai, Ambush, Body, Decoy, Dying, Enemy, Facing, Player, Sprite, Veiled } from '../components';
import { TICK_RATE } from '../constants';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import { activeEffects, ambushBonus } from './modifiers';

/** How close an enemy must be to notice a veiled player anyway: close enough to touch. */
const VEIL_REVEAL = 18;
/** How long after breaking the veil the first hit still counts as an ambush. */
const AMBUSH_TICKS = 30;

export function spawnDecoy(sim: Simulation, x: number, y: number, seconds: number): void {
  const e = sim.ecs.create();
  sim.ecs.add(e, Body, { x, y, w: 8, h: 6 });
  sim.ecs.add(e, Facing, { dir: sim.ecs.need(sim.player, Facing).dir });
  sim.ecs.add(e, Decoy, { ticks: Math.round(seconds * TICK_RATE) });
  sim.ecs.add(e, Sprite, { sheet: 'player' });
}

export function veil(sim: Simulation, seconds: number, bonus: number): void {
  const ticks = Math.round(seconds * TICK_RATE);
  sim.ecs.remove(sim.player, Ambush);
  const strikes = Math.max(1, ...activeEffects(sim, 'vanishStrikes').map((fx) => fx.strikes));
  sim.ecs.add(sim.player, Veiled, {
    ticks,
    bonus: bonus + ambushBonus(sim),
    armed: false,
    ...(strikes > 1 ? { strikesLeft: strikes } : {}),
  });
  sim.events.emit({ type: 'veiled', seconds });
}

/** Ends the veil without an ambush (the player was hit, or rested). */
export function unveil(sim: Simulation): void {
  if (!sim.ecs.has(sim.player, Veiled)) return;
  sim.ecs.remove(sim.player, Veiled);
  sim.events.emit({ type: 'unveiled' });
}

/** The bonus for the hit being dealt now, if it is an ambush; it is used up. */
export function takeAmbush(sim: Simulation): number {
  const ambush = sim.ecs.get(sim.player, Ambush);
  if (!ambush) return 0;
  sim.ecs.remove(sim.player, Ambush);
  return ambush.bonus;
}

export interface Target {
  x: number;
  y: number;
  /** Whether the enemy notices it (in range, and not hidden). */
  sees: boolean;
}

/**
 * What an enemy goes after: the nearest decoy it can see, else the player, unless the player is
 * dead or veiled and not right beside it. Bosses always go after the player.
 */
export function enemyTarget(sim: Simulation, def: EnemyDef, body: Body): Target {
  const { ecs } = sim;
  const pb = ecs.need(sim.player, Body);
  if (!def.boss) {
    let best: Body | undefined;
    let bestDist = def.aggroRange;
    for (const [, , db] of ecs.query(Decoy, Body)) {
      const d = Math.hypot(db.x - body.x, db.y - body.y);
      if (d < bestDist) [best, bestDist] = [db, d];
    }
    if (best) return { x: best.x, y: best.y, sees: true };
  }
  const dist = Math.hypot(pb.x - body.x, pb.y - body.y);
  const dead = ecs.need(sim.player, Player).state === 'dead';
  const hidden = ecs.has(sim.player, Veiled) && dist > VEIL_REVEAL;
  return { x: pb.x, y: pb.y, sees: !dead && !hidden && dist < def.aggroRange };
}

/**
 * Whether anything is after the player: a living enemy, awake, that can see them. Resting and changing gear wait
 * until it is not, so a bonfire or the pack is never an escape from a fight.
 */
export function pursued(sim: Simulation): boolean {
  for (const [e, enemy, ai, body] of sim.ecs.query(Enemy, Ai, Body)) {
    if (sim.ecs.has(e, Dying) || ai.state === 'dormant') continue;
    const def = sim.content.enemies[enemy.archetype];
    if (def && enemyTarget(sim, def, body).sees) return true;
  }
  return false;
}

function tick(sim: Simulation): void {
  const { ecs } = sim;
  for (const [e, decoy] of ecs.query(Decoy)) {
    if (--decoy.ticks > 0) continue;
    const b = ecs.need(e, Body);
    sim.events.emit({ type: 'decoyFaded', x: b.x, y: b.y });
    ecs.destroy(e);
  }
  const p = sim.player;
  const player = ecs.get(p, Player);
  const veiled = ecs.get(p, Veiled);
  if (player && veiled) {
    const striking = player.state === 'attack' || player.state === 'cast';
    if (veiled.armed && striking && (veiled.strikesLeft ?? 1) > 1) {
      // A veil that lasts through more strikes: this one is an ambush, and the veil holds.
      veiled.strikesLeft = (veiled.strikesLeft ?? 1) - 1;
      veiled.armed = false;
      ecs.add(p, Ambush, { ticks: AMBUSH_TICKS, bonus: veiled.bonus });
    } else if (veiled.armed && striking) {
      ecs.remove(p, Veiled);
      ecs.add(p, Ambush, { ticks: AMBUSH_TICKS, bonus: veiled.bonus });
      sim.events.emit({ type: 'unveiled' });
    } else if (--veiled.ticks <= 0) unveil(sim);
    else if (!striking) veiled.armed = true;
  }
  const ambush = ecs.get(p, Ambush);
  if (ambush && --ambush.ticks <= 0) ecs.remove(p, Ambush);
}

/** Resting clears decoys and the veil. */
export function clearStealth(sim: Simulation): void {
  for (const [e] of sim.ecs.query(Decoy)) sim.ecs.destroy(e);
  sim.ecs.remove(sim.player, Veiled);
  sim.ecs.remove(sim.player, Ambush);
}

// After the player acts (control), so an attack started this tick breaks the veil before it lands (combat).
export const stealthModule: SimModule = { id: 'stealth', systems: [{ phase: 'ai', run: tick }] };
