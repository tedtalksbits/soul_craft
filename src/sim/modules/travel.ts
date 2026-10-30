/**
 * Bonfire travel: while resting at a lit bonfire, warp to any other lit bonfire.
 * The game keeps every lit bonfire's name and position in `SimState.bonfires`,
 * because a far bonfire's chunk is not loaded, so its entity cannot be found.
 * A new game starts with the village bonfire lit, so home is always on the list.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import { Body, Bonfire, Motion, Player, Projectile } from '../components';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { restAt } from './interaction';
import { RESPAWN_OFFSET_Y } from './player';
import { updateStreaming } from './streaming';

/**
 * Records every loaded lit bonfire. This one rule covers lighting a bonfire, resting at it,
 * and saves from before the registry existed: a lit bonfire is added the next time it loads.
 */
function registerLitBonfires(sim: Simulation): void {
  for (const [, bonfire, body] of sim.ecs.query(Bonfire, Body)) {
    if (!sim.state.litBonfires[bonfire.id]) continue;
    const known = sim.state.bonfires[bonfire.id];
    if (known?.name === bonfire.name && known.x === body.x && known.y === body.y) continue;
    sim.state.bonfires[bonfire.id] = { name: bonfire.name, x: body.x, y: body.y };
  }
}

/** Lights the starting village's bonfire, so a new game can always travel home. */
export function kindleOrigin(sim: Simulation): void {
  const prefix = `${sim.content.world.origin.prefab}@origin#`;
  for (const [, bonfire] of sim.ecs.query(Bonfire)) {
    if (bonfire.id.startsWith(prefix)) sim.state.litBonfires[bonfire.id] = true;
  }
  registerLitBonfires(sim);
}

/**
 * Warps the resting player to a lit bonfire and rests them there (heal, refill, checkpoint,
 * enemies reset), just as if they had walked over and sat down.
 */
export function travelTo(sim: Simulation, id: string): void {
  const p = sim.ecs.need(sim.player, Player);
  const target = sim.state.bonfires[id];
  if (p.state !== 'sit' || !target || sim.state.checkpoint?.id === id) return;
  const body = sim.ecs.need(sim.player, Body);
  body.x = target.x;
  body.y = target.y + RESPAWN_OFFSET_Y;
  Object.assign(sim.ecs.need(sim.player, Motion), { vx: 0, vy: 0, kx: 0, ky: 0 });
  for (const [proj] of sim.ecs.query(Projectile)) sim.ecs.destroy(proj);
  // Load the destination now, so its bonfire entity exists to rest at.
  updateStreaming(sim);
  const here = bonfireEntity(sim, id);
  if (here === undefined) sim.state.checkpoint = { id, x: target.x, y: target.y };
  else restAt(sim, here);
  sim.events.emit({ type: 'traveled', id, name: target.name });
}

function bonfireEntity(sim: Simulation, id: string): Entity | undefined {
  for (const [e, bonfire] of sim.ecs.query(Bonfire)) if (bonfire.id === id) return e;
  return undefined;
}

function processActions(sim: Simulation): void {
  for (const action of sim.input.actions ?? []) {
    if (action.type === 'travel') travelTo(sim, action.bonfire);
  }
}

const commands: SimCommand[] = [
  {
    name: 'bonfires',
    description: 'List the lit bonfires the player can travel to.',
    run: ({ sim }) => {
      const list = Object.entries(sim.state.bonfires).map(
        ([id, b]) => `${id}: ${b.name} (${Math.round(b.x)}, ${Math.round(b.y)})`,
      );
      return list.length > 0 ? list.join('\n') : 'no lit bonfires';
    },
  },
  {
    name: 'travel',
    description: 'Warp to a lit bonfire by id (rests there first if needed).',
    args: [{ name: 'id', type: 'string', options: ({ sim }) => Object.keys(sim.state.bonfires) }],
    run: ({ sim }, a) => {
      const id = a.string('id');
      const target = sim.state.bonfires[id];
      if (!target) throw new CommandError(`no lit bonfire "${id}" (see "bonfires")`);
      const p = sim.ecs.need(sim.player, Player);
      p.state = 'sit';
      p.t = 0;
      sim.state.checkpoint = null;
      travelTo(sim, id);
      return `traveled to ${target.name}`;
    },
  },
];

export const travelModule: SimModule = {
  id: 'travel',
  systems: [
    { phase: 'world', run: registerLitBonfires },
    { phase: 'control', run: processActions },
  ],
  commands,
};
