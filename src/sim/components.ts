/**
 * Every component in the simulation. Components are plain JSON-compatible data
 * (no class instances, Sets or functions) so the ECS can be snapshotted as-is.
 * Each const shares its name with its interface: `ecs.get(e, Health)` is a `Health`.
 */
import { defineComponent, type Entity } from '../core/ecs';
import type { Dir } from '../core/math';
import type { AbilitySlot, StatId, StationId, TierId } from '../content/schemas';

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

export type PlayerStateName =
  'free' | 'attack' | 'charge' | 'roll' | 'hurt' | 'drink' | 'sit' | 'dead' | 'cast';
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
  /** Ability variants and class modifiers learned at bonfires, by id. Bases are always known. */
  learned: Record<string, true>;
  /** The modifiers worn, by class id, in slot order. Kept per class, like `chosen`. */
  modifiers: Record<string, string[]>;
  /**
   * The variant in use for a base ability, by base id. Keyed by base rather than slot, so a class
   * changed and changed back keeps its choices. A base with no entry is used as is.
   */
  chosen: Record<string, string>;
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
  /** Extra walking speed, as a fraction. */
  speed: number;
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
  /** The enemy it is stuck to and rides along with (Latch), or null on the ground. */
  stuck: Entity | null;
}
export const Blast = defineComponent<Blast>('blast');

/** Burning ground (Fire Pot, Cinder Storm) at its Body's position. */
export interface Zone extends AbilityHit {
  radius: number;
  /** Health given to the player standing in it, each pulse. */
  heal: number;
  /** Overshield given to the player standing in it, each pulse, or none. */
  shield: { amount: number; max: number; seconds: number } | null;
  /** Ticks since the zone was made. It starts hurting after `delay`, then every `interval`. */
  t: number;
  delay: number;
  duration: number;
  interval: number;
  /** Moves with the player (an aura) instead of staying where it landed. */
  follow: boolean;
}
export const Zone = defineComponent<Zone>('zone');

/** A false image of the player that enemies chase instead (False Step), for `ticks`. */
export interface Decoy {
  ticks: number;
}
export const Decoy = defineComponent<Decoy>('decoy');

/**
 * The player, unseen (Vanish), for `ticks`. `armed` turns on once the cast that made it is over;
 * attacking after that breaks it into an {@link Ambush}.
 */
export interface Veiled {
  ticks: number;
  bonus: number;
  armed: boolean;
  /** Strikes the veil still lasts through (a Legendary's); absent means it breaks on the first. */
  strikesLeft?: number;
}
export const Veiled = defineComponent<Veiled>('veiled');

/** The first hit out of hiding: the next damage the player deals within `ticks` is `bonus` more. */
export interface Ambush {
  ticks: number;
  bonus: number;
}
export const Ambush = defineComponent<Ambush>('ambush');

/**
 * Extra health over the player's own that soaks blows first (Destiny's overshield), from
 * abilities. It lasts `ticks`, then fades.
 */
export interface Overshield {
  hp: number;
  ticks: number;
}
export const Overshield = defineComponent<Overshield>('overshield');

/** A perk rolled onto one piece of gear. */
export interface PerkRoll {
  perk: string;
  value: number;
  /** Rolled Greater: stronger than the tier usually allows, and marked with a star. */
  greater?: true;
}

/**
 * What makes one piece of gear itself: its tier, the item level of the place it dropped, its rolled
 * perks, and the seed its rolls came from (rerolls will advance only this item's seed, so reloading
 * never fishes for a better result).
 */
export interface Gear {
  tier: TierId;
  ilvl: number;
  seed: number;
  perks: PerkRoll[];
  /** One of `perks` is a drawback, and the rest rolled stronger for it. */
  blighted?: true;
}

/**
 * Timers and counters behind gear perks and Legendary powers, on the player. Added the first time one
 * is needed, so a save from before it still loads.
 */
export interface PerkState {
  /** Ticks until each once-in-a-while effect (by effect type) works again. */
  cooldowns: Record<string, number>;
  /** Weapon hits in the current streak, and ticks left before it lapses. */
  streak: number;
  streakTicks: number;
  /** A Last Ember already spent since the last rest. */
  emberSpent: boolean;
  /** The tick the roll whose stamina was already given back began on. */
  refundedRoll: number;
}
export const PerkState = defineComponent<PerkState>('perkState');

/**
 * The player's weapon moves: which move is under way, the chain, the charge, and the windows the
 * weapon types' rules open. Added the first time the player attacks, so older saves still load.
 */
export interface Swing {
  /** A step of the light chain, the charged attack, or the dash-strike out of a roll. */
  move: 'chain' | 'charged' | 'dash';
  step: number;
  /** How full the charge was when it was let go, 0..1. Full (1) brings its payoff. */
  charge: number;
  /** Ticks left in which a tap continues the chain, and the step it continues with. */
  comboTicks: number;
  nextStep: number;
  /** The tick the last roll ended on, for dash-strikes. */
  rollEndedAt: number;
  /** Flow (sword): until this tick, a light hit crits and refunds a roll's stamina. */
  flowUntil: number;
  /** This move's shockwave has gone out. */
  shockwave: boolean;
  /** The attack button has been held since the move began (a tap held long enough becomes a charge). */
  held: boolean;
  /** Swings made, for perks that act on every so many. Absent in saves from before it. */
  swings?: number;
  /** The charged shot under way was let go in the Perfect window. */
  perfect?: boolean;
  /** The next roll costs no stamina (a Legendary's reward for a Perfect Shot). */
  freeRoll?: boolean;
  /** Embers stored by an Ember staff's melee hits, spent by its fireballs. */
  embers?: number;
}
export const Swing = defineComponent<Swing>('swing');

/** Marked by a sworn spear's tipper: the next ability hit staggers it for `stagger` ticks. */
export interface Marked {
  ticks: number;
  stagger: number;
}
export const Marked = defineComponent<Marked>('marked');

/** Bow arrows lodged in an enemy, and ticks until the last falls out. */
export interface Pinned {
  count: number;
  ticks: number;
}
export const Pinned = defineComponent<Pinned>('pinned');

/** Dagger Bleed on an enemy: `stacks` so far, lapsing `ticks` after the last hit added one. */
export interface Bleed {
  stacks: number;
  ticks: number;
}
export const Bleed = defineComponent<Bleed>('bleed');

/**
 * One inventory slot: an item, how many, its forge upgrade level, and for gear, its rolls. Gear without
 * `gear` is Common at item level 1 with no perks.
 */
export interface ItemStack {
  item: string;
  count: number;
  level: number;
  gear?: Gear;
}

/** What the player carries. Order is the display order; capacity is `inventoryCapacity()` (base slots plus a rebuilt storehouse). */
export interface Inventory {
  stacks: ItemStack[];
}
export const Inventory = defineComponent<Inventory>('inventory');

export type EquipSlot = 'weapon' | 'ring0' | 'ring1' | 'helmet' | 'chest' | 'legs';
export interface Equipment {
  weapon: ItemStack | null;
  ring0: ItemStack | null;
  ring1: ItemStack | null;
  helmet: ItemStack | null;
  chest: ItemStack | null;
  legs: ItemStack | null;
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

export type ProjectileKind = 'arrow' | 'knife' | 'fireball';
export interface Projectile {
  kind: ProjectileKind;
  team: TeamId;
  damage: number;
  vx: number;
  vy: number;
  life: number;
  /** Whether a raised shield can deflect it. */
  blockable: boolean;
  /** For the player's thrown knives: the ability that threw it, and how long a hit staggers. */
  ability: string | null;
  stagger: number;
  /**
   * A shot from the player's weapon (an arrow or a staff's fireball): a Perfect Shot or piercing fire flies
   * on, a fireball may burst, and nothing is hit twice. Absent on other projectiles.
   */
  bow?: { perfect: boolean; hit: Entity[]; pierce?: boolean; explode?: number };
}
export const Projectile = defineComponent<Projectile>('projectile');

export type PickupKind = 'souls' | 'ember' | 'item';
export interface Pickup {
  kind: PickupKind;
  amount: number;
  /** For `item` pickups: which item. */
  item: string | null;
  /** For a piece of gear: its rolls. */
  gear: Gear | null;
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

/** Someone the player can talk to, by id in npcs.json (Maren). */
export interface Npc {
  npc: string;
}
export const Npc = defineComponent<Npc>('npc');

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
