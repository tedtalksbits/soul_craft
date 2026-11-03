/**
 * Smithy work on one piece of gear, for the equipment screen's details panel: lock and junk marks, dismantling
 * (anywhere, by holding the button), infusing (at a bonfire), upgrades, tempering and cleansing. Every button
 * shows its price and, when it can't be used, why; work that needs the forge or the smith only appears there.
 */
import { gearSlotOf } from '../../content/content';
import { TIERS, type ItemCount } from '../../content/schemas';
import { Inventory, Player, type ItemStack } from '../../sim/components';
import type { GearTarget, PlayerAction } from '../../sim/input';
import { stationNearby, type Check } from '../../sim/modules/crafting';
import { gearOf, perkLines, perkText } from '../../sim/modules/gear';
import { gearPower } from '../../sim/modules/power';
import { stashOf, stashReachable } from '../../sim/modules/storage';
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
}

/** How long a destructive button must be held: long enough that a stray click never fires it. */
export const HOLD_MS = 1500;

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

/**
 * A button that fires only once held for `HOLD_MS` (dismantling, and feeding a good piece into another): it fills
 * while held, and letting go early cancels it.
 */
export function holdButton(label: string, check: Check, fire: () => void, extra = ''): HTMLElement {
  const el = button(check.ok ? `${label} (hold)` : label, check, () => undefined, `hold ${extra}`.trim());
  let timer: number | undefined;
  const cancel = () => {
    window.clearTimeout(timer);
    el.classList.remove('holding');
  };
  el.onpointerdown = () => {
    if (!check.ok) return;
    el.classList.add('holding');
    el.style.setProperty('--hold', `${HOLD_MS}ms`);
    timer = window.setTimeout(() => {
      el.classList.remove('holding');
      fire();
    }, HOLD_MS);
  };
  el.onpointerup = cancel;
  el.onpointerleave = cancel;
  return el;
}

/** One rolled perk's text as it would show on this item. */
function rollText(sim: Simulation, stack: ItemStack, roll: { perk: string; value: number }): string {
  const line = perkLines(sim.content, { ...stack, gear: { ...gearOf(stack), perks: [roll] } }).find(
    (l) => !l.innate,
  );
  return line ? perkText(sim.content, line) : roll.perk;
}

/** Every piece of gear the player could feed into another: carried, and stashed where the stash opens. */
function feedable(sim: Simulation): { target: GearTarget; stack: ItemStack }[] {
  const isGear = (stack: ItemStack) => gearSlotOf(sim.content.item(stack.item)) !== null;
  const pack = sim.ecs
    .need(sim.player, Inventory)
    .stacks.map((stack, i) => ({ target: { pack: i }, stack }))
    .filter(({ stack }) => isGear(stack));
  const kept = stashReachable(sim)
    ? stashOf(sim)
        .map((stack, i) => ({ target: { stash: i }, stack }))
        .filter(({ stack }) => isGear(stack))
    : [];
  return [...pack, ...kept];
}

/** The smithy's buttons for one piece of gear. */
export function gearWork(
  sim: Simulation,
  target: GearTarget,
  stack: ItemStack,
  ctx: WorkContext,
): HTMLElement {
  const rows: (HTMLElement | string)[] = [];
  const worn = 'slot' in target;
  if (!worn) {
    rows.push(
      h(
        'div',
        { class: 'marks' },
        h(
          'button',
          {
            class: 'work quiet',
            title: 'L',
            onclick: () => ctx.act({ type: 'mark', target, mark: stack.locked ? null : 'lock' }),
          },
          stack.locked ? 'Unlock' : 'Lock',
        ),
        h(
          'button',
          {
            class: 'work quiet',
            title: 'X',
            onclick: () => ctx.act({ type: 'mark', target, mark: stack.junk ? null : 'junk' }),
          },
          stack.junk ? 'Not junk' : 'Mark as junk',
        ),
      ),
    );
    // Dismantling: anywhere, held so a stray click never breaks a piece.
    const yields = costText(sim, 0, salvageYield(sim, stack));
    rows.push(
      holdButton(
        `Dismantle → ${yields}`,
        canSalvage(sim, target),
        () => ctx.act({ type: 'salvage', target }),
        'danger',
      ),
    );
  }

  // Infusing, at any bonfire: feed a piece with more Power into this one. Feeding a Noble or better is held.
  const resting = sim.ecs.need(sim.player, Player).state === 'sit';
  const slot = gearSlotOf(sim.content.item(stack.item));
  const feeders = feedable(sim).filter(
    (f) =>
      f.stack !== stack &&
      !f.stack.locked &&
      gearSlotOf(sim.content.item(f.stack.item)) === slot &&
      gearOf(f.stack).tier === gearOf(stack).tier &&
      gearPower(f.stack) > gearPower(stack),
  );
  if (stack.gear && feeders.length > 0) {
    const cost = infuseCost(sim, gearOf(stack).tier);
    rows.push(
      h(
        'div',
        { class: 'hint' },
        resting ? `Infuse · ${costText(sim, cost.souls, cost.items)}` : 'Infuse at a bonfire',
      ),
    );
    for (const f of feeders.sort((x, y) => gearPower(y.stack) - gearPower(x.stack))) {
      const label = `${gearPower(stack)} → ${gearPower(f.stack)} from ${sim.content.item(f.stack.item).name}`;
      const check = canInfuse(sim, f.target, target);
      const fire = () => ctx.act({ type: 'infuse', from: f.target, to: target });
      const precious = TIERS.indexOf(gearOf(f.stack).tier) >= TIERS.indexOf('noble');
      rows.push(precious ? holdButton(label, check, fire) : button(label, check, fire));
    }
  }

  const atForge = stationNearby(sim, 'forge');
  if (!atForge) {
    rows.push(h('p', { class: 'hint' }, 'At the forge: upgrade. With the smith back: temper and cleanse.'));
    return h('div', { class: 'smithy' }, ...rows);
  }

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
