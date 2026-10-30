/**
 * Player controller: a small state machine (free, attack, roll, hurt, drink,
 * sit, dead) driven by InputFrames, with stamina gating and input buffering
 * so a press slightly before recovery ends still comes out.
 */
import type { Entity } from '../../core/ecs';
import { DIR_VEC, dirFromVec, lerp, normalize, overlaps, type Box } from '../../core/math';
import { CommandError } from '../../core/commands';
import {
  Body,
  Dying,
  Enemy,
  Equipment,
  Facing,
  Health,
  Invulnerable,
  Motion,
  Player,
  Projectile,
  Sprite,
  Stamina,
  Team,
} from '../components';
import { TILE } from '../constants';
import { Action } from '../input';
import type { SimCommand, SimModule } from '../module';
import { bodyBox } from '../physics';
import type { Simulation } from '../simulation';
import { pressedSlot, refreshAbilities, giveStartingClass, startCast, updateCast } from './abilities';
import { applyDamage, rollDamage } from './combat';
import { giveStartingAttributes } from './progression';
import { interact } from './interaction';
import { beginUse, finishUse, giveStartingKit, playerStats } from './items';
import { resetEnemies } from './streaming';
import { strikeTiles } from './terrain';

/** How long an early attack/roll press is remembered. */
const BUFFER_TICKS = 12;
/** Grace period after respawning. */
const RESPAWN_IFRAMES = 60;
/** Respawn this far below the bonfire so the player is not standing in it. */
export const RESPAWN_OFFSET_Y = 16;

export function spawnPlayer(sim: Simulation, x: number, y: number, playerClass?: string): Entity {
  const { ecs } = sim;
  const def = sim.content.player;
  const e = ecs.create();
  ecs.add(e, Player, {
    state: 'free',
    t: 0,
    dirX: 0,
    dirY: 1,
    struck: [],
    buffered: null,
    souls: 0,
    flasks: def.flask.charges,
    maxFlasks: def.flask.charges,
    using: null,
  });
  ecs.add(e, Body, { x, y, w: def.body.w, h: def.body.h });
  ecs.add(e, Motion, { vx: 0, vy: 0, kx: 0, ky: 0, hitWall: false });
  ecs.add(e, Facing, { dir: 'down' });
  ecs.add(e, Health, { hp: def.maxHp, max: def.maxHp });
  ecs.add(e, Stamina, { value: def.maxStamina, max: def.maxStamina, delay: 0 });
  ecs.add(e, Team, { team: 'player' });
  ecs.add(e, Sprite, { sheet: def.sprite });
  giveStartingKit(sim, e);
  giveStartingClass(sim, e, playerClass);
  giveStartingAttributes(sim, e);
  return e;
}

/** The sword's hit box while a swing is active, else null. Exposed for debug overlays. */
export function attackBox(sim: Simulation, e: Entity): Box | null {
  const p = sim.ecs.get(e, Player);
  const body = sim.ecs.get(e, Body);
  if (!p || !body || p.state !== 'attack') return null;
  const a = sim.content.player.attack;
  if (p.t < a.activeFrom || p.t > a.activeTo) return null;
  const { reach, width } = playerStats(sim, e);
  const ax = Math.abs(p.dirX);
  const ay = Math.abs(p.dirY);
  const w = ax * reach + ay * width;
  const h = ax * width + ay * reach;
  const cx = body.x + p.dirX * (body.w / 2 + reach / 2);
  const cy = body.y + p.dirY * (body.h / 2 + reach / 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function updatePlayer(sim: Simulation): void {
  const { ecs, input } = sim;
  const def = sim.content.player;
  const e = sim.player;
  const p = ecs.need(e, Player);
  const motion = ecs.need(e, Motion);
  const facing = ecs.need(e, Facing);
  const stamina = ecs.need(e, Stamina);
  const health = ecs.need(e, Health);

  p.t++;
  if (stamina.delay > 0) stamina.delay--;
  else if (p.state !== 'roll' && p.state !== 'attack')
    stamina.value = Math.min(stamina.max, stamina.value + playerStats(sim, e).staminaRegen);

  if (p.state === 'dead') {
    motion.vx = motion.vy = 0;
    if (p.t >= def.death.respawnDelay) respawnPlayer(sim);
    return;
  }

  let [mx, my] = [input.moveX, input.moveY];
  if (Math.hypot(mx, my) > 1) [mx, my] = normalize(mx, my);

  if (p.state !== 'free') {
    const early = input.pressed & (Action.attack | Action.roll);
    if (early) p.buffered = { action: early & Action.roll ? Action.roll : Action.attack, age: 0 };
  }
  if (p.buffered && ++p.buffered.age > BUFFER_TICKS) p.buffered = null;

  switch (p.state) {
    case 'free': {
      if (mx || my) facing.dir = dirFromVec(mx, my, facing.dir);
      motion.vx = mx * def.moveSpeed;
      motion.vy = my * def.moveSpeed;
      let act = input.pressed;
      if (p.buffered) {
        act |= p.buffered.action;
        p.buffered = null;
      }
      const slot = pressedSlot(act);
      if (slot) startCast(sim, slot);
      else if (act & Action.attack && stamina.value > 0) startAttack(sim, e, p, facing, stamina);
      else if (act & Action.roll && stamina.value >= def.roll.minStamina)
        startRoll(sim, p, facing, stamina, mx, my);
      else if (act & Action.heal) startDrink(sim, p);
      else if (act & Action.item) useQuickItem(sim);
      else if (act & Action.use) interact(sim);
      break;
    }
    case 'attack':
      motion.vx *= 0.6;
      motion.vy *= 0.6;
      if (p.t >= def.attack.activeFrom && p.t <= def.attack.activeTo) strike(sim, e, p);
      if (p.t >= def.attack.duration) setState(p, 'free');
      break;
    case 'roll': {
      const speed = lerp(def.roll.speed, def.moveSpeed * 0.75, p.t / def.roll.duration);
      motion.vx = p.dirX * speed;
      motion.vy = p.dirY * speed;
      if (p.t === def.roll.iframesFrom) {
        // One window covering the rest of the i-frames; never shortens an existing grace period.
        const ticks = def.roll.iframesTo - def.roll.iframesFrom + 1;
        const inv = ecs.get(e, Invulnerable);
        if (!inv) ecs.add(e, Invulnerable, { ticks });
        else inv.ticks = Math.max(inv.ticks, ticks);
      }
      if (p.t >= def.roll.duration) setState(p, 'free');
      break;
    }
    case 'hurt':
      motion.vx = motion.vy = 0;
      if (p.t >= def.hurt.stun) setState(p, 'free');
      break;
    case 'drink':
      motion.vx = mx * def.moveSpeed * 0.3;
      motion.vy = my * def.moveSpeed * 0.3;
      if (p.t === def.flask.healAt) {
        if (p.using !== null) finishUse(sim, e, p.using);
        else {
          const healed = Math.min(health.max - health.hp, def.flask.heal);
          health.hp += healed;
          sim.events.emit({ type: 'healed', amount: healed });
        }
      }
      if (p.t >= def.flask.duration) {
        p.using = null;
        setState(p, 'free');
      }
      break;
    case 'sit':
      motion.vx = motion.vy = 0;
      if (mx || my || input.pressed & Action.use) setState(p, 'free');
      break;
    case 'cast':
      updateCast(sim);
      break;
  }
}

function setState(p: Player, state: Player['state']): void {
  p.state = state;
  p.t = 0;
}

function startAttack(sim: Simulation, e: Entity, p: Player, facing: Facing, stamina: Stamina): void {
  const def = sim.content.player;
  const body = sim.ecs.need(e, Body);
  const aim = sim.input.aim;
  const [dx, dy] = aim ? normalize(aim.x - body.x, aim.y - body.y) : DIR_VEC[facing.dir];
  if (dx || dy) {
    p.dirX = dx;
    p.dirY = dy;
    facing.dir = dirFromVec(dx, dy, facing.dir);
  } else [p.dirX, p.dirY] = DIR_VEC[facing.dir];
  stamina.value -= playerStats(sim, e).staminaCost;
  stamina.delay = def.staminaRegenDelay;
  p.struck = [];
  setState(p, 'attack');
  sim.events.emit({ type: 'swing', x: body.x, y: body.y, dirX: p.dirX, dirY: p.dirY });
}

function startRoll(
  sim: Simulation,
  p: Player,
  facing: Facing,
  stamina: Stamina,
  mx: number,
  my: number,
): void {
  const def = sim.content.player;
  [p.dirX, p.dirY] = mx || my ? normalize(mx, my) : DIR_VEC[facing.dir];
  stamina.value -= def.roll.staminaCost;
  stamina.delay = def.staminaRegenDelay;
  setState(p, 'roll');
  sim.events.emit({ type: 'roll' });
}

function startDrink(sim: Simulation, p: Player): void {
  if (p.flasks <= 0) {
    sim.events.emit({ type: 'flaskEmpty' });
    return;
  }
  p.flasks--;
  p.using = null;
  setState(p, 'drink');
}

/** Drinks/applies the consumable in the quick slot, if any are left. */
function useQuickItem(sim: Simulation): void {
  const quick = sim.ecs.need(sim.player, Equipment).quick;
  if (quick !== null) beginUse(sim, quick);
}

function strike(sim: Simulation, e: Entity, p: Player): void {
  const { ecs } = sim;
  const box = attackBox(sim, e);
  if (!box) return;
  const def = sim.content.player;
  const body = ecs.need(e, Body);
  const stats = playerStats(sim, e);

  for (const [target, , tb] of ecs.query(Enemy, Body, Health)) {
    if (p.struck.includes(target) || ecs.has(target, Dying) || !overlaps(box, bodyBox(tb))) continue;
    p.struck.push(target);
    const roll = rollDamage(sim.rng, { ...def.attack, damage: stats.damage, critChance: stats.critChance });
    const result = applyDamage(sim, target, {
      ...roll,
      fromX: body.x,
      fromY: body.y,
      knockback: stats.knockback,
      charges: true,
    });
    if (result === 'hit') sim.hitstop = Math.max(sim.hitstop, def.attack.hitstop);
    if (result === 'blocked') {
      // Bounced off a shield: a short stagger and a shove back.
      const motion = ecs.need(e, Motion);
      const [nx, ny] = normalize(body.x - tb.x, body.y - tb.y);
      motion.kx = nx * 2.5;
      motion.ky = ny * 2.5;
      p.state = 'hurt';
      p.t = Math.max(0, def.hurt.stun - 10);
      return;
    }
  }

  // Terrain takes one hit per swing, on the first active tick.
  if (p.t === def.attack.activeFrom && strikeTiles(sim, box)) {
    sim.hitstop = Math.max(sim.hitstop, def.attack.hitstop);
  }
}

export function respawnPlayer(sim: Simulation): void {
  const { ecs } = sim;
  const e = sim.player;
  const p = ecs.need(e, Player);
  const body = ecs.need(e, Body);
  const health = ecs.need(e, Health);
  const stamina = ecs.need(e, Stamina);
  const motion = ecs.need(e, Motion);
  const cp = sim.state.checkpoint;
  const spawn = cp ? { x: cp.x, y: cp.y + RESPAWN_OFFSET_Y } : sim.world.gen.originSpawn();
  body.x = spawn.x;
  body.y = spawn.y;
  health.hp = health.max;
  stamina.value = stamina.max;
  p.flasks = p.maxFlasks;
  p.buffered = null;
  p.using = null;
  setState(p, 'free');
  Object.assign(motion, { vx: 0, vy: 0, kx: 0, ky: 0 });
  ecs.add(e, Invulnerable, { ticks: RESPAWN_IFRAMES });
  for (const [proj] of ecs.query(Projectile)) ecs.destroy(proj);
  refreshAbilities(sim);
  resetEnemies(sim);
  sim.events.emit({ type: 'playerRespawned' });
}

// ------------------------------------------------------------------ dev commands

const toggle = (current: boolean, arg: boolean | undefined) => arg ?? !current;

const commands: SimCommand[] = [
  {
    name: 'god',
    description: 'Toggle invulnerability.',
    args: [{ name: 'on', type: 'bool', optional: true }],
    run: ({ sim }, a) => {
      sim.state.cheats.god = toggle(sim.state.cheats.god, a.optBool('on'));
      return `god ${sim.state.cheats.god ? 'on' : 'off'}`;
    },
  },
  {
    name: 'noclip',
    description: 'Toggle walking through walls.',
    args: [{ name: 'on', type: 'bool', optional: true }],
    run: ({ sim }, a) => {
      sim.state.cheats.noclip = toggle(sim.state.cheats.noclip, a.optBool('on'));
      return `noclip ${sim.state.cheats.noclip ? 'on' : 'off'}`;
    },
  },
  {
    name: 'heal',
    description: 'Restore health, stamina and flasks.',
    run: ({ sim }) => {
      const e = sim.player;
      const h = sim.ecs.need(e, Health);
      const s = sim.ecs.need(e, Stamina);
      const p = sim.ecs.need(e, Player);
      h.hp = h.max;
      s.value = s.max;
      p.flasks = p.maxFlasks;
      return 'healed';
    },
  },
  {
    name: 'give',
    description: 'Add souls or flask charges, or set max HP.',
    args: [
      { name: 'what', type: 'string', options: () => ['souls', 'flasks', 'maxhp'] },
      { name: 'amount', type: 'number', integer: true },
    ],
    run: ({ sim }, a) => {
      const p = sim.ecs.need(sim.player, Player);
      const amount = a.number('amount');
      switch (a.string('what')) {
        case 'souls':
          p.souls = Math.max(0, p.souls + amount);
          return `souls: ${p.souls}`;
        case 'flasks':
          p.maxFlasks = Math.max(0, p.maxFlasks + amount);
          p.flasks = p.maxFlasks;
          return `flasks: ${p.maxFlasks}`;
        default: {
          if (amount <= 0) throw new CommandError('max HP must be positive');
          const h = sim.ecs.need(sim.player, Health);
          h.max = amount;
          h.hp = amount;
          return `max HP: ${amount}`;
        }
      }
    },
  },
  {
    name: 'kill',
    description: 'Kill the player (tests death and respawn).',
    run: ({ sim }) => {
      const e = sim.player;
      const god = sim.state.cheats.god;
      sim.state.cheats.god = false;
      sim.ecs.remove(e, Invulnerable);
      const body = sim.ecs.need(e, Body);
      const hp = sim.ecs.need(e, Health).hp;
      applyDamage(sim, e, { amount: hp, crit: false, fromX: body.x, fromY: body.y - 1, knockback: 0 });
      sim.state.cheats.god = god;
    },
  },
  {
    name: 'tp',
    description: 'Teleport to a tile coordinate.',
    args: [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
    ],
    run: ({ sim }, a) => {
      const body = sim.ecs.need(sim.player, Body);
      body.x = a.number('x') * TILE + TILE / 2;
      body.y = a.number('y') * TILE + TILE / 2;
      return `teleported to ${a.number('x')}, ${a.number('y')}`;
    },
  },
  {
    name: 'home',
    description: 'Teleport to the last bonfire, or the world origin.',
    run: ({ sim }) => {
      const body = sim.ecs.need(sim.player, Body);
      const cp = sim.state.checkpoint;
      const to = cp ? { x: cp.x, y: cp.y + RESPAWN_OFFSET_Y } : sim.world.gen.originSpawn();
      body.x = to.x;
      body.y = to.y;
      return cp ? `returned to ${cp.id}` : 'returned to origin';
    },
  },
];

export const playerModule: SimModule = {
  id: 'player',
  systems: [{ phase: 'control', run: updatePlayer }],
  commands,
};
