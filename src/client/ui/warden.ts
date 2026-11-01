/**
 * The Warden's bonfire: once a Warden has fallen, resting at its bonfire offers a refight (Rekindle, at a
 * Heat paid in Sigils), shows how close the signature item is, and trades Warden Marks for it outright.
 * Like the other screens it reads sim state and queues actions; it never changes the sim itself.
 */
import { Inventory, Player } from '../../sim/components';
import type { PlayerAction } from '../../sim/input';
import { countItem } from '../../sim/modules/items';
import {
  canBuySignature,
  canRekindle,
  heatOpen,
  signatureChance,
  wardenHere,
} from '../../sim/modules/wardens';
import type { Simulation } from '../../sim/simulation';
import { h } from './dom';

export interface WardenHost {
  sim(): Simulation | null;
  act(action: PlayerAction): void;
}

export class WardenScreen {
  private el: HTMLElement | null = null;
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly host: WardenHost,
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  open(): void {
    if (!this.el) {
      this.el = h('div', { class: 'inventory warden-screen' });
      this.root.append(this.el);
    }
    this.refresh(true);
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.shown = '';
  }

  /** Redraws when what it shows changes; closes when the player is no longer resting at a Warden's bonfire. */
  refresh(force = false): void {
    const sim = this.host.sim();
    if (!this.el) return;
    const boss = sim ? wardenHere(sim) : null;
    if (!sim || !boss) return this.close();
    const def = sim.content.enemy(boss);
    const loot = sim.content.loot.wardens;
    const inv = sim.ecs.need(sim.player, Inventory);
    const sigils = countItem(inv, loot.sigil);
    const marks = countItem(inv, loot.mark);
    const key = JSON.stringify([
      boss,
      sigils,
      marks,
      sim.state.rekindled,
      sim.state.heatCleared,
      sim.state.signaturePity,
    ]);
    if (!force && key === this.shown) return;
    this.shown = key;

    const rekindled = sim.state.rekindled?.[boss];
    const signature = def.boss?.warden ? sim.content.item(def.boss.warden.signature).name : '';
    const heats = Array.from({ length: heatOpen(sim, boss) }, (_, i) => i + 1).map((heat) => {
      const check = canRekindle(sim, boss, heat);
      const label =
        heat === 1 ? 'Rekindle' : `Rekindle at Heat ${heat} (${heat - 1} ${heat === 2 ? 'Sigil' : 'Sigils'})`;
      return h(
        'button',
        {
          disabled: !check.ok,
          title: check.ok ? '' : check.reason,
          onclick: () => {
            this.host.act({ type: 'rekindle', boss, heat });
            this.close();
          },
        },
        check.ok ? label : `${label}: ${check.reason}`,
      );
    });
    const buy = canBuySignature(sim, boss);
    const chance = Math.round(signatureChance(sim, boss) * 100);
    this.el.replaceChildren(
      h(
        'div',
        { class: 'head' },
        h('h2', { class: 'title' }, def.name),
        h('div', { class: 'souls' }, `${sigils} Sigils · ${marks} Warden Marks`),
        h('button', { class: 'quiet', onclick: () => this.close() }, 'Close (Esc)'),
      ),
      h(
        'div',
        { class: 'body' },
        rekindled !== undefined
          ? h(
              'p',
              { class: 'description' },
              `The embers are lit. The Warden waits in its keep, at Heat ${rekindled}.`,
            )
          : h(
              'p',
              { class: 'description' },
              'Rekindle the Warden to fight it again. Its chest is yours every time: gear, materials and a Warden Mark. Each Heat makes it fiercer and the chest richer.',
            ),
        rekindled === undefined ? h('div', { class: 'heats' }, ...heats) : '',
        h('h3', {}, signature),
        h(
          'p',
          { class: 'description' },
          `Next chest: ${chance}% chance${chance >= 30 ? '. The embers stir…' : ''}. Every chest without it raises the odds.`,
        ),
        h(
          'button',
          {
            disabled: !buy.ok,
            title: buy.ok ? '' : buy.reason,
            onclick: () => this.host.act({ type: 'buySignature', boss }),
          },
          buy.ok
            ? `Trade ${loot.markPrice} Warden Marks for it`
            : `Trade ${loot.markPrice} Warden Marks (${buy.reason})`,
        ),
      ),
    );
  }
}

/** Whether the player rests where the Warden screen has something to offer. */
export function wardenBonfire(sim: Simulation): boolean {
  return sim.ecs.get(sim.player, Player)?.state === 'sit' && wardenHere(sim) !== null;
}
