/**
 * Enemy brains. Each is a small state machine over the shared `Ai` component,
 * parameterized entirely by its content definition. The state names here are
 * also what the renderer uses to pick animations and telegraphs, and what the
 * AI debug overlay prints.
 */
import type { BrainDef, EnemyDef } from '../../content/schemas';
import type { Entity } from '../../core/ecs';
import { dirFromVec } from '../../core/math';
import type { Ai, Body, ContactDamage, Enemy, Facing, Motion } from '../components';
import type { Simulation } from '../simulation';
import { applyDamage } from './combat';
import { spawnProjectile } from './projectiles';

export interface BrainContext {
  sim: Simulation;
  e: Entity;
  def: EnemyDef;
  enemy: Enemy;
  ai: Ai;
  body: Body;
  motion: Motion;
  facing: Facing;
  contact: ContactDamage;
  /** Vector and distance to the player. */
  dx: number;
  dy: number;
  dist: number;
  sees: boolean;
}

type Brain<T extends BrainDef['type']> = (c: BrainContext, b: Extract<BrainDef, { type: T }>) => void;

/** Enemy states during which the renderer flashes a warning. */
export const TELEGRAPH_STATES: ReadonlySet<string> = new Set(['windup', 'draw', 'raise']);

/** Distance from home before a wandering enemy turns back. */
const LEASH = 50;
const WANDER_SPEED = 0.35;

export function runBrain(c: BrainContext): void {
  const brain = c.def.brain;
  switch (brain.type) {
    case 'hopper':
      return hopper(c, brain);
    case 'lunger':
      return lunger(c, brain);
    case 'archer':
      return archer(c, brain);
    case 'shieldKnight':
      return shieldKnight(c, brain);
    case 'warden':
      return warden(c, brain);
  }
}

export function setAi(ai: Ai, state: string): void {
  ai.state = state;
  ai.t = 0;
}

function moveToward(c: BrainContext, speed: number): void {
  c.motion.vx = (c.dx / c.dist) * speed;
  c.motion.vy = (c.dy / c.dist) * speed;
}

/**
 * Chase the player but stop once touching them. Walking on towards their exact
 * position overshoots every tick and flips the enemy left-right in place.
 */
function closeIn(c: BrainContext): void {
  const touching = (c.body.w + c.sim.content.player.body.w) / 2;
  if (c.dist > touching) moveToward(c, c.def.speed);
  else facePlayer(c);
}

function facePlayer(c: BrainContext): void {
  c.facing.dir = dirFromVec(c.dx, c.dy, c.facing.dir);
}

function wander(c: BrainContext): void {
  const { ai, sim, body, enemy } = c;
  if (--ai.wanderTicks <= 0) {
    ai.wanderTicks = sim.rng.int(60, 140);
    if (sim.rng.chance(0.4)) ai.wanderX = ai.wanderY = 0;
    else {
      const a = sim.rng.range(0, Math.PI * 2);
      ai.wanderX = Math.cos(a) * WANDER_SPEED;
      ai.wanderY = Math.sin(a) * WANDER_SPEED;
    }
  }
  const hx = enemy.homeX - body.x;
  const hy = enemy.homeY - body.y;
  const away = Math.hypot(hx, hy);
  if (away > LEASH) {
    ai.wanderX = (hx / away) * WANDER_SPEED * 1.2;
    ai.wanderY = (hy / away) * WANDER_SPEED * 1.2;
  }
  c.motion.vx = ai.wanderX;
  c.motion.vy = ai.wanderY;
}

/** Slimes: periodic hops, toward the player when they can see them. */
const hopper: Brain<'hopper'> = (c, b) => {
  const { ai, sim } = c;
  c.contact.amount = c.def.contactDamage;
  if (ai.state === 'hop') {
    // Crouch in place first (the sprite's squash frame), then fly for hopTicks.
    if (ai.t <= b.crouchTicks) return;
    if (ai.t <= b.crouchTicks + b.hopTicks) {
      c.motion.vx = ai.dirX;
      c.motion.vy = ai.dirY;
    } else setAi(ai, 'idle');
    return;
  }
  if (ai.cooldown > 0) return;
  if (c.sees) {
    ai.dirX = (c.dx / c.dist) * b.hopSpeed;
    ai.dirY = (c.dy / c.dist) * b.hopSpeed;
    ai.cooldown = sim.rng.range(b.hopCooldown[0], b.hopCooldown[1]);
  } else {
    const a = sim.rng.range(0, Math.PI * 2);
    ai.dirX = Math.cos(a) * b.hopSpeed * 0.5;
    ai.dirY = Math.sin(a) * b.hopSpeed * 0.5;
    ai.cooldown = b.hopCooldown[1] * 1.3;
  }
  setAi(ai, 'hop');
};

/** Hollows: close in, wind up, lunge, recover. */
const lunger: Brain<'lunger'> = (c, b) => {
  const { ai } = c;
  switch (ai.state) {
    case 'windup':
      c.contact.amount = 0;
      facePlayer(c);
      if (ai.t >= b.windupTicks) {
        ai.dirX = c.dx / c.dist;
        ai.dirY = c.dy / c.dist;
        setAi(ai, 'lunge');
        c.sim.events.emit({ type: 'enemyAttack', entity: c.e, kind: 'lunge' });
      }
      return;
    case 'lunge':
      c.motion.vx = ai.dirX * b.lungeSpeed;
      c.motion.vy = ai.dirY * b.lungeSpeed;
      c.contact.amount = b.lungeDamage;
      if (ai.t >= b.lungeTicks) {
        setAi(ai, 'chase');
        ai.cooldown = b.cooldown;
      }
      return;
    default:
      c.contact.amount = c.def.contactDamage;
      if (!c.sees) {
        ai.state = 'idle';
        wander(c);
      } else if (c.dist < b.range && ai.cooldown <= 0) setAi(ai, 'windup');
      else {
        ai.state = 'chase';
        closeIn(c);
      }
  }
};

/** Archers: hold a preferred distance facing the player, draw, loose an arrow, recover. */
const archer: Brain<'archer'> = (c, b) => {
  const { ai, sim } = c;
  c.contact.amount = c.def.contactDamage;
  if (ai.state === 'draw') {
    facePlayer(c);
    if (ai.t >= b.drawTicks) {
      spawnProjectile(sim, {
        kind: 'arrow',
        team: 'enemy',
        x: c.body.x,
        y: c.body.y,
        dirX: c.dx / c.dist,
        dirY: c.dy / c.dist,
        speed: b.arrowSpeed,
        damage: b.arrowDamage,
      });
      sim.events.emit({ type: 'enemyAttack', entity: c.e, kind: 'shoot' });
      setAi(ai, 'loose');
    }
    return;
  }
  if (ai.state === 'loose') {
    facePlayer(c);
    if (ai.t >= b.looseTicks) setAi(ai, 'chase');
    return;
  }
  if (!c.sees) {
    ai.state = 'idle';
    wander(c);
    return;
  }
  ai.state = 'chase';
  const [near, far] = b.preferredRange;
  moveToward(c, c.def.speed * (c.dist < near ? -1 : c.dist > far ? 1 : 0));
  if (ai.cooldown <= 0) {
    setAi(ai, 'draw');
    ai.cooldown = sim.rng.range(b.cooldown[0], b.cooldown[1]);
  }
};

/**
 * Shield knights: the shield blocks every blow (see combat.ts) except while
 * charging or stunned. Baiting the charge into a wall is how you beat them.
 */
const shieldKnight: Brain<'shieldKnight'> = (c, b) => {
  const { ai } = c;
  switch (ai.state) {
    case 'stunned':
      c.contact.amount = 0;
      if (ai.t >= b.stunTicks) {
        setAi(ai, 'chase');
        ai.cooldown = b.cooldown;
      }
      return;
    case 'windup':
      c.contact.amount = c.def.contactDamage;
      facePlayer(c);
      if (ai.t >= b.windupTicks) {
        ai.dirX = c.dx / c.dist;
        ai.dirY = c.dy / c.dist;
        setAi(ai, 'charge');
        c.sim.events.emit({ type: 'enemyAttack', entity: c.e, kind: 'charge' });
      }
      return;
    case 'charge': {
      c.motion.vx = ai.dirX * b.chargeSpeed;
      c.motion.vy = ai.dirY * b.chargeSpeed;
      c.contact.amount = b.chargeDamage;
      const slammed = c.motion.hitWall && ai.t > 1;
      if (slammed || ai.t >= b.chargeTicks) {
        setAi(ai, 'stunned');
        if (slammed) c.sim.events.emit({ type: 'wallSlam', x: c.body.x, y: c.body.y });
      }
      return;
    }
    default:
      c.contact.amount = c.def.contactDamage;
      if (!c.sees) {
        ai.state = 'idle';
        wander(c);
      } else if (ai.cooldown <= 0 && c.dist < b.chargeRange) setAi(ai, 'windup');
      else {
        ai.state = 'chase';
        closeIn(c);
      }
  }
};

/**
 * The Ashen Warden. Dormant until its fight starts, then it alternates a slam (raise its weapon,
 * then a ring of damage around it, then the landing pose) when close with a charge when far, each
 * followed by a recovery window to punish. While shielded it walks back to the arena's center and channels; the bosses
 * module calls its adds and breaks the shield.
 */
const warden: Brain<'warden'> = (c, b) => {
  const { ai, sim, enemy } = c;
  const fighting = sim.state.bossFight?.boss === enemy.archetype;
  c.contact.amount = c.def.contactDamage;
  if (!fighting) {
    c.contact.amount = 0;
    setAi(ai, 'dormant');
    return;
  }
  switch (ai.state) {
    case 'dormant':
      setAi(ai, 'chase');
      ai.cooldown = b.cooldown[1];
      return;
    case 'channel': {
      const hx = enemy.homeX - c.body.x;
      const hy = enemy.homeY - c.body.y;
      const away = Math.hypot(hx, hy);
      if (away > 2) {
        c.motion.vx = (hx / away) * c.def.speed;
        c.motion.vy = (hy / away) * c.def.speed;
      } else facePlayer(c);
      return;
    }
    case 'raise':
      facePlayer(c);
      if (ai.t >= b.slamWindupTicks) {
        sim.events.emit({ type: 'bossSlam', x: c.body.x, y: c.body.y, radius: b.slamRadius });
        if (c.dist <= b.slamRadius)
          applyDamage(sim, sim.player, {
            amount: b.slamDamage,
            crit: false,
            fromX: c.body.x,
            fromY: c.body.y,
            knockback: sim.content.player.hurt.knockback * 2,
          });
        setAi(ai, 'slam');
      }
      return;
    case 'slam':
      c.contact.amount = 0;
      if (ai.t >= b.slamTicks) setAi(ai, 'recover');
      return;
    case 'windup':
      facePlayer(c);
      if (ai.t >= b.chargeWindupTicks) {
        ai.dirX = c.dx / c.dist;
        ai.dirY = c.dy / c.dist;
        setAi(ai, 'charge');
        sim.events.emit({ type: 'enemyAttack', entity: c.e, kind: 'charge' });
      }
      return;
    case 'charge': {
      c.motion.vx = ai.dirX * b.chargeSpeed;
      c.motion.vy = ai.dirY * b.chargeSpeed;
      c.contact.amount = b.chargeDamage;
      const slammed = c.motion.hitWall && ai.t > 1;
      if (slammed || ai.t >= b.chargeTicks) {
        setAi(ai, 'recover');
        if (slammed) sim.events.emit({ type: 'wallSlam', x: c.body.x, y: c.body.y });
      }
      return;
    }
    case 'recover':
      c.contact.amount = 0;
      if (ai.t >= b.recoverTicks) {
        setAi(ai, 'chase');
        ai.cooldown = sim.rng.range(b.cooldown[0], b.cooldown[1]);
      }
      return;
    default:
      if (ai.cooldown <= 0 && c.dist < b.slamRange) setAi(ai, 'raise');
      else if (ai.cooldown <= 0 && c.dist < b.chargeRange && c.dist > b.slamRange * 2) setAi(ai, 'windup');
      else {
        ai.state = 'chase';
        closeIn(c);
      }
  }
};
