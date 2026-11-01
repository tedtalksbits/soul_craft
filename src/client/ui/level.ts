/**
 * The bonfire's level-up screen. Like the inventory it reads sim state and never changes it:
 * each Raise button queues a `levelUp` action, and the screen redraws when what it shows
 * changes. It is only offered while resting, and closes when the player gets up.
 */
import { ATTRIBUTES, type AttributeId } from '../../content/schemas';
import { Attributes, Health, Player, Stamina } from '../../sim/components';
import type { PlayerAction } from '../../sim/input';
import { canLevelUp, levelCost, playerLevel } from '../../sim/modules/progression';
import { attributeGain, playerStats } from '../../sim/modules/items';
import type { Simulation } from '../../sim/simulation';
import { h } from './dom';

export interface LevelHost {
  sim(): Simulation | null;
  act(action: PlayerAction): void;
}

const NAMES: Readonly<Record<AttributeId, string>> = {
  vigor: 'Vigor',
  endurance: 'Endurance',
  might: 'Might',
  attunement: 'Attunement',
};

export class LevelScreen {
  private el: HTMLElement | null = null;
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly host: LevelHost,
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  open(): void {
    if (!this.el) {
      this.el = h('div', { class: 'inventory level-screen' });
      this.root.append(this.el);
    }
    this.refresh(true);
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.shown = '';
  }

  /** Redraws if anything shown changed; closes when the player is no longer resting. */
  refresh(force = false): void {
    const sim = this.host.sim();
    if (!this.el) return;
    if (!sim || sim.ecs.get(sim.player, Player)?.state !== 'sit') return this.close();
    const attrs = sim.ecs.need(sim.player, Attributes);
    const souls = sim.ecs.need(sim.player, Player).souls;
    const key = JSON.stringify([attrs, souls]);
    if (!force && key === this.shown) return;
    this.shown = key;
    this.el.replaceChildren(this.header(sim, souls), this.body(sim));
  }

  private header(sim: Simulation, souls: number): HTMLElement {
    const attrs = sim.ecs.need(sim.player, Attributes);
    return h(
      'div',
      { class: 'head' },
      h('h2', { class: 'title' }, `Level ${playerLevel(attrs)}`),
      h('div', { class: 'souls' }, `${souls} souls · next level ${levelCost(sim)}`),
      h('button', { class: 'quiet', onclick: () => this.close() }, 'Close (Esc)'),
    );
  }

  private body(sim: Simulation): HTMLElement {
    const attrs = sim.ecs.need(sim.player, Attributes);
    const { perLevel: per, softCaps } = sim.content.player.leveling;
    const stats = playerStats(sim, sim.player);
    const health = sim.ecs.need(sim.player, Health);
    const stamina = sim.ecs.need(sim.player, Stamina);
    const check = canLevelUp(sim);
    const pct = (f: number) => `${Math.round(f * 100)}%`;
    // What one more point gives, counting gear's points toward the soft caps.
    const next = (id: AttributeId, gains: readonly [number, number, number]) => {
      const points = stats.attributes[id];
      return attributeGain(sim.content, gains, points + 1) - attributeGain(sim.content, gains, points);
    };
    const softened = (id: AttributeId) => (stats.attributes[id] >= softCaps[0] ? ', softened' : '');
    const rows: Record<AttributeId, { now: string; next: string }> = {
      vigor: {
        now: `${health.max} max health`,
        next: `+${Math.round(next('vigor', per.vigor.maxHp))} max health${softened('vigor')}`,
      },
      endurance: {
        now: `${stamina.max} max stamina`,
        next: `+${Math.round(next('endurance', per.endurance.maxStamina))} max stamina${softened('endurance')}`,
      },
      might: {
        now: `${Math.round(stats.damage)} weapon damage`,
        next: `+${pct(next('might', per.might.damage))} weapon damage${softened('might')}`,
      },
      attunement: {
        now: `+${pct(stats.abilityDamage - 1)} ability damage`,
        next: `+${pct(next('attunement', per.attunement.abilityDamage))} ability damage, +${pct(next('attunement', per.attunement.energy))} super charge${softened('attunement')}`,
      },
    };
    return h(
      'div',
      { class: 'body' },
      ...ATTRIBUTES.map((id) =>
        h(
          'div',
          { class: 'attribute' },
          h('div', { class: 'points' }, String(attrs[id])),
          h(
            'div',
            { class: 'what' },
            h('div', { class: 'name' }, NAMES[id]),
            h('div', { class: 'now' }, rows[id].now),
            h('div', { class: 'next' }, `Next: ${rows[id].next}`),
          ),
          h(
            'button',
            {
              disabled: !check.ok,
              title: check.ok ? '' : check.reason,
              onclick: () => this.host.act({ type: 'levelUp', attribute: id }),
            },
            check.ok ? 'Raise' : check.reason,
          ),
        ),
      ),
      h('p', { class: 'hint' }, 'Souls are lost when you die. Spend them while you rest.'),
    );
  }
}
