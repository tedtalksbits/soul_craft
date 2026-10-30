import type { SimModule } from '../module';
import { abilitiesModule } from './abilities';
import { combatModule } from './combat';
import { craftingModule } from './crafting';
import { enemiesModule } from './enemies';
import { interactionModule } from './interaction';
import { itemsModule } from './items';
import { movementModule } from './movement';
import { pickupsModule } from './pickups';
import { playerModule } from './player';
import { progressionModule } from './progression';
import { projectilesModule } from './projectiles';
import { streamingModule } from './streaming';
import { travelModule } from './travel';

/**
 * Every simulation feature, in registration order. Within a phase, systems
 * run in this order. Add new features here.
 */
export const SIM_MODULES: readonly SimModule[] = [
  streamingModule,
  // Menu actions (equip, use, craft) apply before the player acts this tick.
  itemsModule,
  craftingModule,
  abilitiesModule,
  progressionModule,
  playerModule,
  enemiesModule,
  movementModule,
  projectilesModule,
  combatModule,
  pickupsModule,
  interactionModule,
  travelModule,
];
