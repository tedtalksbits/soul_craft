import { DIR_VEC } from '../../core/math';
import { Body, Facing, Player, Projectile, type ProjectileKind, type TeamId } from '../components';
import { TILE } from '../constants';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import { applyDamage } from './combat';

const LIFETIME = 150;
const HIT_RADIUS = 7;
/** Cosine of the half-angle within which a ready shield deflects arrows. */
const SHIELD_ARC_COS = 0.5;

export function spawnProjectile(
  sim: Simulation,
  p: {
    kind: ProjectileKind;
    team: TeamId;
    x: number;
    y: number;
    dirX: number;
    dirY: number;
    speed: number;
    damage: number;
  },
): void {
  const e = sim.ecs.create();
  sim.ecs.add(e, Body, { x: p.x, y: p.y, w: 3, h: 3 });
  sim.ecs.add(e, Projectile, {
    kind: p.kind,
    team: p.team,
    damage: p.damage,
    vx: p.dirX * p.speed,
    vy: p.dirY * p.speed,
    life: LIFETIME,
    blockable: true,
  });
}

function updateProjectiles(sim: Simulation): void {
  const { ecs } = sim;
  const pe = sim.player;
  const pb = ecs.need(pe, Body);
  const player = ecs.need(pe, Player);
  const facing = ecs.need(pe, Facing);

  for (const [e, proj, body] of ecs.query(Projectile, Body)) {
    body.x += proj.vx;
    body.y += proj.vy;
    if (
      --proj.life <= 0 ||
      sim.world.blocksProjectiles(Math.floor(body.x / TILE), Math.floor(body.y / TILE))
    ) {
      ecs.destroy(e);
      continue;
    }
    if (proj.team !== 'enemy' || player.state === 'dead') continue;
    if (Math.abs(body.x - pb.x) > HIT_RADIUS || Math.abs(body.y - pb.y) > HIT_RADIUS) continue;

    // A player standing ready turns arrows coming at their face.
    const [fx, fy] = DIR_VEC[facing.dir];
    const speed = Math.hypot(proj.vx, proj.vy) || 1;
    const headOn = (fx * -proj.vx + fy * -proj.vy) / speed > SHIELD_ARC_COS;
    if (proj.blockable && headOn && player.state === 'free') {
      sim.events.emit({ type: 'blocked', x: body.x, y: body.y });
    } else {
      applyDamage(sim, pe, {
        amount: proj.damage,
        crit: false,
        fromX: body.x - proj.vx * 4,
        fromY: body.y - proj.vy * 4,
        knockback: sim.content.player.hurt.knockback,
      });
    }
    ecs.destroy(e);
  }
}

export const projectilesModule: SimModule = {
  id: 'projectiles',
  systems: [{ phase: 'physics', run: updateProjectiles }],
};
