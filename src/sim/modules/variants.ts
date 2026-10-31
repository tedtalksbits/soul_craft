/**
 * Ability variants: other versions of an ability the player learns with souls and picks while
 * resting at a bonfire, in place of the class's base ability in that slot. A variant is a whole
 * ability in content/abilities.json with `variantOf` naming its base, so new variants need no code.
 * Learned variants stay learned; swapping between learned ones is free.
 */
import { CommandError } from '../../core/commands';
import { ABILITY_SLOTS, type AbilityDef, type AbilitySlot } from '../../content/schemas';
import type { Content } from '../../content/content';
import { Abilities, Player } from '../components';
import type { PlayerAction } from '../input';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { slotUnlocked } from './unlocks';

/** A base ability and its variants: the base first, then its variants in file order. */
export function versionsOf(content: Content, base: string): [string, AbilityDef][] {
  const variants = Object.entries(content.abilities).filter(([, def]) => def.variantOf === base);
  return [[base, content.ability(base)], ...variants];
}

export type VariantCheck = { ok: true; cost: number } | { ok: false; reason: string };

/** The slot the player's class holds `base` in, if any. */
function slotOf(sim: Simulation, a: Abilities, base: string): AbilitySlot | undefined {
  const cls = sim.content.playerClass(a.class);
  return ABILITY_SLOTS.find((s) => cls.abilities[s] === base);
}

/**
 * Whether the player can switch `base` to `ability` now (the base itself to switch back), and
 * what it costs: nothing once learned, else the variant's souls.
 */
export function canChoose(sim: Simulation, base: string, ability: string): VariantCheck {
  const a = sim.ecs.need(sim.player, Abilities);
  const p = sim.ecs.need(sim.player, Player);
  const def = sim.content.abilities[ability];
  const slot = slotOf(sim, a, base);
  if (!def || slot === undefined || (ability !== base && def.variantOf !== base))
    return { ok: false, reason: 'not a version of your ability' };
  if (!slotUnlocked(a, slot)) return { ok: false, reason: 'not yet awakened' };
  if (p.state !== 'sit') return { ok: false, reason: 'rest at a bonfire to change' };
  const cost = ability === base || a.learned[ability] ? 0 : (def.souls ?? 0);
  if (p.souls < cost) return { ok: false, reason: `needs ${cost} souls` };
  return { ok: true, cost };
}

/** Learns (if needed) and switches to a version. No checks: callers check first. */
function choose(sim: Simulation, base: string, ability: string, cost: number): void {
  const a = sim.ecs.need(sim.player, Abilities);
  if (ability !== base && !a.learned[ability]) {
    sim.ecs.need(sim.player, Player).souls -= cost;
    a.learned[ability] = true;
    sim.events.emit({ type: 'variantLearned', ability });
  }
  if (ability === base) Reflect.deleteProperty(a.chosen, base);
  else a.chosen[base] = ability;
  sim.events.emit({ type: 'variantChosen', base, ability });
}

function chooseVariant(sim: Simulation, action: Extract<PlayerAction, { type: 'chooseVariant' }>): void {
  const check = canChoose(sim, action.base, action.ability);
  if (check.ok) choose(sim, action.base, action.ability, check.cost);
}

function processActions(sim: Simulation): void {
  for (const action of sim.input.actions ?? [])
    if (action.type === 'chooseVariant') chooseVariant(sim, action);
}

const commands: SimCommand[] = [
  {
    name: 'variant',
    description: 'Learn and use an ability variant (free, anywhere), or its base to switch back.',
    args: [
      {
        name: 'ability',
        type: 'string',
        options: ({ sim }) =>
          Object.entries(sim.content.abilities)
            .filter(([, d]) => d.variantOf !== undefined)
            .map(([id]) => id),
      },
    ],
    run: ({ sim }, args) => {
      const id = args.string('ability');
      const base = sim.content.baseAbility(id);
      const a = sim.ecs.need(sim.player, Abilities);
      if (!sim.content.abilities[id]) throw new CommandError(`unknown ability "${id}"`);
      if (slotOf(sim, a, base) === undefined) throw new CommandError(`your class has no "${base}"`);
      choose(sim, base, id, 0);
      return `${sim.content.ability(base).name} is now ${sim.content.ability(id).name}`;
    },
  },
];

export const variantsModule: SimModule = {
  id: 'variants',
  systems: [{ phase: 'control', run: processActions }],
  commands,
};
