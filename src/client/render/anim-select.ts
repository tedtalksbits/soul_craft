/**
 * Which animation an entity shows, derived purely from simulation state.
 * Kept free of Pixi so it can be tested against a headless Simulation.
 */
import type { Entity } from '../../core/ecs';
import { Ai, Bonfire, Dying, Enemy, Facing, Motion, Pickup, Player, Sign, Torch } from '../../sim/components';
import { TICK_RATE } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';
import { dir8FromVec, resolveDir8, type Dir8 } from './facing';

const TICK_MS = 1000 / TICK_RATE;

/** Player states whose animation plays once, in step with the state's own timer. */
const PLAYER_TIMED = new Set(['attack', 'roll', 'hurt', 'drink', 'sit', 'dead']);
/** Enemy AI states that are timed actions rather than open-ended behaviour. */
const ENEMY_TIMED = new Set(['windup', 'draw', 'lunge', 'charge', 'recoil', 'stunned', 'hop']);

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

  const player = ecs.get(e, Player);
  const ai = ecs.get(e, Ai);
  const pickup = ecs.get(e, Pickup);
  const dying = ecs.get(e, Dying);
  if (player) {
    pose = player.state === 'free' ? (moving ? 'walk' : 'idle') : player.state;
    if (PLAYER_TIMED.has(player.state)) elapsedMs = player.t * TICK_MS;
    // Swings and rolls face where they go (the aim may be any angle), not the drift of motion.
    if (player.state === 'attack' || player.state === 'roll') dir8 = dir8FromVec(player.dirX, player.dirY);
  } else if (ai && ecs.has(e, Enemy)) {
    if (dying) {
      pose = 'hurt';
      elapsedMs = dying.t * TICK_MS;
    } else {
      switch (ai.state) {
        case 'windup':
        case 'draw':
          pose = 'windup';
          break;
        case 'lunge':
        case 'charge':
          pose = 'attack';
          break;
        case 'recoil':
          pose = 'hurt';
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
  else if (pickup) pose = pickup.kind;
  else pose = 'idle';

  const candidates = [
    `${pose}_${dir8}`,
    `${pose}_${dir}`,
    pose,
    `walk_${dir8}`,
    `walk_${dir}`,
    `idle_${dir8}`,
    `idle_${dir}`,
    'idle',
  ];
  return { key: candidates.find(exists) ?? pose, dir8, elapsedMs };
}
