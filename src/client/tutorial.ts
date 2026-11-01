/**
 * First-time hints: the first time an ability is ready while an enemy is close,
 * and the first time the super is charged, a card names its key and says what
 * it does; the first time the pack holds gear that would raise Power, with no
 * enemy close, a card sends the player to the equipment screen. Each shows once
 * per device (the ids live in settings, and the settings screen can reset them).
 * Pure presentation: it only reads sim state.
 */
import { ABILITY_SLOTS, type AbilitySlot } from '../content/schemas';
import { Abilities, Body, Dying, Enemy, Inventory, Player } from '../sim/components';
import { slotReady } from '../sim/modules/abilities';
import { compareGear } from '../sim/modules/items';
import { slotUnlocked } from '../sim/modules/unlocks';
import type { Simulation } from '../sim/simulation';
import { primaryKey, type Binding } from './keybinds';
import type { SettingsStore } from './settings';
import type { Ui } from './ui/ui';

/** How close (px) an enemy must be for an ability hint to be worth showing. */
const NEAR = 110;
/** Ticks (8 s) between hints, so two never arrive at once. */
const GAP_TICKS = 8 * 60;

const SLOT_BINDING: Readonly<Record<AbilitySlot, Binding>> = {
  aoe: 'aoe',
  class: 'classAbility',
  super: 'super',
};

/** The piece in the pack that would raise Power the most, with Power now and after, if any would. */
export function betterGear(sim: Simulation): { item: string; now: number; after: number } | null {
  const stacks = sim.ecs.get(sim.player, Inventory)?.stacks ?? [];
  let best: { item: string; now: number; after: number } | null = null;
  for (const [i, stack] of stacks.entries()) {
    if (!stack.gear) continue;
    const c = compareGear(sim, i);
    if (c && c.after.power > c.now.power && c.after.power > (best?.after ?? 0))
      best = { item: stack.item, now: c.now.power, after: c.after.power };
  }
  return best;
}

export class Tutorial {
  private quietUntil = 0;
  /** The game the gap was timed in; a new game restarts the tick count. */
  private sim: Simulation | null = null;

  constructor(
    private readonly settings: SettingsStore,
    private readonly ui: Ui,
    private readonly abilityIcon: (ability: string) => HTMLElement,
    private readonly itemIcon: (item: string) => HTMLElement,
  ) {}

  update(sim: Simulation): void {
    if (sim !== this.sim) {
      this.sim = sim;
      this.quietUntil = 0;
    }
    if (sim.tick < this.quietUntil) return;
    const a = sim.ecs.get(sim.player, Abilities);
    const p = sim.ecs.get(sim.player, Player);
    const pb = sim.ecs.get(sim.player, Body);
    const cls = a ? sim.content.classes[a.class] : undefined;
    if (!a || !p || !pb || !cls || p.state === 'dead') return;
    const seen = this.settings.current.seenHints;
    const enemyNear = [...sim.ecs.query(Enemy, Body)].some(
      ([e, , b]) => !sim.ecs.has(e, Dying) && Math.hypot(b.x - pb.x, b.y - pb.y) < NEAR,
    );

    for (const slot of ABILITY_SLOTS) {
      const ability = cls.abilities[slot];
      const id = `ability:${ability}`;
      if (seen.includes(id) || !slotUnlocked(a, slot) || !slotReady(a, slot)) continue;
      // Cooldown abilities are taught in a fight; the super the moment it first charges.
      if (slot !== 'super' && !enemyNear) continue;
      const def = sim.content.ability(ability);
      const key = primaryKey(this.settings.current.bindings, SLOT_BINDING[slot]);
      const lead = slot === 'super' ? 'Your super is charged.' : 'Ability ready.';
      this.ui.hint({
        key,
        title: `${lead} ${def.name}`,
        text: slot === 'aoe' ? `${def.description} Hold the key to aim, release to throw.` : def.description,
        footer: `All your abilities: ${primaryKey(this.settings.current.bindings, 'inventory')}, then Abilities.`,
        color: cls.element.light,
        icon: this.abilityIcon(ability),
      });
      this.settings.update({ seenHints: [...seen, id] });
      this.quietUntil = sim.tick + GAP_TICKS;
      return;
    }

    // Never in a fight: the card waits until the area is quiet.
    const better = !seen.includes('gear') && !enemyNear ? betterGear(sim) : null;
    if (better) {
      const pack = primaryKey(this.settings.current.bindings, 'inventory');
      this.ui.hint({
        key: pack,
        title: `New gear: ${sim.content.item(better.item).name}`,
        text: `Wearing it would raise your Power from ${better.now} to ${better.after}. Open your pack to compare it with what you wear, then equip it.`,
        footer: 'Power sums up your gear and levels. Nothing is ever locked behind it.',
        color: '#ecc87a',
        icon: this.itemIcon(better.item),
      });
      this.settings.update({ seenHints: [...seen, 'gear'] });
      this.quietUntil = sim.tick + GAP_TICKS;
    }
  }
}
