/**
 * Leveling at bonfires: souls buy levels, each raising one attribute. Vigor adds max health,
 * Endurance max stamina, Might sword damage and Attunement ability damage and super charge.
 * Numbers live in `player.json → leveling`. Also the dev commands for levels and unlocks.
 */
import { CommandError } from '../../core/commands';
import type { Entity } from '../../core/ecs';
import { ATTRIBUTES, type AttributeId } from '../../content/schemas';
import { Attributes, Player } from '../components';
import type { PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { syncVitals } from './items';
import { unlockSlot } from './unlocks';

/** A freshly spawned player: level 1, nothing spent. */
export function giveStartingAttributes(sim: Simulation, e: Entity): void {
  sim.ecs.add(e, Attributes, { vigor: 0, endurance: 0, might: 0, attunement: 0 });
}

/** The player's level: one, plus every point spent. */
export function playerLevel(attrs: Attributes): number {
  return 1 + ATTRIBUTES.reduce((n, id) => n + attrs[id], 0);
}

/** Souls the next level costs, from the level the player is leaving. */
export function levelCost(sim: Simulation): number {
  const attrs = sim.ecs.need(sim.player, Attributes);
  const { base, growth } = sim.content.player.leveling.cost;
  return Math.round(base * growth ** (playerLevel(attrs) - 1));
}

/** How much stronger Attunement makes the player's abilities (1 = no bonus). */
export function abilityPower(sim: Simulation): number {
  const attunement = sim.ecs.get(sim.player, Attributes)?.attunement ?? 0;
  return 1 + attunement * sim.content.player.leveling.perLevel.attunement.abilityDamage;
}

export type LevelCheck = { ok: true; cost: number } | { ok: false; reason: string };

/** Whether the player can level now: resting at a bonfire, with the souls for it. */
export function canLevelUp(sim: Simulation): LevelCheck {
  const p = sim.ecs.need(sim.player, Player);
  const cost = levelCost(sim);
  if (p.state !== 'sit') return { ok: false, reason: 'rest at a bonfire to level up' };
  if (p.souls < cost) return { ok: false, reason: `needs ${cost} souls` };
  return { ok: true, cost };
}

function raise(sim: Simulation, attribute: AttributeId, cost: number): void {
  const attrs = sim.ecs.need(sim.player, Attributes);
  sim.ecs.need(sim.player, Player).souls -= cost;
  attrs[attribute]++;
  syncVitals(sim, sim.player);
  sim.events.emit({ type: 'leveledUp', attribute, level: playerLevel(attrs) });
}

function levelUp(sim: Simulation, action: Extract<PlayerAction, { type: 'levelUp' }>): void {
  const check = canLevelUp(sim);
  if (check.ok) raise(sim, action.attribute, check.cost);
}

function processActions(sim: Simulation): void {
  for (const action of sim.input.actions ?? []) if (action.type === 'levelUp') levelUp(sim, action);
}

// ------------------------------------------------------------------ dev commands

const commands: SimCommand[] = [
  {
    name: 'level',
    description: 'Raise an attribute by n levels (free, anywhere).',
    args: [
      { name: 'attribute', type: 'string', options: () => [...ATTRIBUTES] },
      { name: 'n', type: 'number', integer: true, optional: true },
    ],
    run: ({ sim }, a) => {
      const id = ATTRIBUTES.find((x) => x === a.string('attribute'));
      if (!id) throw new CommandError(`unknown attribute; one of ${ATTRIBUTES.join(', ')}`);
      const n = a.optNumber('n') ?? 1;
      if (n < 1 || n > 99) throw new CommandError('n must be 1-99');
      for (let i = 0; i < n; i++) raise(sim, id, 0);
      return `${id} ${sim.ecs.need(sim.player, Attributes)[id]}, level ${playerLevel(sim.ecs.need(sim.player, Attributes))}`;
    },
  },
  {
    name: 'unlock',
    description: 'Awaken an ability slot: class, super or all.',
    args: [{ name: 'slot', type: 'string', options: () => ['class', 'super', 'all'] }],
    run: ({ sim }, a) => {
      const slot = a.string('slot');
      if (slot !== 'class' && slot !== 'super' && slot !== 'all')
        throw new CommandError('class, super or all');
      if (slot !== 'super') unlockSlot(sim, 'class');
      if (slot !== 'class') unlockSlot(sim, 'super');
      return `unlocked ${slot}`;
    },
  },
];

export const progressionModule: SimModule = {
  id: 'progression',
  systems: [{ phase: 'control', run: processActions }],
  commands,
};
