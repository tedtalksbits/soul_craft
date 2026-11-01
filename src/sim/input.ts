import type { AttributeId, TierId } from '../content/schemas';
import type { EquipSlot } from './components';

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
  /** Use the quick-slot consumable. */
  item: 1 << 4,
  /** The class's three abilities (G, C and V by default; the client sends the AoE on release). */
  aoe: 1 << 5,
  classAbility: 1 << 6,
  super: 1 << 7,
} as const;
export type ActionName = keyof typeof Action;

/**
 * Menu actions (inventory, crafting). They travel inside the InputFrame like
 * button presses, so they are just as deterministic and replayable.
 */
/** A piece of gear the smithy works on: in the pack, or worn. */
export type GearTarget = { pack: number } | { slot: EquipSlot };

export type PlayerAction =
  | { type: 'equip'; index: number }
  | { type: 'unequip'; slot: EquipSlot }
  | { type: 'use'; item: string }
  | { type: 'setQuick'; item: string | null }
  | { type: 'craft'; recipe: string }
  | { type: 'upgrade' }
  /** Change class. Only allowed while resting at a bonfire. */
  | { type: 'setClass'; class: string }
  /** Place the map pin at a world position, or clear it with null. Allowed any time. */
  | { type: 'setPin'; at: { x: number; y: number } | null }
  /** Warp to another lit bonfire. Only allowed while resting at one. */
  | { type: 'travel'; bonfire: string }
  /** Spend materials and souls to rebuild a village project. Only allowed standing at its site. */
  | { type: 'rebuild'; project: string }
  /** Spend souls on one level in an attribute. Only allowed while resting at a bonfire. */
  | { type: 'levelUp'; attribute: AttributeId }
  /**
   * Use another version of a base ability (or the base again). Learning a new variant costs
   * souls. Only allowed while resting at a bonfire.
   */
  | { type: 'chooseVariant'; base: string; ability: string }
  /** Puts on (or takes off) a class modifier, learning it first if needed. Only at a bonfire. */
  | { type: 'wearModifier'; modifier: string; on: boolean }
  /** Smithy work. Salvaging needs the forge or a bonfire; upgrading and infusing the forge; tempering and cleansing the smith. */
  | { type: 'salvage'; index: number }
  | { type: 'salvageJunk' }
  | { type: 'mark'; index: number; mark: 'lock' | 'junk' | null }
  | { type: 'autoSalvage'; tier: TierId; on: boolean }
  | { type: 'upgradeGear'; target: GearTarget }
  | { type: 'infuse'; from: GearTarget; to: GearTarget }
  | { type: 'temper'; target: GearTarget; perk: number }
  /** Settles a temper: 0 keeps the old perk, 1 or 2 takes a new one. */
  | { type: 'settleTemper'; target: GearTarget; choice: number }
  | { type: 'cleanse'; target: GearTarget }
  /** Gives back every attribute point to spend again, for the souls of one level. Only at a bonfire. */
  | { type: 'respec' };

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
  /** Menu actions issued this tick, applied in order. */
  actions?: readonly PlayerAction[];
  /** A menu is open: the world holds still, and only menu actions apply (see Simulation.step). */
  menu?: boolean;
}

export const NO_INPUT: InputFrame = Object.freeze({ moveX: 0, moveY: 0, aim: null, pressed: 0, held: 0 });

export const wasPressed = (frame: InputFrame, action: ActionName): boolean =>
  (frame.pressed & Action[action]) !== 0;

/** Builds a frame from action names. Mostly for tests and scripts. */
export function inputFrame(opts: {
  move?: readonly [number, number];
  press?: readonly ActionName[];
  aim?: { x: number; y: number };
  actions?: readonly PlayerAction[];
  menu?: boolean;
}): InputFrame {
  const mask = (opts.press ?? []).reduce((m, a) => m | Action[a], 0);
  return {
    moveX: opts.move?.[0] ?? 0,
    moveY: opts.move?.[1] ?? 0,
    aim: opts.aim ?? null,
    pressed: mask,
    held: mask,
    ...(opts.actions ? { actions: opts.actions } : {}),
    ...(opts.menu ? { menu: true } : {}),
  };
}
