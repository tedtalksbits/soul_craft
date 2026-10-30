/**
 * Village restoration: ruined sites in the starting village that the player
 * rebuilds with wood, stone and souls (and, for a major project, a boss's
 * Kindling). This is where gathered wood and stone go. Each project is authored
 * in content/restoration.json; rebuilding one applies its effects for good.
 * Flask charges are granted here once; the other effects are read where they
 * apply (see restored-effects.ts).
 */
import { CommandError } from '../../core/commands';
import { Body, Inventory, Player, Project } from '../components';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import type { Check } from './crafting';
import { countItem, removeItem } from './items';

/** How far from a site (in multiples of the interact range) the player may still rebuild it. */
const SITE_REACH = 2;

const fail = (reason: string): Check => ({ ok: false, reason });

/** A project's name as it reads mid-sentence: "The Smithy" becomes "the smithy". */
export function projectName(sim: Simulation, id: string): string {
  return (sim.content.restoration[id]?.name ?? id).toLowerCase();
}

export function siteNearby(sim: Simulation, project: string): boolean {
  const pb = sim.ecs.need(sim.player, Body);
  const reach = sim.content.player.interactRange * SITE_REACH;
  for (const [, site, b] of sim.ecs.query(Project, Body)) {
    if (site.project === project && Math.hypot(b.x - pb.x, b.y - pb.y) <= reach) return true;
  }
  return false;
}

interface RebuildOpts {
  /** Skip the distance check (dev command). */
  anywhere?: boolean;
  /** Skip the cost (dev command). */
  free?: boolean;
}

export function canRebuild(sim: Simulation, id: string, opts: RebuildOpts = {}): Check {
  const def = sim.content.restoration[id];
  if (!def) return fail('no such project');
  if (sim.state.restored[id]) return fail('already rebuilt');
  if (!opts.anywhere && !siteNearby(sim, id)) return fail('too far from the site');
  if (opts.free) return { ok: true };
  const e = sim.player;
  const inv = sim.ecs.need(e, Inventory);
  for (const input of def.cost.items) {
    if (countItem(inv, input.item) < input.count)
      return fail(`needs ${input.count} ${sim.content.item(input.item).name}`);
  }
  if (sim.ecs.need(e, Player).souls < def.cost.souls) return fail('not enough souls');
  return { ok: true };
}

/** Spends the cost and rebuilds a project. Returns whether it happened. */
export function rebuild(sim: Simulation, id: string, opts: RebuildOpts = {}): boolean {
  const def = sim.content.restoration[id];
  const check = canRebuild(sim, id, opts);
  if (!check.ok || !def) {
    sim.events.emit({
      type: 'rebuildFailed',
      project: id,
      reason: check.ok ? 'no such project' : check.reason,
    });
    return false;
  }
  const p = sim.ecs.need(sim.player, Player);
  if (!opts.free) {
    const inv = sim.ecs.need(sim.player, Inventory);
    for (const input of def.cost.items) removeItem(inv, input.item, input.count);
    p.souls -= def.cost.souls;
  }
  sim.state.restored[id] = true;
  for (const fx of def.effects) {
    // The one effect stored on the player rather than read from `restored`: a new charge, filled.
    if (fx.type === 'maxFlasks') {
      p.maxFlasks += fx.amount;
      p.flasks += fx.amount;
    }
  }
  sim.events.emit({ type: 'restored', project: id });
  return true;
}

function processActions(sim: Simulation): void {
  if (sim.ecs.need(sim.player, Player).state === 'dead') return;
  for (const action of sim.input.actions ?? []) {
    if (action.type === 'rebuild') rebuild(sim, action.project);
  }
}

const projectOptions = ({ sim }: { sim: Simulation }) => Object.keys(sim.content.restoration);

const commands: SimCommand[] = [
  {
    name: 'rebuild',
    description: 'Rebuild a village project from anywhere. Add "free" to skip the cost.',
    args: [
      { name: 'project', type: 'string', options: projectOptions },
      { name: 'free', type: 'string', optional: true, options: () => ['free'] },
    ],
    run: ({ sim }, a) => {
      const id = a.string('project');
      const opts = { anywhere: true, free: a.optString('free') === 'free' };
      const check = canRebuild(sim, id, opts);
      if (!check.ok) throw new CommandError(check.reason);
      rebuild(sim, id, opts);
      return `rebuilt ${id}`;
    },
  },
  {
    name: 'projects',
    description: 'List the village projects and which are rebuilt.',
    run: ({ sim }) =>
      Object.entries(sim.content.restoration)
        .map(([id, def]) => `${sim.state.restored[id] ? '[x]' : '[ ]'} ${id}  ${def.name}`)
        .join('\n'),
  },
];

export const restorationModule: SimModule = {
  id: 'restoration',
  systems: [{ phase: 'control', run: processActions }],
  commands,
};
