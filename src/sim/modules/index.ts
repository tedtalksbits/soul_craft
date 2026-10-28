import type { SimModule } from '../module';
import { combatModule } from './combat';
import { enemiesModule } from './enemies';
import { interactionModule } from './interaction';
import { movementModule } from './movement';
import { pickupsModule } from './pickups';
import { playerModule } from './player';
import { projectilesModule } from './projectiles';
import { streamingModule } from './streaming';

/**
 * Every simulation feature, in registration order. Within a phase, systems
 * run in this order. Add new features here.
 */
export const SIM_MODULES: readonly SimModule[] = [
  streamingModule,
  playerModule,
  enemiesModule,
  movementModule,
  projectilesModule,
  combatModule,
  pickupsModule,
  interactionModule,
];
