/**
 * The story's objectives: Maren tells the player what she needs, the HUD tracks it, and the map
 * never marks it (docs/story.md). Objectives run in the order of content/objectives.json; the next
 * is offered when the player talks to its giver after reporting the last one done.
 *
 * Goals are read from the world rather than counted as they happen, so one met early (a knight
 * beaten before Maren asked) completes the moment it is reported. Kills are the exception: "clear
 * the camp" means the camp as it stands now, so they count from the moment the objective is given.
 * Relics are brought here too: talking to Maren while carrying one hands it over and awakens its
 * ability slot.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import type { ObjectiveDef, ObjectiveGoal, ObjectiveStepGoal } from '../../content/schemas';
import { Abilities, Body, Inventory, Npc } from '../components';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { addItem, countItem, removeItem } from './items';
import { dropPickup } from './pickups';
import { unlockSlot } from './unlocks';

const stepsOf = (goal: ObjectiveGoal): ObjectiveStepGoal[] =>
  goal.type === 'all' ? goal.steps.map((s) => s.goal) : [goal];

const carried = (sim: Simulation, item: string) => {
  const inv = sim.ecs.get(sim.player, Inventory);
  return inv ? countItem(inv, item) : 0;
};

function stepMet(sim: Simulation, goal: ObjectiveStepGoal): boolean {
  switch (goal.type) {
    case 'unlock':
      return sim.ecs.get(sim.player, Abilities)?.unlocked[goal.slot] === true;
    case 'defeat':
      return sim.state.bossesDefeated[goal.boss] === true;
    case 'restore':
      return sim.state.restored[goal.project] === true;
    case 'kill':
      return Object.entries(goal.enemies).every(([e, n]) => (sim.state.objectives.kills?.[e] ?? 0) >= n);
    case 'gather':
      return carried(sim, goal.item) >= goal.count;
  }
}

export function goalMet(sim: Simulation, goal: ObjectiveGoal): boolean {
  return stepsOf(goal).every((g) => stepMet(sim, g));
}

/** Counts a kill toward the objective under way, if one of its goals wants that kind. */
export function countKill(sim: Simulation, archetype: string): void {
  const state = sim.state.objectives;
  const def = state.active !== null ? sim.content.objectives[state.active] : undefined;
  if (!def || !stepsOf(def.goal).some((g) => g.type === 'kill' && archetype in g.enemies)) return;
  state.kills = { ...state.kills, [archetype]: (state.kills?.[archetype] ?? 0) + 1 };
}

const counted = (have: number, want: number, name: string) =>
  `${Math.min(have, want)}/${want} ${want > 1 && !name.endsWith('s') ? `${name}s` : name}`;

/** How far along a counted goal is ("3/5 Hollows"), or null for one that is simply done or not. */
function progress(sim: Simulation, goal: ObjectiveStepGoal): string | null {
  if (goal.type === 'kill')
    return Object.entries(goal.enemies)
      .map(([e, n]) => counted(sim.state.objectives.kills?.[e] ?? 0, n, sim.content.enemies[e]?.name ?? e))
      .join(', ');
  if (goal.type === 'gather')
    return counted(carried(sim, goal.item), goal.count, sim.content.item(goal.item).name);
  return null;
}

/** The HUD text while an objective is under way: its line, then each step ticked off or counted. */
function trackText(sim: Simulation, def: ObjectiveDef): string {
  if (def.goal.type !== 'all') {
    const done = progress(sim, def.goal);
    return done ? `${def.track} (${done})` : def.track;
  }
  const steps = def.goal.steps.map(({ text, goal }) => {
    if (stepMet(sim, goal)) return `✓ ${text}`;
    const sofar = progress(sim, goal);
    return sofar ? `· ${text}: ${sofar}` : `· ${text}`;
  });
  return [def.track, ...steps].join('\n');
}

/**
 * Reporting an objective done: the giver takes what was gathered for them and hands over the reward
 * (set at the player's feet when the pack is full).
 */
function settle(sim: Simulation, def: ObjectiveDef): void {
  const inv = sim.ecs.get(sim.player, Inventory);
  if (inv)
    for (const g of stepsOf(def.goal)) if (g.type === 'gather' && g.consume) removeItem(inv, g.item, g.count);
  const pb = sim.ecs.need(sim.player, Body);
  for (const r of def.reward) {
    const left = addItem(sim, sim.player, r.item, r.count);
    if (r.count > left)
      sim.events.emit({ type: 'itemGained', item: r.item, count: r.count - left, tier: null });
    if (left > 0) dropPickup(sim, 'item', left, pb.x, pb.y, r.item);
  }
  delete sim.state.objectives.kills;
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
  if (def) return goalMet(sim, def.goal) ? `Return to ${giverName(sim, def)}.` : trackText(sim, def);
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
      delete state.kills;
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
    settle(sim, active);
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
      delete state.kills;
      return `now on ${arg}: ${objectiveText(sim) ?? ''}`;
    },
  },
];

export const objectivesModule: SimModule = { id: 'objectives', commands };
