import type { Entity } from '../core/ecs';
import type { PickupKind } from './components';

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
    }
  | { type: 'blocked'; x: number; y: number }
  | { type: 'killed'; target: Entity; archetype: string; x: number; y: number; souls: number }
  | { type: 'swing'; x: number; y: number; dirX: number; dirY: number }
  | { type: 'roll' }
  | { type: 'healed'; amount: number }
  | { type: 'flaskEmpty' }
  | { type: 'tileCut'; x: number; y: number }
  | { type: 'pickedUp'; kind: PickupKind; amount: number }
  | { type: 'enemyAttack'; entity: Entity; kind: 'lunge' | 'charge' | 'shoot' }
  | { type: 'wallSlam'; x: number; y: number }
  | { type: 'bonfireLit'; id: string; name: string }
  | { type: 'rested'; id: string; name: string }
  | { type: 'read'; lines: string[] }
  | { type: 'playerDied'; soulsLost: number }
  | { type: 'playerRespawned' }
  | { type: 'areaEntered'; name: string; firstVisit: boolean };

export type SimEventType = SimEvent['type'];
