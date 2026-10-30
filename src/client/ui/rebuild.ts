/**
 * The rebuild screen for a ruined village project: what it was, what it costs (with what the
 * player has), what it will give, and a Rebuild button that queues a `rebuild` action. Like the
 * level screen it reads sim state and never changes it. It closes when the player walks away or
 * the project is rebuilt (the sim then shows the returned villager's words).
 */
import type { RestorationEffect } from '../../content/schemas';
import { Inventory, Player } from '../../sim/components';
import type { PlayerAction } from '../../sim/input';
import { countItem } from '../../sim/modules/items';
import { canRebuild, siteNearby } from '../../sim/modules/restoration';
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

  /** Redraws when what it shows changes; closes once the site is rebuilt or out of reach. */
  refresh(force = false): void {
    const sim = this.host.sim();
    const id = this.project;
    if (!this.el || id === null) return;
    const def = sim?.content.restoration[id];
    if (!sim || !def || sim.state.restored[id] || !siteNearby(sim, id)) return this.close();
    const inv = sim.ecs.need(sim.player, Inventory);
    const souls = sim.ecs.need(sim.player, Player).souls;
    const have = def.cost.items.map((c) => countItem(inv, c.item));
    const key = JSON.stringify([id, have, souls]);
    if (!force && key === this.shown) return;
    this.shown = key;

    const check = canRebuild(sim, id);
    const costs = def.cost.items.map((c, i) =>
      h(
        'span',
        { class: (have[i] ?? 0) >= c.count ? 'cost' : 'cost short' },
        this.host.icon(c.item),
        `${c.count} ${sim.content.item(c.item).name} (${have[i] ?? 0})`,
      ),
    );
    costs.push(
      h('span', { class: souls >= def.cost.souls ? 'cost' : 'cost short' }, `${def.cost.souls} souls`),
    );
    this.el.replaceChildren(
      h(
        'div',
        { class: 'head' },
        h('h2', { class: 'title' }, def.name),
        h('div', { class: 'souls' }, def.tier === 'major' ? 'Major project' : 'Village project'),
        h('button', { class: 'quiet', onclick: () => this.close() }, 'Close (Esc)'),
      ),
      h(
        'div',
        { class: 'body' },
        h('p', { class: 'description' }, def.description),
        h('h3', {}, 'Needs'),
        h('div', { class: 'costs' }, ...costs),
        h('h3', {}, 'Gives'),
        h('ul', { class: 'gives' }, ...def.effects.map((fx) => h('li', {}, effectText(fx)))),
        h(
          'button',
          {
            class: 'rebuild',
            disabled: !check.ok,
            title: check.ok ? '' : check.reason,
            onclick: () => this.host.act({ type: 'rebuild', project: id }),
          },
          check.ok ? 'Rebuild' : check.reason,
        ),
      ),
    );
  }
}
