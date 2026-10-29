/**
 * Things the player can use: bonfires and signs. The client asks
 * {@link findInteraction} each frame to show a prompt; pressing "use" runs
 * {@link interact} from the player controller.
 */
import type { Entity } from '../../core/ecs';
import { DIR_VEC } from '../../core/math';
import { CommandError } from '../../core/commands';
import { STATIONS } from '../../content/schemas';
import { Body, Bonfire, Facing, Health, Player, Sign, Stamina, Station } from '../components';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { refreshAbilities } from './abilities';
import { resetEnemies } from './streaming';

export type Interaction =
  | { kind: 'bonfire'; entity: Entity; label: string }
  | { kind: 'sign'; entity: Entity; label: string }
  | { kind: 'station'; entity: Entity; label: string }
  | { kind: 'leave'; label: string };

/** How far in front of the player the interaction probe sits. */
const PROBE_REACH = 10;

export function findInteraction(sim: Simulation): Interaction | null {
  const { ecs } = sim;
  const e = sim.player;
  const p = ecs.need(e, Player);
  if (p.state === 'sit') return { kind: 'leave', label: 'Leave bonfire' };
  if (p.state !== 'free') return null;
  const body = ecs.need(e, Body);
  const [fx, fy] = DIR_VEC[ecs.need(e, Facing).dir];
  const px = body.x + fx * PROBE_REACH;
  const py = body.y + fy * PROBE_REACH;
  const range = sim.content.player.interactRange;

  let best: Interaction | null = null;
  let bestDist = Infinity;
  const consider = (b: Body, make: () => Interaction) => {
    const d = Math.min(Math.hypot(b.x - px, b.y - py), Math.hypot(b.x - body.x, b.y - body.y) + 4);
    if (d < range && d < bestDist) {
      bestDist = d;
      best = make();
    }
  };
  for (const [be, bonfire, b] of ecs.query(Bonfire, Body)) {
    const lit = sim.state.litBonfires[bonfire.id] === true;
    consider(b, () => ({ kind: 'bonfire', entity: be, label: lit ? 'Rest' : 'Light bonfire' }));
  }
  for (const [te, station, b] of ecs.query(Station, Body))
    consider(b, () => ({
      kind: 'station',
      entity: te,
      label: `Use ${STATIONS[station.station].toLowerCase()}`,
    }));
  for (const [se, , b] of ecs.query(Sign, Body))
    consider(b, () => ({ kind: 'sign', entity: se, label: 'Read' }));
  return best;
}

export function interact(sim: Simulation): void {
  const target = findInteraction(sim);
  if (!target || target.kind === 'leave') return;
  if (target.kind === 'bonfire') restAt(sim, target.entity);
  else if (target.kind === 'station')
    sim.events.emit({ type: 'stationOpened', station: sim.ecs.need(target.entity, Station).station });
  else sim.events.emit({ type: 'read', lines: [...sim.ecs.need(target.entity, Sign).lines] });
}

/** Lights (if needed) and rests at a bonfire: heal, refill, set checkpoint, respawn enemies. */
export function restAt(sim: Simulation, bonfireEntity: Entity): void {
  const { ecs } = sim;
  const bonfire = ecs.need(bonfireEntity, Bonfire);
  const at = ecs.need(bonfireEntity, Body);
  if (!sim.state.litBonfires[bonfire.id]) {
    sim.state.litBonfires[bonfire.id] = true;
    sim.events.emit({ type: 'bonfireLit', id: bonfire.id, name: bonfire.name });
  }
  sim.state.checkpoint = { id: bonfire.id, x: at.x, y: at.y };

  const e = sim.player;
  const p = ecs.need(e, Player);
  const health = ecs.need(e, Health);
  const stamina = ecs.need(e, Stamina);
  health.hp = health.max;
  stamina.value = stamina.max;
  p.flasks = p.maxFlasks;
  p.state = 'sit';
  p.t = 0;
  refreshAbilities(sim);
  resetEnemies(sim);
  sim.events.emit({ type: 'rested', id: bonfire.id, name: bonfire.name });
}

const commands: SimCommand[] = [
  {
    name: 'rest',
    description: 'Rest at the nearest loaded bonfire without walking there.',
    run: ({ sim }) => {
      const pb = sim.ecs.need(sim.player, Body);
      let nearest: Entity | undefined;
      let best = Infinity;
      for (const [e, , b] of sim.ecs.query(Bonfire, Body)) {
        const d = Math.hypot(b.x - pb.x, b.y - pb.y);
        if (d < best) [nearest, best] = [e, d];
      }
      if (nearest === undefined) throw new CommandError('no bonfire is loaded nearby');
      restAt(sim, nearest);
      return `rested at ${sim.ecs.need(nearest, Bonfire).name}`;
    },
  },
];

export const interactionModule: SimModule = { id: 'interaction', commands };
