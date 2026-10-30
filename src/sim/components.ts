/**
 * Every component in the simulation. Components are plain JSON-compatible data
 * (no class instances, Sets or functions) so the ECS can be snapshotted as-is.
 * Each const shares its name with its interface: `ecs.get(e, Health)` is a `Health`.
 */
import { defineComponent, type Entity } from '../core/ecs';
import type { Dir } from '../core/math';
import type { AbilitySlot, StatId, StationId } from '../content/schemas';

/** Collision box, centered on (x, y), in world pixels. */
export interface Body {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const Body = defineComponent<Body>('body');

/** Intended velocity plus decaying knockback. Physics writes `hitWall` back each tick. */
export interface Motion {
  vx: number;
  vy: number;
  kx: number;
  ky: number;
  hitWall: boolean;
}
export const Motion = defineComponent<Motion>('motion');

export interface Facing {
  dir: Dir;
}
export const Facing = defineComponent<Facing>('facing');

export interface Health {
  hp: number;
  max: number;
}
export const Health = defineComponent<Health>('health');

export interface Stamina {
  value: number;
  max: number;
  /** Ticks until regeneration resumes. */
  delay: number;
}
export const Stamina = defineComponent<Stamina>('stamina');

export type TeamId = 'player' | 'enemy';
export interface Team {
  team: TeamId;
}
export const Team = defineComponent<Team>('team');

/** Damage immunity (dodge i-frames, post-hit grace). */
export interface Invulnerable {
  ticks: number;
}
export const Invulnerable = defineComponent<Invulnerable>('invulnerable');

export type PlayerStateName = 'free' | 'attack' | 'roll' | 'hurt' | 'drink' | 'sit' | 'dead' | 'cast';
export interface Player {
  state: PlayerStateName;
  /** Ticks spent in the current state. */
  t: number;
  /** Unit direction of the current roll or swing. */
  dirX: number;
  dirY: number;
  /** Entities already struck by the current swing. */
  struck: Entity[];
  /** An attack/roll pressed too early, replayed when the player is free again. */
  buffered: { action: number; age: number } | null;
  souls: number;
  flasks: number;
  maxFlasks: number;
  /** The consumable being drunk in the `drink` state; null means the flask. */
  using: string | null;
}
export const Player = defineComponent<Player>('player');

/** The player's class and the state of its three abilities. */
export interface Abilities {
  class: string;
  /** Ticks until the AoE and class abilities are ready again (0 = ready). */
  cooldowns: { aoe: number; class: number };
  /** Super energy, 0-100. The super needs a full bar. */
  energy: number;
  /** Which slots the player has awakened (relics unlock them). The AoE is always known. */
  unlocked: { class: boolean; super: boolean };
  /** The ability being cast in the `cast` state, and where it was aimed; null otherwise. */
  casting: { ability: string; slot: AbilitySlot; aimX: number; aimY: number } | null;
}
export const Abilities = defineComponent<Abilities>('abilities');

/** Points spent in each attribute by leveling at bonfires. The player's level is their sum plus one. */
export interface Attributes {
  vigor: number;
  endurance: number;
  might: number;
  attunement: number;
}
export const Attributes = defineComponent<Attributes>('attributes');

/**
 * A super's timed mode on the player. The numbers are copied from the ability when it
 * starts, so editing content mid-super cannot change one already running.
 */
export interface Empowered {
  ability: string;
  ticks: number;
  damage: number;
  defense: number;
  crit: number;
  staminaFree: boolean;
}
export const Empowered = defineComponent<Empowered>('empowered');

/** An enemy knocked off balance: no moving, no attacking, no blocking until it recovers. */
export interface Staggered {
  ticks: number;
}
export const Staggered = defineComponent<Staggered>('staggered');

/** What an ability hit does to each enemy it reaches. */
export interface AbilityHit {
  ability: string;
  damage: number;
  knockback: number;
  stagger: number;
  /** Whether the hit fills super energy (everything but the super's own hits). */
  charges: boolean;
}

/** A thrown charge waiting on its fuse (Ash Bomb, Fire Pot), at its Body's position. */
export interface Blast extends AbilityHit {
  radius: number;
  fuse: number;
}
export const Blast = defineComponent<Blast>('blast');

/** Burning ground (Fire Pot, Cinder Storm) at its Body's position. */
export interface Zone extends AbilityHit {
  radius: number;
  /** Ticks since the zone was made. It starts hurting after `delay`, then every `interval`. */
  t: number;
  delay: number;
  duration: number;
  interval: number;
}
export const Zone = defineComponent<Zone>('zone');

/** One inventory slot: an item, how many, and (for weapons) its forge upgrade level. */
export interface ItemStack {
  item: string;
  count: number;
  level: number;
}

/** What the player carries. Order is the display order; capacity is `inventoryCapacity()` (base slots plus a rebuilt storehouse). */
export interface Inventory {
  stacks: ItemStack[];
}
export const Inventory = defineComponent<Inventory>('inventory');

export type EquipSlot = 'weapon' | 'armor' | 'ring0' | 'ring1';
export interface Equipment {
  weapon: ItemStack | null;
  armor: ItemStack | null;
  ring0: ItemStack | null;
  ring1: ItemStack | null;
  /** Consumable used with the quick-use key; it stays in the inventory. */
  quick: string | null;
}
export const Equipment = defineComponent<Equipment>('equipment');

export interface Buff {
  stat: StatId;
  amount: number;
  ticks: number;
  /** The item that granted it. */
  source: string;
}
export interface Buffs {
  active: Buff[];
}
export const Buffs = defineComponent<Buffs>('buffs');

/** A crafting station in the world. */
export interface Station {
  station: StationId;
}
export const Station = defineComponent<Station>('station');

export interface Enemy {
  archetype: string;
  homeX: number;
  homeY: number;
}
export const Enemy = defineComponent<Enemy>('enemy');

/**
 * A boss's fight state. `phase` counts the shields raised so far (an index into the brain's
 * `shieldAt`); while `shielded`, nothing hurts it until every brazier in its arena is lit.
 */
export interface Boss {
  phase: number;
  shielded: boolean;
  /** Ticks until the next add is called while shielded. */
  addTimer: number;
}
export const Boss = defineComponent<Boss>('boss');

/** An enemy a boss called into its fight. Gone when the boss dies. */
export type Minion = Record<string, never>;
export const Minion = defineComponent<Minion>('minion');

/** A boss arena's brazier, lit by standing on it while the boss is shielded. */
export interface Brazier {
  lit: boolean;
}
export const Brazier = defineComponent<Brazier>('brazier');

/** Brain state shared by all enemy brains. Interpreted per brain type. */
export interface Ai {
  state: string;
  t: number;
  cooldown: number;
  /** Committed direction (or velocity) for hops, lunges and charges. */
  dirX: number;
  dirY: number;
  wanderTicks: number;
  wanderX: number;
  wanderY: number;
}
export const Ai = defineComponent<Ai>('ai');

/** Damage dealt to the player on touch. Brains raise it during lunges and charges. */
export interface ContactDamage {
  amount: number;
}
export const ContactDamage = defineComponent<ContactDamage>('contactDamage');

/** Death animation timer. Dying entities are ignored by AI and collisions. */
export interface Dying {
  t: number;
}
export const Dying = defineComponent<Dying>('dying');

export type ProjectileKind = 'arrow';
export interface Projectile {
  kind: ProjectileKind;
  team: TeamId;
  damage: number;
  vx: number;
  vy: number;
  life: number;
  /** Whether a raised shield can deflect it. */
  blockable: boolean;
}
export const Projectile = defineComponent<Projectile>('projectile');

export type PickupKind = 'souls' | 'ember' | 'item';
export interface Pickup {
  kind: PickupKind;
  amount: number;
  /** For `item` pickups: which item. */
  item: string | null;
  age: number;
  /** Visual hop height; the sim tracks it so pickups land deterministically. */
  z: number;
  vz: number;
}
export const Pickup = defineComponent<Pickup>('pickup');

/** A pickup being pulled to the player by the loot magnet. Once caught, it does not let go. */
export interface Magnetized {
  /** Ticks since the pull started; the pull accelerates with it. */
  ticks: number;
}
export const Magnetized = defineComponent<Magnetized>('magnetized');

export interface Bonfire {
  id: string;
  name: string;
}
export const Bonfire = defineComponent<Bonfire>('bonfire');

export interface Sign {
  lines: string[];
}
export const Sign = defineComponent<Sign>('sign');

/** A village restoration site: a ruin until its project is rebuilt (see `SimState.restored`). */
export interface Project {
  project: string;
}
export const Project = defineComponent<Project>('project');

export type Torch = Record<string, never>;
export const Torch = defineComponent<Torch>('torch');

/** Owned by world streaming: destroyed when `chunk` unloads, respawned from `spawnId`. */
export interface Spawned {
  chunk: string;
  spawnId: string;
}
export const Spawned = defineComponent<Spawned>('spawned');

/** Presentation hint: which sprite sheet draws this entity. */
export interface Sprite {
  sheet: string;
}
export const Sprite = defineComponent<Sprite>('sprite');
