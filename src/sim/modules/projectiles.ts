import { DIR_VEC, overlaps, type Box } from '../../core/math';
import { Body, Facing, Player, Projectile, type ProjectileKind, type TeamId } from '../components';
import { TILE } from '../constants';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import { applyDamage } from './combat';

const LIFETIME = 150;
/**
 * How far above a foe's feet its body reaches, for shots. A body is only its footprint, but a shot flies at bow
 * height and the player aims at the sprite, so a shot through the torso must count.
 */
const SHOT_HURT_HEIGHT = 14;

/** The ground a shot crossed this tick (from where it was to where it is), so a fast one never skips a foe. */
export function shotPath(body: Body, proj: Projectile): Box {
  const px = body.x - proj.vx;
  const py = body.y - proj.vy;
  return {
    x: Math.min(px, body.x) - 1,
    y: Math.min(py, body.y) - 1,
    w: Math.abs(proj.vx) + 2,
    h: Math.abs(proj.vy) + 2,
  };
}

/** Whether a shot's path this tick meets a foe: its footprint, and its body above it. */
export function shotHits(body: Body, proj: Projectile, foe: Body): boolean {
  const hurt = {
    x: foe.x - foe.w / 2,
    y: foe.y - foe.h / 2 - SHOT_HURT_HEIGHT,
    w: foe.w,
    h: foe.h + SHOT_HURT_HEIGHT,
  };
  return overlaps(shotPath(body, proj), hurt);
}
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
    /** Ticks it flies before it falls. */
    life?: number;
    /** For the player's knives: the ability that threw it and how long its hit staggers. */
    ability?: string;
    stagger?: number;
    /** A shot from the player's weapon: whether it was a Perfect Shot, flies through foes, or bursts. */
    perfect?: boolean;
    pierce?: boolean;
    explode?: number;
    /** A foe's shot: the shooter's Power. */
    power?: number;
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
    life: p.life ?? LIFETIME,
    blockable: true,
    ability: p.ability ?? null,
    stagger: p.stagger ?? 0,
    ...(p.perfect !== undefined
      ? {
          bow: {
            perfect: p.perfect,
            hit: [],
            ...(p.pierce ? { pierce: true } : {}),
            ...(p.explode ? { explode: p.explode } : {}),
          },
        }
      : {}),
    ...(p.power === undefined ? {} : { power: p.power }),
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
        ...(proj.power === undefined ? {} : { power: proj.power }),
      });
    }
    ecs.destroy(e);
  }
}

export const projectilesModule: SimModule = {
  id: 'projectiles',
  systems: [{ phase: 'physics', run: updateProjectiles }],
};
