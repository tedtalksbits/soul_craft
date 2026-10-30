/**
 * Crafting and forge upgrades. Recipes cost materials plus souls and are made
 * at a station (forge, alchemy table) or anywhere. The `can*` functions are
 * pure checks the menu uses to show what is possible; the actions re-check
 * before changing anything.
 */
import { CommandError } from '../../core/commands';
import { STATIONS, type StationId } from '../../content/schemas';
import { Body, Equipment, Inventory, Player, Station } from '../components';
import type { PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { addItem, countItem, removeItem, roomFor } from './items';
import { projectName } from './restoration';

/** How far from a station the player may still use it, in multiples of the interact range. */
const STATION_REACH = 2;

export type Check = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): Check => ({ ok: false, reason });

export function stationNearby(sim: Simulation, station: StationId): boolean {
  const pb = sim.ecs.need(sim.player, Body);
  const reach = sim.content.player.interactRange * STATION_REACH;
  for (const [, s, b] of sim.ecs.query(Station, Body)) {
    if (s.station === station && Math.hypot(b.x - pb.x, b.y - pb.y) <= reach) return true;
  }
  return false;
}

export function canCraft(sim: Simulation, recipeId: string, opts: { ignoreStation?: boolean } = {}): Check {
  const recipe = sim.content.recipes[recipeId];
  if (!recipe) return fail('no such recipe');
  if (recipe.station && !opts.ignoreStation && !stationNearby(sim, recipe.station))
    return fail(`needs a ${STATIONS[recipe.station].toLowerCase()}`);
  const e = sim.player;
  if (sim.ecs.need(e, Player).souls < recipe.souls) return fail('not enough souls');
  const inv = sim.ecs.need(e, Inventory);
  for (const input of recipe.inputs) {
    if (countItem(inv, input.item) < input.count)
      return fail(`needs ${input.count} ${sim.content.item(input.item).name}`);
  }
  if (roomFor(sim, e, recipe.output.item) < recipe.output.count) return fail('inventory is full');
  return { ok: true };
}

export function craft(sim: Simulation, recipeId: string, opts: { ignoreStation?: boolean } = {}): boolean {
  const check = canCraft(sim, recipeId, opts);
  if (!check.ok) {
    sim.events.emit({ type: 'craftFailed', recipe: recipeId, reason: check.reason });
    return false;
  }
  const recipe = sim.content.recipes[recipeId]!;
  const e = sim.player;
  const inv = sim.ecs.need(e, Inventory);
  for (const input of recipe.inputs) removeItem(inv, input.item, input.count);
  sim.ecs.need(e, Player).souls -= recipe.souls;
  addItem(sim, e, recipe.output.item, recipe.output.count);
  sim.events.emit({
    type: 'crafted',
    recipe: recipeId,
    item: recipe.output.item,
    count: recipe.output.count,
  });
  return true;
}

/** The equipped weapon's next forge upgrade, or null when maxed or unarmed. */
export function nextUpgrade(sim: Simulation) {
  const weapon = sim.ecs.need(sim.player, Equipment).weapon;
  const def = weapon ? sim.content.items[weapon.item] : undefined;
  if (!weapon || def?.kind !== 'weapon') return null;
  const step = def.upgrades[weapon.level];
  return step ? { item: weapon.item, level: weapon.level + 1, ...step } : null;
}

export function canUpgrade(sim: Simulation, opts: { ignoreStation?: boolean } = {}): Check {
  const next = nextUpgrade(sim);
  if (!next) return fail('cannot be upgraded further');
  if (!opts.ignoreStation && !stationNearby(sim, 'forge')) return fail('needs a forge');
  // The last steps need a master's hand: they wait on a rebuilt project (the smithy).
  if (next.requires && !sim.state.restored[next.requires])
    return fail(`needs ${projectName(sim, next.requires)} rebuilt`);
  const e = sim.player;
  if (sim.ecs.need(e, Player).souls < next.souls) return fail('not enough souls');
  const inv = sim.ecs.need(e, Inventory);
  for (const input of next.items) {
    if (countItem(inv, input.item) < input.count)
      return fail(`needs ${input.count} ${sim.content.item(input.item).name}`);
  }
  return { ok: true };
}

export function upgradeWeapon(sim: Simulation, opts: { ignoreStation?: boolean } = {}): boolean {
  const check = canUpgrade(sim, opts);
  const next = nextUpgrade(sim);
  if (!check.ok || !next) {
    sim.events.emit({
      type: 'craftFailed',
      recipe: 'upgrade',
      reason: check.ok ? 'cannot upgrade' : check.reason,
    });
    return false;
  }
  const e = sim.player;
  const inv = sim.ecs.need(e, Inventory);
  for (const input of next.items) removeItem(inv, input.item, input.count);
  sim.ecs.need(e, Player).souls -= next.souls;
  const weapon = sim.ecs.need(e, Equipment).weapon!;
  weapon.level = next.level;
  sim.events.emit({ type: 'upgraded', item: weapon.item, level: weapon.level });
  return true;
}

function applyAction(sim: Simulation, action: PlayerAction): void {
  if (action.type === 'craft') craft(sim, action.recipe);
  else if (action.type === 'upgrade') upgradeWeapon(sim);
}

function processActions(sim: Simulation): void {
  if (sim.ecs.need(sim.player, Player).state === 'dead') return;
  for (const action of sim.input.actions ?? []) applyAction(sim, action);
}

const commands: SimCommand[] = [
  {
    name: 'craft',
    description: 'Craft a recipe now, ignoring station range (materials and souls are still spent).',
    args: [{ name: 'recipe', type: 'string', options: ({ sim }) => Object.keys(sim.content.recipes) }],
    run: ({ sim }, a) => {
      const id = a.string('recipe');
      const check = canCraft(sim, id, { ignoreStation: true });
      if (!check.ok) throw new CommandError(check.reason);
      craft(sim, id, { ignoreStation: true });
      return `crafted ${id}`;
    },
  },
  {
    name: 'upgrade',
    description: 'Upgrade the equipped weapon now, ignoring forge range.',
    run: ({ sim }) => {
      const check = canUpgrade(sim, { ignoreStation: true });
      if (!check.ok) throw new CommandError(check.reason);
      upgradeWeapon(sim, { ignoreStation: true });
      const w = sim.ecs.need(sim.player, Equipment).weapon!;
      return `${w.item} is now +${w.level}`;
    },
  },
];

export const craftingModule: SimModule = {
  id: 'crafting',
  systems: [{ phase: 'control', run: processActions }],
  commands,
};
