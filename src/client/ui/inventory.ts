/**
 * The inventory and crafting screen. It reads sim state directly but never
 * changes it: every button queues a PlayerAction for the next tick, and the
 * screen redraws when the state it shows changes. The game keeps running
 * underneath (no pause, as in the Souls games); only movement input is held.
 */
import { ABILITY_SLOTS, STATIONS, type ItemDef, type StationId } from '../../content/schemas';
import {
  Abilities,
  Attributes,
  Buffs,
  Equipment,
  Inventory,
  Player,
  type EquipSlot,
  type ItemStack,
} from '../../sim/components';
import { FULL_ENERGY } from '../../sim/modules/energy';
import { playerLevel } from '../../sim/modules/progression';
import { unlockHint } from '../../sim/modules/unlocks';
import type { PlayerAction } from '../../sim/input';
import { canCraft, canUpgrade, nextUpgrade, stationNearby } from '../../sim/modules/crafting';
import { countItem, EQUIP_SLOTS, playerStats } from '../../sim/modules/items';
import type { Simulation } from '../../sim/simulation';
import { TICK_RATE } from '../../sim/constants';
import { primaryKey, type Bindings } from '../keybinds';
import { h } from './dom';

export interface InventoryHost {
  sim(): Simulation | null;
  /** An element showing the item's icon. */
  icon(item: string): HTMLElement;
  act(action: PlayerAction): void;
  /** The player's key bindings, for key hints. */
  bindings(): Bindings;
  /** Tinted class sigils and ability icons. */
  sigil(cls: string): HTMLElement;
  abilityIcon(ability: string): HTMLElement;
}

type Tab = 'items' | 'craft' | 'abilities';

const SLOT_BINDING = { aoe: 'aoe', class: 'classAbility', super: 'super' } as const;
const SLOT_NAMES = { aoe: 'AoE ability', class: 'Class ability', super: 'Super' } as const;

const SLOT_LABELS: Readonly<Record<EquipSlot, string>> = {
  weapon: 'Weapon',
  armor: 'Armor',
  ring0: 'Ring',
  ring1: 'Ring',
};

const STAT_LABELS = {
  damage: 'damage',
  defense: 'defense',
  staminaRegen: 'stamina regen',
  maxHp: 'max HP',
} as const;

export class InventoryScreen {
  private el: HTMLElement | null = null;
  private tab: Tab = 'items';
  /** The station this screen was opened at; filters the crafting list. */
  private station: StationId | null = null;
  private selected: number | null = null;
  private shown = '';

  constructor(
    private readonly root: HTMLElement,
    private readonly host: InventoryHost,
  ) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  open(tab: Tab, station: StationId | null = null): void {
    this.tab = tab;
    this.station = station;
    this.selected = null;
    if (!this.el) {
      this.el = h('div', { class: 'inventory' });
      this.root.append(this.el);
    }
    this.refresh(true);
  }

  close(): void {
    this.el?.remove();
    this.el = null;
    this.shown = '';
  }

  /** Redraws if anything shown changed. Cheap enough to call every tick while open. */
  refresh(force = false): void {
    const sim = this.host.sim();
    if (!this.el) return;
    if (!sim) return this.close();
    const key = this.signature(sim);
    if (!force && key === this.shown) return;
    this.shown = key;
    const scroll = this.el.querySelector('.body')?.scrollTop ?? 0;
    const body =
      this.tab === 'items'
        ? this.itemsTab(sim)
        : this.tab === 'craft'
          ? this.craftTab(sim)
          : this.abilitiesTab(sim);
    this.el.replaceChildren(this.header(sim), body);
    const shown = this.el.querySelector('.body');
    if (shown) shown.scrollTop = scroll;
  }

  private signature(sim: Simulation): string {
    const e = sim.player;
    return JSON.stringify([
      this.tab,
      this.station,
      this.selected,
      sim.ecs.get(e, Inventory)?.stacks,
      sim.ecs.get(e, Equipment),
      sim.ecs.get(e, Player)?.souls,
      sim.ecs.get(e, Buffs)?.active.map((b) => b.stat),
      stationNearby(sim, 'forge'),
      stationNearby(sim, 'alchemy'),
      this.tab === 'abilities' ? abilityStatus(sim) : null,
      this.host.bindings(),
    ]);
  }

  private header(sim: Simulation): HTMLElement {
    const tab = (id: Tab, label: string) =>
      h(
        'button',
        {
          class: this.tab === id ? 'tab on' : 'tab',
          onclick: () => {
            this.tab = id;
            this.refresh(true);
          },
        },
        label,
      );
    const souls = sim.ecs.get(sim.player, Player)?.souls ?? 0;
    return h(
      'div',
      { class: 'head' },
      tab('items', 'Inventory'),
      tab('craft', this.station ? STATIONS[this.station] : 'Crafting'),
      tab('abilities', 'Abilities'),
      h('div', { class: 'souls' }, `${souls} souls`),
      h(
        'button',
        { class: 'quiet', onclick: () => this.close() },
        `Close (${primaryKey(this.host.bindings(), 'inventory')})`,
      ),
    );
  }

  // ------------------------------------------------------------------ inventory tab

  private itemsTab(sim: Simulation): HTMLElement {
    const e = sim.player;
    const eq = sim.ecs.need(e, Equipment);
    const stacks = sim.ecs.need(e, Inventory).stacks;
    const slots = sim.content.player.inventorySlots;

    const equipped = EQUIP_SLOTS.map((slot) => {
      const stack = eq[slot];
      return this.cell(
        sim,
        stack,
        SLOT_LABELS[slot],
        stack ? () => this.host.act({ type: 'unequip', slot }) : null,
      );
    });
    const quickCount = eq.quick ? countItem(sim.ecs.need(e, Inventory), eq.quick) : 0;
    const quick = this.cell(
      sim,
      eq.quick ? { item: eq.quick, count: quickCount, level: 0 } : null,
      'Quick (Q)',
      eq.quick ? () => this.host.act({ type: 'setQuick', item: null }) : null,
    );

    const grid = Array.from({ length: slots }, (_, i) => {
      const stack = stacks[i] ?? null;
      const cell = this.cell(sim, stack, null, () => {
        this.selected = stack && this.selected !== i ? i : null;
        this.refresh(true);
      });
      if (i === this.selected) cell.classList.add('selected');
      return cell;
    });

    const stats = playerStats(sim, e);
    const attrs = sim.ecs.get(e, Attributes);
    const statRows: [string, string][] = [
      ['Level', attrs ? String(playerLevel(attrs)) : '1'],
      ['Damage', String(Math.round(stats.damage))],
      ['Defense', `${Math.round(stats.defense * 100)}%`],
      ['Max HP', String(stats.maxHp)],
      ['Stamina regen', `${Math.round(stats.staminaRegen * TICK_RATE)}/s`],
    ];

    const selected = this.selected === null ? undefined : stacks[this.selected];
    return h(
      'div',
      { class: 'body items' },
      h(
        'div',
        { class: 'col gear' },
        h('h2', {}, 'Equipped'),
        h('div', { class: 'equip' }, ...equipped, quick),
        h('p', { class: 'hint' }, 'Click equipped gear to take it off.'),
        h('h2', {}, 'Stats'),
        h('dl', {}, ...statRows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])),
      ),
      h(
        'div',
        { class: 'col' },
        h('h2', {}, `Pack ${stacks.length}/${slots}`),
        h('div', { class: 'grid' }, ...grid),
      ),
      h(
        'div',
        { class: 'col detail' },
        selected && this.selected !== null
          ? this.detail(sim, selected, this.selected)
          : h('p', { class: 'hint' }, 'Select an item.'),
      ),
    );
  }

  private detail(sim: Simulation, stack: ItemStack, index: number): HTMLElement {
    const def = sim.content.item(stack.item);
    const quick = sim.ecs.need(sim.player, Equipment).quick;
    const buttons: HTMLElement[] = [];
    if (def.kind === 'weapon' || def.kind === 'armor' || def.kind === 'ring') {
      buttons.push(h('button', { onclick: () => this.host.act({ type: 'equip', index }) }, 'Equip'));
    } else if (def.kind === 'consumable') {
      buttons.push(h('button', { onclick: () => this.host.act({ type: 'use', item: stack.item }) }, 'Use'));
      buttons.push(
        quick === stack.item
          ? h(
              'button',
              { onclick: () => this.host.act({ type: 'setQuick', item: null }) },
              'Clear quick slot',
            )
          : h(
              'button',
              { onclick: () => this.host.act({ type: 'setQuick', item: stack.item }) },
              'Set as quick item',
            ),
      );
    }
    return h(
      'div',
      {},
      h('div', { class: 'title' }, this.host.icon(stack.item), h('h2', {}, itemName(def, stack.level))),
      h('p', {}, def.description),
      h('ul', { class: 'facts' }, ...facts(def, stack.level).map((f) => h('li', {}, f))),
      h('div', { class: 'actions' }, ...buttons),
    );
  }

  private cell(
    sim: Simulation,
    stack: ItemStack | null,
    label: string | null,
    onclick: (() => void) | null,
  ): HTMLElement {
    const cell = h('button', { class: stack ? 'cell' : 'cell empty', disabled: onclick === null });
    if (onclick) cell.onclick = onclick;
    if (stack) {
      const def = sim.content.item(stack.item);
      cell.title = itemName(def, stack.level);
      cell.append(this.host.icon(stack.item));
      if (stack.count > 1 || def.kind === 'consumable')
        cell.append(h('span', { class: 'count' }, String(stack.count)));
      if (stack.level > 0) cell.append(h('span', { class: 'level' }, `+${stack.level}`));
    }
    if (label) cell.append(h('span', { class: 'label' }, label));
    return cell;
  }

  // ------------------------------------------------------------------ crafting tab

  // ------------------------------------------------------------------ abilities tab

  /** The class's three abilities: their keys, what they do, and whether they are ready. */
  private abilitiesTab(sim: Simulation): HTMLElement {
    const a = sim.ecs.get(sim.player, Abilities);
    const cls = a ? sim.content.classes[a.class] : undefined;
    if (!a || !cls) return h('div', { class: 'body abilities' }, h('p', { class: 'hint' }, 'No class.'));
    const status = abilityStatus(sim);
    const rows = ABILITY_SLOTS.map((slot) => {
      const def = sim.content.ability(cls.abilities[slot]);
      const locked = slot !== 'aoe' && !a.unlocked[slot];
      const rule = locked
        ? unlockHint(sim.content, slot)
        : slot === 'super'
          ? 'Needs a full energy bar. Hits and kills fill it; so does time.'
          : `${def.cooldown} s cooldown.`;
      return h(
        'div',
        { class: locked ? 'ability-row locked' : 'ability-row' },
        h(
          'div',
          { class: 'keys' },
          this.host.abilityIcon(cls.abilities[slot]),
          h('kbd', {}, primaryKey(this.host.bindings(), SLOT_BINDING[slot])),
        ),
        h(
          'div',
          { class: 'what' },
          h('div', { class: 'kind' }, SLOT_NAMES[slot]),
          h('div', { class: 'name' }, def.name),
          h('div', { class: 'desc' }, def.description),
          h('div', { class: 'rule' }, rule),
        ),
        h(
          'div',
          { class: !locked && status[slot] === 'Ready' ? 'status ready' : 'status' },
          locked ? 'Locked' : status[slot],
        ),
      );
    });
    const body = h(
      'div',
      { class: 'body abilities' },
      h(
        'div',
        { class: 'class-head' },
        this.host.sigil(a.class),
        h('h2', {}, cls.name),
        h('span', { class: 'element' }, cls.element.name),
      ),
      h('p', { class: 'about' }, cls.description),
      ...rows,
      h(
        'p',
        { class: 'hint' },
        'Abilities aim at the mouse cursor. Change class while resting at a bonfire.',
      ),
    );
    body.style.setProperty('--class-color', cls.element.base);
    body.style.setProperty('--class-light', cls.element.light);
    return body;
  }

  private craftTab(sim: Simulation): HTMLElement {
    const inv = sim.ecs.need(sim.player, Inventory);
    const souls = sim.ecs.need(sim.player, Player).souls;
    const rows = Object.entries(sim.content.recipes)
      .filter(([, r]) => !this.station || r.station === null || r.station === this.station)
      .map(([id, r]) => {
        const out = sim.content.item(r.output.item);
        const check = canCraft(sim, id);
        const costs = r.inputs.map((input) => {
          const have = countItem(inv, input.item);
          return h(
            'span',
            { class: have >= input.count ? 'cost' : 'cost short' },
            this.host.icon(input.item),
            `${input.count} ${sim.content.item(input.item).name} (${have})`,
          );
        });
        if (r.souls > 0)
          costs.push(h('span', { class: souls >= r.souls ? 'cost' : 'cost short' }, `${r.souls} souls`));
        return h(
          'div',
          { class: check.ok ? 'recipe' : 'recipe unavailable' },
          this.host.icon(r.output.item),
          h(
            'div',
            { class: 'what' },
            h('div', { class: 'name' }, r.output.count > 1 ? `${out.name} ×${r.output.count}` : out.name),
            h('div', { class: 'where' }, r.station ? STATIONS[r.station] : 'Anywhere'),
            h('div', { class: 'costs' }, ...costs),
          ),
          h(
            'button',
            {
              disabled: !check.ok,
              title: check.ok ? '' : check.reason,
              onclick: () => this.host.act({ type: 'craft', recipe: id }),
            },
            check.ok ? 'Craft' : check.reason,
          ),
        );
      });
    return h('div', { class: 'body craft' }, this.upgradePanel(sim), ...rows);
  }

  /** Forge upgrades for the equipped weapon, shown when a forge is in reach. */
  private upgradePanel(sim: Simulation): HTMLElement | string {
    if (!stationNearby(sim, 'forge')) return '';
    const weapon = sim.ecs.need(sim.player, Equipment).weapon;
    if (!weapon)
      return h('div', { class: 'upgrade' }, h('p', { class: 'hint' }, 'Equip a weapon to upgrade it.'));
    const def = sim.content.item(weapon.item);
    const next = nextUpgrade(sim);
    if (!next)
      return h(
        'div',
        { class: 'upgrade' },
        this.host.icon(weapon.item),
        `${itemName(def, weapon.level)} is fully upgraded.`,
      );
    const check = canUpgrade(sim);
    const inv = sim.ecs.need(sim.player, Inventory);
    const costs = next.items.map((c) =>
      h(
        'span',
        { class: countItem(inv, c.item) >= c.count ? 'cost' : 'cost short' },
        this.host.icon(c.item),
        `${c.count} ${sim.content.item(c.item).name} (${countItem(inv, c.item)})`,
      ),
    );
    costs.push(h('span', { class: 'cost' }, `${next.souls} souls`));
    return h(
      'div',
      { class: 'recipe upgrade' },
      this.host.icon(weapon.item),
      h(
        'div',
        { class: 'what' },
        h('div', { class: 'name' }, `Reinforce ${def.name} to +${next.level}`),
        h('div', { class: 'where' }, `+${next.damage} damage`),
        h('div', { class: 'costs' }, ...costs),
      ),
      h(
        'button',
        {
          disabled: !check.ok,
          title: check.ok ? '' : check.reason,
          onclick: () => this.host.act({ type: 'upgrade' }),
        },
        check.ok ? 'Upgrade' : check.reason,
      ),
    );
  }
}

export function itemName(def: ItemDef, level: number): string {
  return level > 0 ? `${def.name} +${level}` : def.name;
}

/** One-line facts about an item, for the detail panel. */
function facts(def: ItemDef, level: number): string[] {
  switch (def.kind) {
    case 'relic':
      return [def.unlocks === 'class' ? 'Awakens your class ability' : 'Awakens your super'];
    case 'material':
      return ['Crafting material', `Stacks to ${def.stack}`];
    case 'weapon': {
      const bonus = def.upgrades.slice(0, level).reduce((n, u) => n + u.damage, 0);
      return [
        `Damage ${def.weapon.damage + bonus}`,
        `Stamina per swing ${def.weapon.staminaCost}`,
        `Reach ${def.weapon.reach}`,
        `Upgrades ${level}/${def.upgrades.length}`,
      ];
    }
    case 'armor':
      return [`Absorbs ${Math.round(def.armor.defense * 100)}% of damage`];
    case 'ring':
      return [statLine(def.ring.stat, def.ring.amount)];
    case 'consumable':
      return def.effect.type === 'heal'
        ? [`Restores ${def.effect.amount} HP`, `Stacks to ${def.stack}`]
        : [
            `${statLine(def.effect.stat, def.effect.amount)} for ${def.effect.seconds}s`,
            `Stacks to ${def.stack}`,
          ];
  }
}

function statLine(stat: keyof typeof STAT_LABELS, amount: number): string {
  return stat === 'maxHp'
    ? `+${amount} ${STAT_LABELS[stat]}`
    : `+${Math.round(amount * 100)}% ${STAT_LABELS[stat]}`;
}

/** "Ready", "Ready in 7 s" or "Energy 43%" per slot. Whole seconds, so the screen redraws once a second. */
function abilityStatus(sim: Simulation): Record<'aoe' | 'class' | 'super', string> {
  const a = sim.ecs.get(sim.player, Abilities);
  if (!a) return { aoe: '', class: '', super: '' };
  const cd = (ticks: number) => (ticks <= 0 ? 'Ready' : `Ready in ${Math.ceil(ticks / TICK_RATE)} s`);
  return {
    aoe: cd(a.cooldowns.aoe),
    class: cd(a.cooldowns.class),
    super: a.energy >= FULL_ENERGY ? 'Ready' : `Energy ${Math.floor(a.energy)}%`,
  };
}
