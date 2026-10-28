/**
 * The only way input reaches the simulation: one plain frame per tick.
 * Keeping it device-agnostic and serializable is what makes replays,
 * scripted tests and (later) netcode possible.
 */

export const Action = {
  attack: 1 << 0,
  roll: 1 << 1,
  heal: 1 << 2,
  use: 1 << 3,
} as const;
export type ActionName = keyof typeof Action;

export interface InputFrame {
  /** Movement intent, each axis in [-1, 1]. */
  moveX: number;
  moveY: number;
  /** World-space point the player is aiming at (mouse), or null to use facing. */
  aim: { x: number; y: number } | null;
  /** Bitmask of {@link Action}s pressed this tick. */
  pressed: number;
  /** Bitmask of {@link Action}s currently held. */
  held: number;
}

export const NO_INPUT: InputFrame = Object.freeze({ moveX: 0, moveY: 0, aim: null, pressed: 0, held: 0 });

export const wasPressed = (frame: InputFrame, action: ActionName): boolean =>
  (frame.pressed & Action[action]) !== 0;

/** Builds a frame from action names. Mostly for tests and scripts. */
export function inputFrame(opts: {
  move?: readonly [number, number];
  press?: readonly ActionName[];
  aim?: { x: number; y: number };
}): InputFrame {
  const mask = (opts.press ?? []).reduce((m, a) => m | Action[a], 0);
  return {
    moveX: opts.move?.[0] ?? 0,
    moveY: opts.move?.[1] ?? 0,
    aim: opts.aim ?? null,
    pressed: mask,
    held: mask,
  };
}
