import type { Entity } from '../core/ecs';
import type { AbilitySlot, AttributeId, ItemCount, StatId, StationId, TierId } from '../content/schemas';
import type { EquipSlot, PickupKind } from './components';

/**
 * Everything the simulation tells the outside world. The client turns these
 * into sound, particles, damage numbers and UI; tests assert on them. The sim
 * never calls into presentation code directly.
 */
export type SimEvent =
  | {
      type: 'damaged';
      target: Entity;
      isPlayer: boolean;
      amount: number;
      crit: boolean;
      x: number;
      y: number;
      hp: number;
      maxHp: number;
      /** The ability that dealt it, or null for a sword, contact or arrow hit. */
      ability: string | null;
    }
  | { type: 'blocked'; x: number; y: number }
  | { type: 'killed'; target: Entity; archetype: string; x: number; y: number; souls: number }
  /** A weapon move starting, and how it is drawn. */
  | {
      type: 'swing';
      x: number;
      y: number;
      dirX: number;
      dirY: number;
      arc: 'slash' | 'thrust' | 'sweep' | 'slam' | 'bash';
    }
  | { type: 'roll' }
  | { type: 'healed'; amount: number }
  | { type: 'flaskEmpty' }
  /** A cuttable tile took a swing but still stands. */
  | { type: 'tileHit'; x: number; y: number; tile: string; hitsLeft: number }
  /** A cuttable tile broke; `hits` is how many swings it needed (1 for grass). */
  | { type: 'tileCut'; x: number; y: number; tile: string; hits: number }
  | { type: 'pickedUp'; kind: PickupKind; amount: number }
  | { type: 'enemyAttack'; entity: Entity; kind: 'lunge' | 'charge' | 'shoot' }
  | { type: 'wallSlam'; x: number; y: number }
  | { type: 'bonfireLit'; id: string; name: string }
  | { type: 'rested'; id: string; name: string }
  /** The player tried to rest with an enemy after them (see `pursued`). */
  | { type: 'restRefused' }
  | { type: 'read'; lines: string[] }
  /** Someone spoke to the player: `name` says `lines`, in order. */
  | { type: 'spoke'; npc: string; name: string; lines: string[] }
  /** An objective was given; the HUD tracks it from now on. */
  | { type: 'objectiveStarted'; objective: string }
  /** An objective was reported done to its giver. */
  | { type: 'objectiveCompleted'; objective: string }
  | { type: 'playerDied'; soulsLost: number }
  | { type: 'playerRespawned' }
  | { type: 'areaEntered'; name: string; firstVisit: boolean }
  /** `tier` is set for a piece of gear. */
  | { type: 'itemGained'; item: string; count: number; tier: TierId | null }
  /** A piece of gear fell from an enemy (for its chime and beam). */
  | {
      type: 'gearDropped';
      item: string;
      tier: TierId;
      greater: boolean;
      blighted: boolean;
      x: number;
      y: number;
    }
  | { type: 'inventoryFull'; item: string }
  /** Gear perks and powers at work: a flinch shrugged off, the Last Ember catching a killing blow, a roll's stamina refunded, a burning streak. */
  | { type: 'keptFooting' }
  /** Weapon moves: a charge starting and filling, a type's rule landing (flow, tipper, crush, a spent mark), a slam's shockwave. */
  | { type: 'chargeStarted' }
  | { type: 'chargeFull' }
  /** An Ember staff's store changed. */
  | { type: 'embers'; count: number }
  | { type: 'weaponRule'; rule: string; x: number; y: number }
  | { type: 'shockwave'; x: number; y: number; radius: number }
  | { type: 'lastEmber' }
  | { type: 'dodged' }
  | { type: 'streakBurst'; x: number; y: number }
  | { type: 'equipped'; item: string; slot: EquipSlot }
  | { type: 'unequipped'; item: string; slot: EquipSlot }
  /** Gear can't change with an enemy after the player. */
  | { type: 'gearLocked' }
  | { type: 'buffStarted'; stat: StatId; item: string; seconds: number }
  | { type: 'buffEnded'; stat: StatId }
  | { type: 'crafted'; recipe: string; item: string; count: number }
  | { type: 'craftFailed'; recipe: string; reason: string }
  | { type: 'upgraded'; item: string; level: number }
  /** Smithy work done: gear broken into materials, upgrades moved, a perk tempered, blight burned off, attributes reset. */
  | { type: 'salvaged'; item: string; tier: TierId; materials: ItemCount[] }
  | { type: 'infused'; from: string; to: string; level: number }
  | { type: 'tempered'; item: string }
  | { type: 'cleansed'; item: string }
  | { type: 'respecced'; points: number }
  /** A weapon coated (and the coating wearing off), a project raised a rank, a gamble paid off. */
  | { type: 'coated'; item: string; seconds: number }
  | { type: 'coatingEnded' }
  | { type: 'ranked'; project: string; rank: number }
  | { type: 'gambled'; item: string; tier: TierId }
  /** Wardens: rekindled for a refight, a chest bursting open (did the signature come, do the embers stir), a charge baited onto a brazier, a Warden's poise broken. */
  | { type: 'rekindled'; boss: string; heat: number }
  | { type: 'wardenChest'; boss: string; signature: boolean; stirring: boolean; x: number; y: number }
  | { type: 'brazierSlam'; x: number; y: number; count: number }
  | { type: 'bossStaggered'; boss: string }
  /** A ring of embers turned a blow aside (the Warden's Aegis). */
  | { type: 'warded'; x: number; y: number }
  | { type: 'stationOpened'; station: StationId }
  /** An ability's effects landed. (x, y) is the caster; (tx, ty) where it was aimed. */
  | { type: 'abilityUsed'; ability: string; slot: AbilitySlot; x: number; y: number; tx: number; ty: number }
  /** An ability key was pressed but the ability isn't ready. */
  | { type: 'abilityNotReady'; slot: AbilitySlot }
  | { type: 'abilityReady'; slot: AbilitySlot }
  | { type: 'blast'; ability: string; x: number; y: number; radius: number }
  | { type: 'empowered'; ability: string; seconds: number }
  | { type: 'empowerEnded'; ability: string }
  /** The player's overshield grew to `hp`. */
  | { type: 'overshieldGained'; hp: number }
  /** A blow landed on the overshield: `absorbed` of it, leaving `hp` (0 = broken). */
  | { type: 'overshieldHit'; absorbed: number; hp: number }
  /** The overshield ran out of time. */
  | { type: 'overshieldFaded' }
  /** The player turned unseen for `seconds`. */
  | { type: 'veiled'; seconds: number }
  /** The veil ended: by attacking (an ambush follows), a hit, or time. */
  | { type: 'unveiled' }
  /** A hit out of hiding dealt `bonus` more. */
  | { type: 'ambushed'; x: number; y: number; bonus: number }
  | { type: 'decoyFaded'; x: number; y: number }
  | { type: 'classChanged'; class: string }
  /** A relic awakened an ability slot; `ability` is what that slot holds for the current class. */
  | { type: 'abilityUnlocked'; slot: 'class' | 'super'; ability: string }
  /** An ability key was pressed for a slot not yet awakened. */
  | { type: 'abilityLocked'; slot: AbilitySlot }
  /** The player warped to a lit bonfire and is now resting there. */
  | { type: 'traveled'; id: string; name: string }
  | { type: 'leveledUp'; attribute: AttributeId; level: number }
  /** A variant was learned at a bonfire (and its souls spent). */
  | { type: 'variantLearned'; ability: string }
  /** The player now uses `ability` in place of `base` (the base itself to switch back). */
  | { type: 'variantChosen'; base: string; ability: string }
  /** A class modifier was learned at a bonfire (and its souls spent). */
  | { type: 'modifierLearned'; modifier: string }
  /** A modifier was put on or taken off. */
  | { type: 'modifierWorn'; modifier: string; on: boolean }
  /** The player opened a ruined project's site; the client shows what it needs. */
  | { type: 'projectOpened'; project: string }
  | { type: 'restored'; project: string }
  | { type: 'rebuildFailed'; project: string; reason: string }
  | { type: 'bossFightStarted'; boss: string }
  /** The fight ended without a win (the player died); the boss will be back at full health. */
  | { type: 'bossFightEnded'; boss: string }
  | { type: 'bossShielded'; boss: string; braziers: number }
  | { type: 'brazierLit'; x: number; y: number; left: number }
  | { type: 'bossShieldBroken'; boss: string }
  /** The boss's ground slam landing: a ring of `radius` around (x, y). */
  | { type: 'bossSlam'; x: number; y: number; radius: number }
  | { type: 'bossDefeated'; boss: string };

export type SimEventType = SimEvent['type'];
