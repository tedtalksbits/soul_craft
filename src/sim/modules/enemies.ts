import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import { dirFromVec } from '../../core/math';
import {
  Ai,
  Body,
  ContactDamage,
  Dying,
  Enemy,
  Facing,
  Health,
  Motion,
  Player,
  Spawned,
  Sprite,
  Team,
} from '../components';
import type { SimCommand, SimModule } from '../module';
import { blockedAt } from '../physics';
import type { Simulation } from '../simulation';
import { runBrain, setAi } from './brains';

export function spawnEnemy(
  sim: Simulation,
  archetype: string,
  x: number,
  y: number,
  spawned?: Spawned,
): Entity {
  const { ecs } = sim;
  const def = sim.content.enemy(archetype);
  const e = ecs.create();
  ecs.add(e, Enemy, { archetype, homeX: x, homeY: y });
  ecs.add(e, Body, { x, y, w: def.body.w, h: def.body.h });
  ecs.add(e, Motion, { vx: 0, vy: 0, kx: 0, ky: 0, hitWall: false });
  ecs.add(e, Facing, { dir: 'down' });
  ecs.add(e, Health, { hp: def.hp, max: def.hp });
  ecs.add(e, Team, { team: 'enemy' });
  ecs.add(e, Ai, {
    state: 'idle',
    t: 0,
    cooldown: sim.rng.int(30, 90),
    dirX: 0,
    dirY: 0,
    wanderTicks: 0,
    wanderX: 0,
    wanderY: 0,
  });
  ecs.add(e, ContactDamage, { amount: def.contactDamage });
  ecs.add(e, Sprite, { sheet: def.sprite });
  if (spawned) ecs.add(e, Spawned, spawned);
  return e;
}

function updateEnemies(sim: Simulation): void {
  const { ecs } = sim;
  const p = sim.player;
  const pb = ecs.need(p, Body);
  const playerDead = ecs.need(p, Player).state === 'dead';

  for (const [e, enemy, ai, body, motion, facing, contact] of ecs.query(
    Enemy,
    Ai,
    Body,
    Motion,
    Facing,
    ContactDamage,
  )) {
    if (ecs.has(e, Dying)) continue;
    const def = sim.content.enemies[enemy.archetype];
    if (!def) continue;
    ai.t++;
    ai.cooldown--;
    motion.vx = motion.vy = 0;

    const dx = pb.x - body.x;
    const dy = pb.y - body.y;
    const dist = Math.hypot(dx, dy) || 1;
    const sees = !playerDead && dist < def.aggroRange;

    if (ai.state === 'recoil') {
      if (ai.t > def.recoilTicks) setAi(ai, 'chase');
      continue;
    }
    runBrain({ sim, e, def, enemy, ai, body, motion, facing, contact, dx, dy, dist, sees });

    // An enemy that can see the player keeps its eyes on them (an archer backing away
    // included); otherwise it faces where it is going.
    if (sees) facing.dir = dirFromVec(dx, dy, facing.dir);
    else if (Math.abs(motion.vx) + Math.abs(motion.vy) > 0.05) {
      facing.dir = dirFromVec(motion.vx, motion.vy, facing.dir);
    }
  }
}

const commands: SimCommand[] = [
  {
    name: 'spawn',
    description: 'Spawn enemies in a ring around the player.',
    args: [
      { name: 'archetype', type: 'string', options: ({ sim }) => Object.keys(sim.content.enemies) },
      { name: 'count', type: 'number', integer: true, optional: true },
      { name: 'distance', type: 'number', optional: true },
    ],
    run: ({ sim }, a) => {
      const archetype = a.string('archetype');
      const count = a.optNumber('count') ?? 1;
      const distance = a.optNumber('distance') ?? 48;
      if (count < 1 || count > 200) throw new CommandError('count must be 1-200');
      const pb = sim.ecs.need(sim.player, Body);
      const def = sim.content.enemy(archetype);
      let placed = 0;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        const x = pb.x + Math.cos(angle) * distance;
        const y = pb.y + Math.sin(angle) * distance;
        if (blockedAt(sim.world, { x, y, w: def.body.w, h: def.body.h }, x, y)) continue;
        spawnEnemy(sim, archetype, x, y);
        placed++;
      }
      return `spawned ${placed}/${count} ${archetype}`;
    },
  },
  {
    name: 'clear',
    aliases: ['killall'],
    description: 'Remove every enemy in the loaded world (no souls awarded).',
    run: ({ sim }) => {
      let n = 0;
      for (const [e] of sim.ecs.query(Enemy)) {
        sim.ecs.destroy(e);
        n++;
      }
      return `removed ${n} enemies`;
    },
  },
];

export const enemiesModule: SimModule = {
  id: 'enemies',
  systems: [{ phase: 'ai', run: updateEnemies }],
  commands,
};
