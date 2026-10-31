/**
 * The story's objectives: Maren tells the player what she needs, the HUD tracks it, and the map
 * never marks it (docs/story.md). Objectives run in the order of content/objectives.json; the next
 * is offered when the player talks to its giver after reporting the last one done.
 *
 * Goals are read from the world rather than counted as they happen, so one met early (a knight
 * beaten before Maren asked) completes the moment it is reported. Relics are brought here too:
 * talking to Maren while carrying one hands it over and awakens its ability slot.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import type { ObjectiveDef, ObjectiveGoal } from '../../content/schemas';
import { Abilities, Inventory, Npc } from '../components';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { countItem, removeItem } from './items';
import { unlockSlot } from './unlocks';

export function goalMet(sim: Simulation, goal: ObjectiveGoal): boolean {
  switch (goal.type) {
    case 'unlock':
      return sim.ecs.get(sim.player, Abilities)?.unlocked[goal.slot] === true;
    case 'defeat':
      return sim.state.bossesDefeated[goal.boss] === true;
    case 'restore':
      return sim.state.restored[goal.project] === true;
  }
}

/** The first objective not yet done or under way, in file order. */
function nextObjective(sim: Simulation): [string, ObjectiveDef] | undefined {
  const { active, done } = sim.state.objectives;
  return Object.entries(sim.content.objectives).find(([id]) => !done[id] && id !== active);
}

function giverName(sim: Simulation, objective: ObjectiveDef): string {
  return sim.content.npcs[objective.giver]?.name ?? objective.giver;
}

/**
 * The HUD's objective line: what the player is doing, that they should report back, or who to
 * talk to for the next one. Null once the story has nothing more to ask.
 */
export function objectiveText(sim: Simulation): string | null {
  const { active } = sim.state.objectives;
  const def = active !== null ? sim.content.objectives[active] : undefined;
  if (def) return goalMet(sim, def.goal) ? `Return to ${giverName(sim, def)}.` : def.track;
  const next = nextObjective(sim);
  return next ? `Speak with ${giverName(sim, next[1])}.` : null;
}

/** Hands every carried relic to the giver, awakening its slot. */
function handInRelics(sim: Simulation): void {
  const inv = sim.ecs.get(sim.player, Inventory);
  if (!inv) return;
  for (const [id, def] of Object.entries(sim.content.items)) {
    if (def.kind !== 'relic' || countItem(inv, id) === 0) continue;
    removeItem(inv, id, countItem(inv, id));
    unlockSlot(sim, def.unlocks);
  }
}

/**
 * The player talks to someone. Givers hand out and close objectives, as many in a row as the
 * world already allows (bring the oath before being asked, and Maren asks, then thanks you).
 */
export function talkTo(sim: Simulation, npcEntity: Entity): void {
  const npc = sim.ecs.need(npcEntity, Npc).npc;
  const def = sim.content.npcs[npc];
  if (!def) return;
  const state = sim.state.objectives;
  const lines: string[] = [];
  for (;;) {
    if (state.active === null) {
      const next = nextObjective(sim);
      if (!next || next[1].giver !== npc) break;
      state.active = next[0];
      lines.push(...next[1].lines);
      sim.events.emit({ type: 'objectiveStarted', objective: next[0] });
    }
    const active = sim.content.objectives[state.active];
    if (!active || active.giver !== npc) break;
    handInRelics(sim);
    if (!goalMet(sim, active.goal)) {
      if (lines.length === 0) lines.push(...active.reminder);
      break;
    }
    lines.push(...active.doneLines);
    state.done[state.active] = true;
    sim.events.emit({ type: 'objectiveCompleted', objective: state.active });
    state.active = null;
  }
  if (lines.length === 0) lines.push(...def.idleLines);
  sim.events.emit({ type: 'spoke', npc, name: def.name, lines });
}

const commands: SimCommand[] = [
  {
    name: 'objective',
    description: 'Show the objective; "done" finishes it; an objective id jumps to it.',
    args: [
      {
        name: 'to',
        type: 'string',
        optional: true,
        options: ({ sim }) => ['done', ...Object.keys(sim.content.objectives)],
      },
    ],
    run: ({ sim }, a) => {
      const state = sim.state.objectives;
      const arg = a.optString('to');
      if (arg === undefined) return `${state.active ?? '(none)'}: ${objectiveText(sim) ?? 'nothing left'}`;
      const ids = Object.keys(sim.content.objectives);
      if (arg === 'done') {
        if (state.active === null) throw new CommandError('no objective under way');
        state.done[state.active] = true;
        state.active = null;
        return `done; next: ${objectiveText(sim) ?? 'nothing left'}`;
      }
      const at = ids.indexOf(arg);
      if (at < 0) throw new CommandError(`unknown objective "${arg}" (known: ${ids.join(', ')})`);
      state.done = Object.fromEntries(ids.slice(0, at).map((id) => [id, true as const]));
      state.active = arg;
      return `now on ${arg}: ${objectiveText(sim) ?? ''}`;
    },
  },
];

export const objectivesModule: SimModule = { id: 'objectives', commands };
