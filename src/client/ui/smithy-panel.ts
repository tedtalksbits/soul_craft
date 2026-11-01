/**
 * Smithy work on one piece of gear, for the equipment screen's details panel: lock and junk marks,
 * salvage, upgrades, infusing, tempering and cleansing. Every button shows its price and, when it can't be
 * used, why; work that needs the forge or the smith only appears there (or, for salvage, at a bonfire).
 */
import { gearSlotOf } from '../../content/content';
import type { ItemCount } from '../../content/schemas';
import { Equipment, Inventory, Player, type ItemStack } from '../../sim/components';
import type { GearTarget, PlayerAction } from '../../sim/input';
import { stationNearby, type Check } from '../../sim/modules/crafting';
import { gearOf, perkLines, perkText } from '../../sim/modules/gear';
import { EQUIP_SLOTS } from '../../sim/modules/items';
import {
  canCleanse,
  canInfuse,
  canSalvage,
  canTemper,
  canUpgradeGear,
  infuseCost,
  nextGearUpgrade,
  salvageYield,
  smithHere,
  temperCost,
} from '../../sim/modules/smithy';
import type { Simulation } from '../../sim/simulation';
import { h } from './dom';

export interface WorkContext {
  act(action: PlayerAction): void;
  /** A Noble or Legendary salvage waiting on a second press. */
  confirming: boolean;
  confirm(on: boolean): void;
}

/** "40 souls · 2 Bone Shard". */
export function costText(sim: Simulation, souls: number, items: readonly ItemCount[]): string {
  const parts = items.map((c) => `${c.count} ${sim.content.item(c.item).name}`);
  if (souls > 0) parts.unshift(`${souls} souls`);
  return parts.join(' · ') || 'free';
}

function button(label: string, check: Check, onclick: () => void, extra = ''): HTMLElement {
  return h(
    'button',
    {
      class: `work ${extra}`.trim(),
      disabled: !check.ok,
      title: check.ok ? '' : check.reason,
      onclick,
    },
    check.ok ? label : `${label} (${check.reason})`,
  );
}

/** One rolled perk's text as it would show on this item. */
function rollText(sim: Simulation, stack: ItemStack, roll: { perk: string; value: number }): string {
  const line = perkLines(sim.content, { ...stack, gear: { ...gearOf(stack), perks: [roll] } }).find(
    (l) => !l.innate,
  );
  return line ? perkText(sim.content, line) : roll.perk;
}

/** Every piece of gear the player has, with where it is. */
function allGear(sim: Simulation): { target: GearTarget; stack: ItemStack }[] {
  const eq = sim.ecs.need(sim.player, Equipment);
  const worn = EQUIP_SLOTS.flatMap((slot) => {
    const stack = eq[slot];
    return stack ? [{ target: { slot }, stack }] : [];
  });
  const pack = sim.ecs
    .need(sim.player, Inventory)
    .stacks.map((stack, i) => ({ target: { pack: i }, stack }))
    .filter(({ stack }) => gearSlotOf(sim.content.item(stack.item)) !== null);
  return [...worn, ...pack];
}

/** The smithy's buttons for one piece of gear. */
export function gearWork(
  sim: Simulation,
  target: GearTarget,
  stack: ItemStack,
  ctx: WorkContext,
): HTMLElement {
  const rows: (HTMLElement | string)[] = [];
  const gear = gearOf(stack);
  if ('pack' in target) {
    const index = target.pack;
    rows.push(
      h(
        'div',
        { class: 'marks' },
        h(
          'button',
          {
            class: 'work quiet',
            onclick: () => ctx.act({ type: 'mark', index, mark: stack.locked ? null : 'lock' }),
          },
          stack.locked ? 'Unlock' : 'Lock',
        ),
        h(
          'button',
          {
            class: 'work quiet',
            onclick: () => ctx.act({ type: 'mark', index, mark: stack.junk ? null : 'junk' }),
          },
          stack.junk ? 'Not junk' : 'Mark as junk',
        ),
      ),
    );
  }
  const atForge = stationNearby(sim, 'forge');
  const resting = sim.ecs.need(sim.player, Player).state === 'sit';
  if (!atForge && !resting) {
    rows.push(
      h(
        'p',
        { class: 'hint' },
        'At the forge: upgrade, infuse and salvage. With the smith back: temper and cleanse.',
      ),
    );
    return h('div', { class: 'smithy' }, ...rows);
  }

  // Salvage: pack gear only, at the forge or a bonfire. Noble and Legendary ask twice.
  if ('pack' in target) {
    const index = target.pack;
    const yields = costText(sim, 0, salvageYield(sim, stack));
    const precious = gear.tier === 'noble' || gear.tier === 'legendary';
    const check = canSalvage(sim, index);
    rows.push(
      ctx.confirming
        ? button(
            `Really salvage this ${sim.content.loot.tiers[gear.tier].name}? → ${yields}`,
            check,
            () => {
              ctx.confirm(false);
              ctx.act({ type: 'salvage', index });
            },
            'danger',
          )
        : button(`Salvage → ${yields}`, check, () =>
            precious ? ctx.confirm(true) : ctx.act({ type: 'salvage', index }),
          ),
    );
  }
  if (!atForge) return h('div', { class: 'smithy' }, ...rows);

  const next = nextGearUpgrade(sim, target);
  if (next) {
    const gain = next.stat === 'damage' ? `+${next.gain} damage` : `+${next.gain} Armor`;
    rows.push(
      button(
        `Upgrade to +${next.level}: ${gain} · ${costText(sim, next.souls, next.items)}`,
        canUpgradeGear(sim, target),
        () => ctx.act({ type: 'upgradeGear', target }),
      ),
    );
    // Infusing: bring an older piece's upgrades over onto this one.
    for (const source of allGear(sim)) {
      if (source.stack === stack || source.stack.level <= stack.level) continue;
      if (gearSlotOf(sim.content.item(source.stack.item)) !== gearSlotOf(sim.content.item(stack.item)))
        continue;
      const cost = infuseCost(sim, source.stack);
      rows.push(
        button(
          `Infuse +${source.stack.level} from ${sim.content.item(source.stack.item).name} · ${costText(sim, cost.souls, cost.items)}`,
          canInfuse(sim, source.target, target),
          () => ctx.act({ type: 'infuse', from: source.target, to: target }),
        ),
      );
    }
  }

  // Tempering: one perk at a time, then a choice between it and two new ones.
  const lines = perkLines(sim.content, stack).filter((l) => !l.innate);
  if (stack.gear && lines.length > 0) {
    const offer = stack.gear.offer;
    if (offer) {
      const old = stack.gear.perks[offer.perk];
      const text = (roll: { perk: string; value: number }) => rollText(sim, stack, roll);
      rows.push(
        h(
          'div',
          { class: 'offer' },
          h('div', { class: 'hint' }, 'Tempered. Keep the old perk, or take a new one:'),
          old
            ? h(
                'button',
                { class: 'work', onclick: () => ctx.act({ type: 'settleTemper', target, choice: 0 }) },
                `Keep: ${text(old)}`,
              )
            : '',
          ...offer.rolls.map((roll, i) =>
            h(
              'button',
              { class: 'work gain', onclick: () => ctx.act({ type: 'settleTemper', target, choice: i + 1 }) },
              `${roll.greater ? '★ ' : ''}${text(roll)}`,
            ),
          ),
        ),
      );
    } else if (smithHere(sim)) {
      const cost = temperCost(sim, stack);
      rows.push(h('div', { class: 'hint' }, `Temper a perk · ${costText(sim, cost.souls, cost.items)}`));
      stack.gear.perks.forEach((roll, i) => {
        if (sim.content.loot.perks[roll.perk]?.drawback) return;
        rows.push(
          button(`Reroll: ${rollText(sim, stack, roll)}`, canTemper(sim, target, i), () =>
            ctx.act({ type: 'temper', target, perk: i }),
          ),
        );
      });
    }
  }
  if (stack.gear?.blighted && smithHere(sim)) {
    const c = sim.content.loot.smithy.cleanse;
    rows.push(
      button(`Cleanse the blight · ${costText(sim, c.souls, c.items)}`, canCleanse(sim, target), () =>
        ctx.act({ type: 'cleanse', target }),
      ),
    );
  }
  return h('div', { class: 'smithy' }, ...rows);
}
