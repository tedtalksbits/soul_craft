/**
 * The rebuild screen for a village project: what its next stage (rebuilding it, or raising it a
 * rank) costs, with what the player has, what it will give, and the button that queues a `rebuild`
 * action. A site with the Ember Gambler's shop shows the shop too. Like the level screen it reads sim
 * state and never changes it. It closes when the player walks away or nothing is left to do there.
 */
import { GearSlotSchema, type RestorationEffect } from '../../content/schemas';
import { Inventory, Player } from '../../sim/components';
import type { PlayerAction } from '../../sim/input';
import { countItem } from '../../sim/modules/items';
import { canGamble, gamblePrice, hasGambler } from '../../sim/modules/gambler';
import { maxPower } from '../../sim/modules/power';
import { canRebuild, nextStage, siteNearby } from '../../sim/modules/restoration';
import { projectRank } from '../../sim/modules/restored-effects';
import type { Simulation } from '../../sim/simulation';
import { h } from './dom';

export interface RebuildHost {
  sim(): Simulation | null;
  act(action: PlayerAction): void;
  icon(item: string): HTMLElement;
}

/** What an effect gives, as the player reads it. */
export function effectText(fx: RestorationEffect): string {
  switch (fx.type) {
    case 'maxFlasks':
      return `+${fx.amount} flask ${fx.amount === 1 ? 'charge' : 'charges'}`;
    case 'inventorySlots':
      return `+${fx.amount} pack slots`;
    case 'safeRadius':
      return `No enemies rise within ${fx.tiles} paces of the village`;
    case 'light':
      return 'Lamplight on the village road at night';
    case 'forgeSteps':
      return 'The smith returns: forge upgrades beyond the old limit';
    case 'smithWork':
      return 'The smith tempers perks and cleanses blight';
    case 'gambler':
      return 'The Ember Gambler sets up shop: unidentified gear for a slot you choose';
  }
}

export class RebuildScreen {
  private el: HTMLElement | null = null;
  private project: string | null = null;
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly host: RebuildHost,
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  open(project: string): void {
    this.project = project;
    if (!this.el) {
      this.el = h('div', { class: 'inventory rebuild-screen' });
      this.root.append(this.el);
    }
    this.refresh(true);
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.project = null;
    this.shown = '';
  }

  /** Redraws when what it shows changes; closes once nothing is left to do here, or out of reach. */
  refresh(force = false): void {
    const sim = this.host.sim();
    const id = this.project;
    if (!this.el || id === null) return;
    const def = sim?.content.restoration[id];
    if (!sim || !def || !siteNearby(sim, id)) return this.close();
    const stage = nextStage(sim, id);
    const shop = hasGambler(sim, id);
    if (!stage && !shop) return this.close();
    const inv = sim.ecs.need(sim.player, Inventory);
    const souls = sim.ecs.need(sim.player, Player).souls;
    const have = stage ? stage.cost.items.map((c) => countItem(inv, c.item)) : [];
    const key = JSON.stringify([id, have, souls, projectRank(sim, id), inv.stacks.length]);
    if (!force && key === this.shown) return;
    this.shown = key;

    const rank = projectRank(sim, id);
    const roman = ['', 'I', 'II', 'III', 'IV', 'V'];
    const body: (HTMLElement | string)[] = [];
    // A rebuilt site's villager still has their say above what comes next.
    if (rank > 0) body.push(h('p', { class: 'said' }, def.restoredLines.join(' ')));
    if (stage) {
      const check = canRebuild(sim, id);
      const costs = stage.cost.items.map((c, i) =>
        h(
          'span',
          { class: (have[i] ?? 0) >= c.count ? 'cost' : 'cost short' },
          this.host.icon(c.item),
          `${c.count} ${sim.content.item(c.item).name} (${have[i] ?? 0})`,
        ),
      );
      costs.push(
        h('span', { class: souls >= stage.cost.souls ? 'cost' : 'cost short' }, `${stage.cost.souls} souls`),
      );
      const label = stage.rank === 1 ? 'Rebuild' : `Raise to rank ${roman[stage.rank] ?? stage.rank}`;
      body.push(
        h('p', { class: 'description' }, stage.description),
        h('h3', {}, 'Needs'),
        h('div', { class: 'costs' }, ...costs),
        h('h3', {}, 'Gives'),
        h('ul', { class: 'gives' }, ...stage.effects.map((fx) => h('li', {}, effectText(fx)))),
        h(
          'button',
          {
            class: 'rebuild',
            disabled: !check.ok,
            title: check.ok ? '' : check.reason,
            onclick: () => this.host.act({ type: 'rebuild', project: id }),
          },
          check.ok ? label : check.reason,
        ),
      );
    }
    if (shop) body.push(this.shop(sim));
    this.el.replaceChildren(
      h(
        'div',
        { class: 'head' },
        h('h2', { class: 'title' }, rank > 1 ? `${def.name}, rank ${roman[rank] ?? rank}` : def.name),
        h('div', { class: 'souls' }, def.tier === 'major' ? 'Major project' : 'Village project'),
        h('button', { class: 'quiet', onclick: () => this.close() }, 'Close (Esc)'),
      ),
      h('div', { class: 'body' }, ...body),
    );
  }

  /** The Ember Gambler: one button per slot, the price, and the odds. */
  private shop(sim: Simulation): HTMLElement {
    const check = canGamble(sim);
    const price = gamblePrice(sim);
    const odds = sim.content.loot.gambler.odds;
    const total = odds.reduce((n, [, w]) => n + w, 0);
    const names = { weapon: 'Weapon', helmet: 'Helmet', chest: 'Chest', legs: 'Legs', ring: 'Ring' } as const;
    return h(
      'div',
      { class: 'gambler' },
      h('h3', {}, 'The Ember Gambler'),
      h(
        'p',
        { class: 'description' },
        `"Pick a slot, any slot. ${price} souls and it's yours, sight unseen." Power about ${maxPower(sim)}. Odds: ${odds
          .map(([t, w]) => `${sim.content.loot.tiers[t].name} ${Math.round((w / total) * 100)}%`)
          .join(', ')}.`,
      ),
      h(
        'div',
        { class: 'gamble-slots' },
        ...GearSlotSchema.options.map((slot) =>
          h(
            'button',
            {
              disabled: !check.ok,
              title: check.ok ? '' : check.reason,
              onclick: () => this.host.act({ type: 'gamble', slot }),
            },
            names[slot],
          ),
        ),
      ),
      check.ok ? '' : h('p', { class: 'hint' }, check.reason),
    );
  }
}
