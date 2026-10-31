import type { SimModule } from '../module';
import { abilitiesModule } from './abilities';
import { bossesModule } from './bosses';
import { combatModule } from './combat';
import { craftingModule } from './crafting';
import { enemiesModule } from './enemies';
import { interactionModule } from './interaction';
import { itemsModule } from './items';
import { mappingModule } from './mapping';
import { movementModule } from './movement';
import { objectivesModule } from './objectives';
import { overshieldModule } from './overshield';
import { pickupsModule } from './pickups';
import { playerModule } from './player';
import { progressionModule } from './progression';
import { projectilesModule } from './projectiles';
import { restorationModule } from './restoration';
import { stealthModule } from './stealth';
import { streamingModule } from './streaming';
import { travelModule } from './travel';
import { variantsModule } from './variants';

/**
 * Every simulation feature, in registration order. Within a phase, systems
 * run in this order. Add new features here.
 */
export const SIM_MODULES: readonly SimModule[] = [
  streamingModule,
  // Menu actions (equip, use, craft) apply before the player acts this tick.
  itemsModule,
  craftingModule,
  restorationModule,
  abilitiesModule,
  overshieldModule,
  progressionModule,
  variantsModule,
  playerModule,
  stealthModule,
  enemiesModule,
  movementModule,
  // After movement, so the fog gate holds the player where they ended up.
  bossesModule,
  projectilesModule,
  combatModule,
  pickupsModule,
  interactionModule,
  objectivesModule,
  travelModule,
  mappingModule,
];
