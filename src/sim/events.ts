import type { Entity } from '../core/ecs';
import type { AbilitySlot, AttributeId, StatId, StationId } from '../content/schemas';
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
  | { type: 'swing'; x: number; y: number; dirX: number; dirY: number }
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
  | { type: 'read'; lines: string[] }
  | { type: 'playerDied'; soulsLost: number }
  | { type: 'playerRespawned' }
  | { type: 'areaEntered'; name: string; firstVisit: boolean }
  | { type: 'itemGained'; item: string; count: number }
  | { type: 'inventoryFull'; item: string }
  | { type: 'equipped'; item: string; slot: EquipSlot }
  | { type: 'unequipped'; item: string; slot: EquipSlot }
  | { type: 'buffStarted'; stat: StatId; item: string; seconds: number }
  | { type: 'buffEnded'; stat: StatId }
  | { type: 'crafted'; recipe: string; item: string; count: number }
  | { type: 'craftFailed'; recipe: string; reason: string }
  | { type: 'upgraded'; item: string; level: number }
  | { type: 'stationOpened'; station: StationId }
  /** An ability's effects landed. (x, y) is the caster; (tx, ty) where it was aimed. */
  | { type: 'abilityUsed'; ability: string; slot: AbilitySlot; x: number; y: number; tx: number; ty: number }
  /** An ability key was pressed but the ability isn't ready. */
  | { type: 'abilityNotReady'; slot: AbilitySlot }
  | { type: 'abilityReady'; slot: AbilitySlot }
  | { type: 'blast'; ability: string; x: number; y: number; radius: number }
  | { type: 'empowered'; ability: string; seconds: number }
  | { type: 'empowerEnded'; ability: string }
  | { type: 'classChanged'; class: string }
  /** A relic awakened an ability slot; `ability` is what that slot holds for the current class. */
  | { type: 'abilityUnlocked'; slot: 'class' | 'super'; ability: string }
  /** An ability key was pressed for a slot not yet awakened. */
  | { type: 'abilityLocked'; slot: AbilitySlot }
  /** The player warped to a lit bonfire and is now resting there. */
  | { type: 'traveled'; id: string; name: string }
  | { type: 'leveledUp'; attribute: AttributeId; level: number };

export type SimEventType = SimEvent['type'];
