/**
 * Which animation an entity shows, derived purely from simulation state.
 * Kept free of Pixi so it can be tested against a headless Simulation.
 */
import type { Entity } from '../../core/ecs';
import {
  Abilities,
  Ai,
  Body,
  Bonfire,
  Brazier,
  Dying,
  Enemy,
  Facing,
  Motion,
  Pickup,
  Player,
  Project,
  Sign,
  Staggered,
  Station,
  Torch,
} from '../../sim/components';
import { TICK_RATE } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';
import { dir8FromVec, resolveDir8, type Dir8 } from './facing';

const TICK_MS = 1000 / TICK_RATE;

/** Player states whose animation plays once, in step with the state's own timer. */
const PLAYER_TIMED = new Set(['attack', 'roll', 'hurt', 'drink', 'sit', 'dead', 'cast']);
/** Enemy AI states that are timed actions rather than open-ended behavior. */
const ENEMY_TIMED = new Set([
  'windup',
  'draw',
  'loose',
  'lunge',
  'charge',
  'recoil',
  'stunned',
  'hop',
  'raise',
  'slam',
  'recover',
]);

export interface AnimChoice {
  key: string;
  dir8: Dir8;
  /**
   * Time into the animation, from the sim state's tick counter, for one-shot actions.
   * Ties frames to gameplay (an attack's strike frame always matches its hit window,
   * repeated attacks restart cleanly, slow motion slows the art). Undefined for
   * ambient loops (idle, walk), which run on wall-clock time.
   */
  elapsedMs: number | undefined;
  /** Play the animation backwards: an enemy stepping away from the player it is watching. */
  reverse: boolean;
  /** For a player cast: its timing, so a pose with a release frame can land on the release tick. */
  cast: CastTiming | null;
}

export interface CastTiming {
  /** Ticks into the cast. */
  t: number;
  /** The tick the effects land on, and the cast's length. */
  release: number;
  ticks: number;
  /** A dash: after the release the pose's remaining frames loop (a run cycle) instead of playing once. */
  loopAfterRelease: boolean;
}

/**
 * Which frame of a cast pose to show. Frames before `releaseFrame` share the ticks up to the
 * release, the release frame shows on the release tick, and the rest share the remainder (or
 * loop at `fps` for a dash). So one pose fits a quick class ability and a slow super alike.
 */
export function castFrame(c: CastTiming, frameCount: number, releaseFrame: number, fps: number): number {
  const r = Math.min(releaseFrame, frameCount - 1);
  if (c.t < c.release) return r === 0 ? 0 : Math.min(r - 1, Math.floor((c.t / c.release) * r));
  const after = c.t - c.release;
  const rest = frameCount - r;
  if (c.loopAfterRelease) return r + (Math.floor((after / TICK_RATE) * fps) % rest);
  const span = Math.max(1, c.ticks - c.release);
  return Math.min(frameCount - 1, r + Math.floor((after / span) * rest));
}

/**
 * Picks the animation for an entity, trying the most specific name first: eight-way,
 * then four-way, then undirected, then walk/idle fallbacks.
 */
export function selectAnim(
  sim: Simulation,
  e: Entity,
  previous: Dir8 | undefined,
  exists: (key: string) => boolean,
): AnimChoice {
  const { ecs } = sim;
  const dir = ecs.get(e, Facing)?.dir ?? 'down';
  const motion = ecs.get(e, Motion);
  const moving = motion !== undefined && Math.abs(motion.vx) + Math.abs(motion.vy) > 0.05;
  let dir8 = resolveDir8(previous, dir, motion?.vx ?? 0, motion?.vy ?? 0);
  let pose: string;
  let elapsedMs: number | undefined;
  let reverse = false;
  let cast: CastTiming | null = null;

  const player = ecs.get(e, Player);
  const ai = ecs.get(e, Ai);
  const pickup = ecs.get(e, Pickup);
  const dying = ecs.get(e, Dying);
  if (player) {
    pose = player.state === 'free' ? (moving ? 'walk' : 'idle') : player.state;
    if (player.state === 'cast') {
      const c = castPose(sim, e, player.t);
      if (c) {
        pose = c.pose;
        cast = c.timing;
      }
    }
    if (PLAYER_TIMED.has(player.state)) elapsedMs = player.t * TICK_MS;
    // Swings, rolls and casts face where they go (the aim may be any angle), not the drift of motion.
    if (player.state === 'attack' || player.state === 'roll' || player.state === 'cast')
      dir8 = dir8FromVec(player.dirX, player.dirY);
  } else if (ai && ecs.has(e, Enemy)) {
    if (dying) {
      pose = 'dead';
      elapsedMs = dying.t * TICK_MS;
    } else if (ecs.has(e, Staggered)) {
      pose = 'stunned';
    } else {
      switch (ai.state) {
        case 'windup':
        case 'draw':
          pose = 'windup';
          // Telegraphs track the player in all 8 directions, so the attack that follows lines up.
          dir8 = towardPlayer(sim, e) ?? dir8;
          break;
        case 'loose':
          pose = 'attack';
          dir8 = towardPlayer(sim, e) ?? dir8;
          break;
        case 'lunge':
        case 'charge':
          pose = 'attack';
          dir8 = dir8FromVec(ai.dirX, ai.dirY);
          break;
        case 'chase': {
          // Chasers watch the player; one backing away (an archer keeping its distance)
          // walks backwards rather than turning its back.
          pose = moving ? 'walk' : 'idle';
          const toward = towardPlayer(sim, e);
          if (toward) dir8 = toward;
          const pb = ecs.get(sim.player, Body);
          const eb = ecs.get(e, Body);
          if (moving && pb && eb) {
            reverse = motion.vx * (pb.x - eb.x) + motion.vy * (pb.y - eb.y) < 0;
          }
          break;
        }
        case 'recoil':
          pose = 'hurt';
          break;
        // The Warden's slam: the weapon rises (the tell), lands, and it stands open to hits.
        case 'raise':
          pose = 'raise';
          dir8 = towardPlayer(sim, e) ?? dir8;
          break;
        case 'slam':
        case 'recover':
          pose = ai.state;
          break;
        // Shielded, it walks back to the arena's center, then channels there.
        case 'channel':
          pose = moving ? 'walk' : 'channel';
          break;
        default:
          pose = ai.state === 'hop' || ai.state === 'stunned' ? ai.state : moving ? 'walk' : 'idle';
      }
      if (ENEMY_TIMED.has(ai.state)) elapsedMs = ai.t * TICK_MS;
    }
  } else if (ecs.has(e, Bonfire)) {
    pose = sim.state.litBonfires[ecs.need(e, Bonfire).id] ? 'bonfire_lit' : 'bonfire_unlit';
  } else if (ecs.has(e, Torch)) pose = 'torch';
  else if (ecs.has(e, Sign)) pose = 'sign';
  else if (ecs.has(e, Station)) pose = ecs.need(e, Station).station;
  else if (ecs.has(e, Brazier)) pose = ecs.need(e, Brazier).lit ? 'brazier_lit' : 'brazier';
  else if (ecs.has(e, Project)) {
    const id = ecs.need(e, Project).project;
    const art = sim.content.restoration[id]?.sprite;
    pose = (sim.state.restored[id] ? art?.restored : art?.ruin) ?? 'idle';
  }
  // Item pickups draw their item's icon from the items sheet.
  else if (pickup)
    pose = pickup.item !== null ? (sim.content.items[pickup.item]?.icon ?? 'idle') : pickup.kind;
  else pose = 'idle';

  const directed = (p: string) => [`${p}_${dir8}`, `${p}_${dir}`, p];
  const fallback = FALLBACK[pose];
  const candidates = [
    ...directed(pose),
    ...(fallback ? directed(fallback) : []),
    ...directed('walk'),
    ...directed('idle'),
  ];
  return { key: candidates.find(exists) ?? pose, dir8, elapsedMs, reverse, cast };
}

/** Closest stand-in when a sheet lacks a pose (placeholder sheets have `hurt` but no `dead`). */
const FALLBACK: Readonly<Record<string, string>> = { dead: 'hurt', stunned: 'hurt' };

/** The pose and timing of the cast in progress, from the ability's content. */
function castPose(sim: Simulation, e: Entity, t: number): { pose: string; timing: CastTiming } | null {
  const casting = sim.ecs.get(e, Abilities)?.casting;
  const def = casting ? sim.content.abilities[casting.ability] : undefined;
  if (!def) return null;
  const dash = def.effects.some((fx) => fx.type === 'dash');
  return {
    pose: def.pose,
    timing: { t, release: def.cast.release, ticks: def.cast.ticks, loopAfterRelease: dash },
  };
}

function towardPlayer(sim: Simulation, e: Entity): Dir8 | undefined {
  const from = sim.ecs.get(e, Body);
  const to = sim.ecs.get(sim.player, Body);
  if (!from || !to || (from.x === to.x && from.y === to.y)) return undefined;
  return dir8FromVec(to.x - from.x, to.y - from.y);
}
