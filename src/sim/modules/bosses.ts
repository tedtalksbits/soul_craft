/**
 * Boss fights. Walking into a living boss's arena starts the fight, and the
 * player is held inside it (the fog gate) until the boss dies or they do.
 * While the boss is shielded (see `raiseShield` in combat.ts) it calls adds,
 * and standing on every brazier in the arena breaks the shield and staggers it.
 * The boss's own moves are its brain (brains.ts); its defeat is in killEnemy.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import { Ai, Body, Boss, Brazier, Dying, Enemy, Health, Minion, Player, Staggered } from '../components';
import { TILE } from '../constants';
import type { SimCommand, SimModule } from '../module';
import { blockedAt } from '../physics';
import type { Simulation } from '../simulation';
import type { BossFight } from '../state';
import { setAi } from './brains';
import { spawnEnemy } from './enemies';

/** How close (px) the player's feet must come to a brazier's center to light it. */
const BRAZIER_REACH = 10;
/** Adds are never called closer than this (px) to the player. */
const ADD_MIN_DISTANCE = 48;

/** The living boss of the current fight, or of the given archetype. */
export function bossEntity(sim: Simulation, archetype?: string): Entity | undefined {
  const want = archetype ?? sim.state.bossFight?.boss;
  for (const [e, , enemy] of sim.ecs.query(Boss, Enemy)) {
    if (enemy.archetype === want && !sim.ecs.has(e, Dying)) return e;
  }
  return undefined;
}

const inArena = (fight: Omit<BossFight, 'boss'>, x: number, y: number) =>
  Math.abs(x - fight.x) <= fight.half && Math.abs(y - fight.y) <= fight.half;

/** The braziers inside the current fight's arena. */
function arenaBraziers(sim: Simulation): { brazier: Brazier; body: Body }[] {
  const fight = sim.state.bossFight;
  if (!fight) return [];
  return [...sim.ecs.query(Brazier, Body)]
    .filter(([, , b]) => inArena(fight, b.x, b.y))
    .map(([, brazier, body]) => ({ brazier, body }));
}

/** Starts a fight when the player steps into a living boss's arena; ends it if they die. */
function updateFight(sim: Simulation): void {
  const { ecs } = sim;
  const p = ecs.need(sim.player, Player);
  const pb = ecs.need(sim.player, Body);
  if (sim.state.bossFight) {
    if (p.state === 'dead') endFight(sim);
    return;
  }
  if (p.state === 'dead') return;
  for (const [e, , enemy] of ecs.query(Boss, Enemy)) {
    const def = sim.content.enemies[enemy.archetype];
    if (!def?.boss || ecs.has(e, Dying)) continue;
    const half = def.boss.arenaTiles * TILE;
    // Fully inside, so the gate closes behind the player rather than on them.
    if (!inArena({ x: enemy.homeX, y: enemy.homeY, half: half - pb.h }, pb.x, pb.y)) continue;
    sim.state.bossFight = { boss: enemy.archetype, x: enemy.homeX, y: enemy.homeY, half };
    for (const { brazier } of arenaBraziers(sim)) brazier.lit = false;
    sim.events.emit({ type: 'bossFightStarted', boss: enemy.archetype });
    return;
  }
}

/** Ends a fight the player lost. Respawning resets every enemy, so the boss returns whole. */
function endFight(sim: Simulation): void {
  const fight = sim.state.bossFight;
  if (!fight) return;
  for (const { brazier } of arenaBraziers(sim)) brazier.lit = false;
  sim.state.bossFight = null;
  sim.events.emit({ type: 'bossFightEnded', boss: fight.boss });
}

/** The fog gate: while a fight is on, the player, the boss and its adds stay inside the arena. */
function confine(sim: Simulation): void {
  const fight = sim.state.bossFight;
  if (!fight) return;
  const held: Entity[] = [sim.player];
  for (const [e] of sim.ecs.query(Boss)) held.push(e);
  for (const [e] of sim.ecs.query(Minion)) held.push(e);
  for (const e of held) {
    const b = sim.ecs.get(e, Body);
    if (!b) continue;
    const hw = fight.half - b.w / 2;
    const hh = fight.half - b.h / 2;
    b.x = Math.min(Math.max(b.x, fight.x - hw), fight.x + hw);
    b.y = Math.min(Math.max(b.y, fight.y - hh), fight.y + hh);
  }
}

/** While shielded: braziers light underfoot, adds are called, and all lit breaks the shield. */
function updateShield(sim: Simulation): void {
  const fight = sim.state.bossFight;
  const e = bossEntity(sim);
  if (!fight || e === undefined) return;
  const { ecs } = sim;
  const boss = ecs.need(e, Boss);
  const enemy = ecs.need(e, Enemy);
  const def = sim.content.enemy(enemy.archetype);
  if (!boss.shielded || def.brain.type !== 'warden') return;

  const pb = ecs.need(sim.player, Body);
  const braziers = arenaBraziers(sim);
  for (const { brazier, body } of braziers) {
    if (brazier.lit || Math.hypot(body.x - pb.x, body.y - pb.y) > BRAZIER_REACH) continue;
    brazier.lit = true;
    const left = braziers.filter((b) => !b.brazier.lit).length;
    sim.events.emit({ type: 'brazierLit', x: body.x, y: body.y, left });
  }
  if (braziers.every((b) => b.brazier.lit)) {
    boss.shielded = false;
    ecs.add(e, Staggered, { ticks: def.brain.staggerTicks });
    setAi(ecs.need(e, Ai), 'chase');
    sim.events.emit({ type: 'bossShieldBroken', boss: enemy.archetype });
    return;
  }

  const adds = def.brain.adds;
  if (--boss.addTimer > 0) return;
  boss.addTimer = adds.every;
  const alive = [...ecs.query(Minion)].filter(([m]) => !ecs.has(m, Dying)).length;
  if (alive >= adds.max) return;
  const add = sim.content.enemy(adds.archetype);
  // Somewhere in the arena, away from the player, on open ground.
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = fight.x + sim.rng.range(-0.8, 0.8) * fight.half;
    const y = fight.y + sim.rng.range(-0.8, 0.8) * fight.half;
    if (Math.hypot(x - pb.x, y - pb.y) < ADD_MIN_DISTANCE) continue;
    if (blockedAt(sim.world, { x, y, w: add.body.w, h: add.body.h }, x, y)) continue;
    const m = spawnEnemy(sim, adds.archetype, x, y);
    ecs.add(m, Minion, {});
    // Called to fight: it comes straight for the player.
    setAi(ecs.need(m, Ai), 'chase');
    return;
  }
}

const bossOptions = ({ sim }: { sim: Simulation }) =>
  Object.entries(sim.content.enemies)
    .filter(([, d]) => d.boss)
    .map(([id]) => id);

const commands: SimCommand[] = [
  {
    name: 'boss',
    description: "Teleport to the gate of a boss's arena.",
    args: [{ name: 'boss', type: 'string', options: bossOptions }],
    run: ({ sim }, a) => {
      const id = a.string('boss');
      for (const p of sim.world.gen.fixedPlacements()) {
        const holds = Object.values(p.prefab.legend).some(
          (l) => l.entity?.kind === 'enemy' && l.entity.archetype === id,
        );
        if (!holds) continue;
        const pb = sim.ecs.need(sim.player, Body);
        pb.x = (p.x0 + p.w / 2) * TILE;
        pb.y = (p.y0 + p.h) * TILE - TILE * 2;
        return `moved to ${p.prefab.name ?? p.id}`;
      }
      throw new CommandError(`no fixed arena holds ${id}`);
    },
  },
  {
    name: 'bossreset',
    description: 'Forget every defeated boss (each returns when its arena next loads).',
    run: ({ sim }) => {
      sim.state.bossesDefeated = {};
      return 'bosses forgotten';
    },
  },
  {
    name: 'bosshp',
    description: 'Set the fighting boss to a fraction of its health (e.g. 0.7), to test phases.',
    args: [{ name: 'fraction', type: 'number' }],
    run: ({ sim }, a) => {
      const e = bossEntity(sim);
      if (e === undefined) throw new CommandError('no boss fight is on');
      const h = sim.ecs.need(e, Health);
      h.hp = Math.max(1, Math.round(h.max * a.number('fraction')));
      return `boss at ${h.hp}/${h.max}`;
    },
  },
];

export const bossesModule: SimModule = {
  id: 'bosses',
  systems: [
    { phase: 'control', run: updateFight },
    { phase: 'ai', run: updateShield },
    { phase: 'physics', run: confine },
  ],
  commands,
};
