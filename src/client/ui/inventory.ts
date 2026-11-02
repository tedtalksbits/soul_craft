/**
 * The inventory, equipment and crafting screen. It reads sim state directly but
 * never changes it: every button queues a PlayerAction for the next tick, and the
 * screen redraws when the state it shows changes. While it is open the world holds
 * still (`InputFrame.menu`).
 */
import { gearSlotOf } from '../../content/content';
import {
  ABILITY_SLOTS,
  ATTRIBUTES,
  STATIONS,
  type CoatingDef,
  type ItemDef,
  type StationId,
} from '../../content/schemas';
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
import { abilityIn } from '../../sim/modules/abilities';
import { FULL_ENERGY } from '../../sim/modules/energy';
import { canChoose, versionsOf } from '../../sim/modules/variants';
import { canWear, modifierSlots, modifiersOf, wornModifiers } from '../../sim/modules/modifiers';
import { playerLevel } from '../../sim/modules/progression';
import { unlockHint } from '../../sim/modules/unlocks';
import type { GearTarget, PlayerAction } from '../../sim/input';
import { AUTO_SALVAGE_TIERS } from '../../sim/modules/smithy';
import { canCraft, canUpgrade, nextUpgrade, stationNearby } from '../../sim/modules/crafting';
import {
  gearOf,
  armorValue,
  legendaryPower,
  perkLines,
  perkText,
  weaponNumbers,
} from '../../sim/modules/gear';
import {
  compareGear,
  compareStack,
  countItem,
  playerStats,
  type Comparison,
  type GearSummary,
} from '../../sim/modules/items';
import { gearPower, maxPower, playerPower } from '../../sim/modules/power';
import { canStash, canUnstash } from '../../sim/modules/stash';
import {
  pocketOf,
  pocketUsed,
  STASH_CLOSED,
  stashable,
  stashCapacity,
  stashOf,
  stashReachable,
  type Pocket,
} from '../../sim/modules/storage';
import type { Simulation } from '../../sim/simulation';
import { TICK_RATE } from '../../sim/constants';
import { primaryKey, type Bindings } from '../keybinds';
import { h } from './dom';
import { gearWork } from './smithy-panel';

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

type Tab = 'items' | 'bag' | 'stash' | 'craft' | 'abilities';

const SLOT_BINDING = { aoe: 'aoe', class: 'classAbility', super: 'super' } as const;
const SLOT_NAMES = { aoe: 'AoE ability', class: 'Class ability', super: 'Super' } as const;

const SLOT_LABELS: Readonly<Record<EquipSlot, string>> = {
  weapon: 'Weapon',
  ring0: 'Ring',
  ring1: 'Ring',
  helmet: 'Helmet',
  chest: 'Chest',
  legs: 'Legs',
};

const ATTRIBUTE_NAMES = { vigor: 'Vigor', endurance: 'Endurance', might: 'Might', attunement: 'Attunement' };

const STAT_LABELS = {
  damage: 'damage',
  defense: 'damage taken',
  staminaRegen: 'stamina regen',
  maxHp: 'max HP',
} as const;

/** What is selected: a pack slot, a piece of equipped gear, or a place in the stash. */
type Selection = { pack: number } | { slot: EquipSlot } | { stash: number };

/** A piece owned for a slot, and where it is: in a pocket (by pack index) or in the stash (by stash index). */
interface Owned {
  stack: ItemStack;
  index: number;
  from: 'pack' | 'stash';
}

export class InventoryScreen {
  private el: HTMLElement | null = null;
  private tab: Tab = 'items';
  /** The station this screen was opened at; filters the crafting list. */
  private station: StationId | null = null;
  private selected: Selection | null = null;
  /** A Noble or Legendary salvage waiting on its second press. */
  private confirmSalvage = false;
  /** The slot whose flyout is open, and the piece hovered in it. */
  private flyoutSlot: EquipSlot | null = 'weapon';
  private hover: { from: 'pack' | 'stash'; index: number } | null = null;
  /** The full stat sheet is shown. */
  private details = false;
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
        : this.tab === 'bag'
          ? this.bagTab(sim)
          : this.tab === 'stash'
            ? this.stashTab(sim)
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
      this.flyoutSlot,
      this.hover,
      this.details,
      sim.ecs.get(e, Inventory)?.stacks,
      sim.state.stash,
      sim.state.checkpoint?.id,
      sim.ecs.get(e, Equipment),
      sim.ecs.get(e, Player)?.souls,
      sim.ecs.get(e, Buffs)?.active.map((b) => b.stat),
      stationNearby(sim, 'forge'),
      stationNearby(sim, 'alchemy'),
      sim.ecs.get(e, Player)?.state === 'sit',
      sim.state.restored,
      sim.state.autoSalvage,
      this.confirmSalvage,
      this.tab === 'abilities' ? abilityStatus(sim) : null,
      this.tab === 'abilities' ? variantSignature(sim) : null,
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
      tab('items', 'Character'),
      tab('bag', 'Bag'),
      tab('stash', 'Stash'),
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

  /**
   * The character screen (docs/power-and-stash.md, section 6): six slot tiles showing only icon, tier and Power.
   * Hovering one opens its flyout, everything owned for that slot, highest Power first (stashed pieces dimmed);
   * hovering a piece there shows a short card, clicking equips it, right-clicking inspects it in full.
   */
  private itemsTab(sim: Simulation): HTMLElement {
    const e = sim.player;
    const eq = sim.ecs.need(e, Equipment);
    const open = this.flyoutSlot;

    const slotTile = (slot: EquipSlot) => {
      const stack = eq[slot];
      const on = open === slot;
      const tile = h(
        'button',
        {
          class: on ? 'slot-tile open' : 'slot-tile',
          onmouseenter: () => this.openSlot(slot),
          onfocus: () => this.openSlot(slot),
          onclick: () => (stack ? this.select({ slot }) : this.openSlot(slot)),
        },
        this.cell(sim, stack, null, null),
        h(
          'div',
          { class: 'what' },
          h('div', { class: 'label' }, SLOT_LABELS[slot]),
          h('div', { class: 'tile-power' }, stack?.gear ? String(stack.gear.power) : '–'),
        ),
      );
      return tile;
    };

    const quickCount = eq.quick ? countItem(sim.ecs.need(e, Inventory), eq.quick) : 0;
    const quick = this.cell(
      sim,
      eq.quick ? { item: eq.quick, count: quickCount, level: 0 } : null,
      'Quick (Q)',
      eq.quick ? () => this.host.act({ type: 'setQuick', item: null }) : null,
    );
    const power = playerPower(sim);
    const max = maxPower(sim);

    const stats = playerStats(sim, e);
    const capped = stats.defense >= sim.content.player.armor.cap;
    const statLine = [
      `Attack ${Math.round(stats.damage)}`,
      `Armor ${stats.armor} (${Math.round(stats.defense * 100)}% less damage${capped ? ', capped' : ''})`,
      `HP ${stats.maxHp}`,
      `Stamina ${stats.maxStamina}`,
    ].join(' · ');

    return h(
      'div',
      { class: 'body character' },
      h(
        'div',
        { class: 'power-head' },
        h('div', { class: 'power-label' }, 'Power'),
        h('div', { class: 'power-value' }, String(power)),
        h(
          'div',
          { class: 'power-max', title: 'Drops are based on this: the best piece you own per slot' },
          `Max ${max}`,
        ),
        h(
          'button',
          {
            class: 'work',
            disabled: max <= power && !this.betterReachable(sim),
            title: 'Put on the highest-Power piece you can reach for every slot',
            onclick: () => this.host.act({ type: 'equipBest' }),
          },
          'Equip best',
        ),
        quick,
      ),
      h(
        'div',
        { class: 'doll' },
        h('div', { class: 'side' }, ...(['weapon', 'ring0', 'ring1'] as const).map(slotTile)),
        this.flyout(sim),
        h('div', { class: 'side' }, ...(['helmet', 'chest', 'legs'] as const).map(slotTile)),
      ),
      h(
        'div',
        { class: 'stat-line' },
        h('span', {}, statLine),
        h(
          'button',
          { class: 'quiet', onclick: () => this.toggleDetails() },
          this.details ? 'Hide details' : 'Details',
        ),
      ),
      this.details ? this.statSheet(sim) : '',
      this.packTools(sim),
      h('div', { class: 'col detail' }, this.selected ? this.selectedDetail(sim) : this.card(sim)),
    );
  }

  /** Everything owned for the open slot: carried pieces, then stashed ones, highest Power first. */
  private flyout(sim: Simulation): HTMLElement {
    const slot = this.flyoutSlot;
    if (!slot)
      return h(
        'div',
        { class: 'flyout' },
        h('p', { class: 'hint' }, 'Hover a slot to see what you have for it.'),
      );
    const pieces = this.owned(sim, slot);
    const worn = gearPower(sim.ecs.need(sim.player, Equipment)[slot]);
    const reach = stashReachable(sim);
    const tiles = pieces.map((p) => {
      const on = this.hover !== null && this.hover.from === p.from && this.hover.index === p.index;
      const cell = this.cell(sim, p.stack, null, () =>
        this.host.act(
          p.from === 'pack'
            ? { type: 'equip', index: p.index, slot }
            : { type: 'equipStash', index: p.index, slot },
        ),
      );
      cell.classList.add('flyout-cell');
      if (on) cell.classList.add('selected');
      if (p.from === 'stash') {
        cell.classList.add('stashed');
        if (!reach) cell.title = `${cell.title} (in the stash: ${STASH_CLOSED})`;
      }
      cell.onmouseenter = () => this.hoverPiece({ from: p.from, index: p.index });
      cell.oncontextmenu = (ev) => {
        ev.preventDefault();
        this.select(p.from === 'pack' ? { pack: p.index } : { stash: p.index });
      };
      const pw = gearPower(p.stack);
      cell.append(h('span', { class: 'power-badge' }, String(pw)));
      if (pw > worn) cell.append(h('span', { class: 'better', title: 'More Power than what you wear' }, '▲'));
      if (p.from === 'stash') cell.append(h('span', { class: 'stash-mark', title: 'In the stash' }, 'S'));
      return cell;
    });
    const carried = pieces.filter((p) => p.from === 'pack').length;
    const stashed = pieces.length - carried;
    return h(
      'div',
      { class: 'flyout' },
      h('h2', {}, `${SLOT_LABELS[slot]} · ${carried} carried${stashed ? `, ${stashed} in the stash` : ''}`),
      tiles.length
        ? h('div', { class: 'grid' }, ...tiles)
        : h('p', { class: 'hint' }, 'Nothing else for this slot yet.'),
      h('p', { class: 'hint' }, 'Click to equip · right-click to inspect'),
    );
  }

  /** The pieces owned for a slot (rings for either ring slot), carried then stashed, highest Power first. */
  private owned(sim: Simulation, slot: EquipSlot): Owned[] {
    const kind = slot === 'ring0' || slot === 'ring1' ? 'ring' : slot;
    const fits = (stack: ItemStack) => gearSlotOf(sim.content.item(stack.item)) === kind;
    const carried = sim.ecs
      .need(sim.player, Inventory)
      .stacks.map((stack, index): Owned => ({ stack, index, from: 'pack' }))
      .filter((p) => fits(p.stack));
    const stashed = stashOf(sim)
      .map((stack, index): Owned => ({ stack, index, from: 'stash' }))
      .filter((p) => fits(p.stack));
    return [...carried, ...stashed].sort((x, y) => gearPower(y.stack) - gearPower(x.stack));
  }

  /** Whether Equip best would change anything: some reachable piece has more Power than what is worn. */
  private betterReachable(sim: Simulation): boolean {
    const eq = sim.ecs.need(sim.player, Equipment);
    return (['weapon', 'helmet', 'chest', 'legs', 'ring0', 'ring1'] as const).some((slot) =>
      this.owned(sim, slot).some(
        (p) => (p.from === 'pack' || stashReachable(sim)) && gearPower(p.stack) > gearPower(eq[slot]),
      ),
    );
  }

  /** The short card for the hovered piece: name, tier, Power, the two changes that matter, its perks. */
  private card(sim: Simulation): HTMLElement {
    const slot = this.flyoutSlot;
    const hover = this.hover;
    const stack =
      hover === null
        ? undefined
        : hover.from === 'pack'
          ? sim.ecs.need(sim.player, Inventory).stacks[hover.index]
          : stashOf(sim)[hover.index];
    if (!slot || !hover || !stack) {
      const worn = slot ? sim.ecs.need(sim.player, Equipment)[slot] : null;
      if (worn) return this.shortCard(sim, worn, null, 'Click the slot to inspect it in full.');
      return h('p', { class: 'hint' }, 'Hover a piece to compare it with what you wear.');
    }
    const c = compareStack(sim, stack, slot);
    const where =
      hover.from === 'stash' && !stashReachable(sim)
        ? `In the stash: ${STASH_CLOSED} to equip it.`
        : 'Click to equip · right-click to inspect';
    return this.shortCard(sim, stack, c, where);
  }

  private shortCard(sim: Simulation, stack: ItemStack, c: Comparison | null, hint: string): HTMLElement {
    const def = sim.content.item(stack.item);
    const gear = gearOf(stack);
    const tier = sim.content.loot.tiers[gear.tier];
    const kind = gearSlotOf(def);
    const legendary = legendaryPower(sim.content, stack);
    const changes: HTMLElement[] = [];
    if (c) {
      const delta = (
        label: string,
        now: number,
        after: number,
        fmt: (n: number) => string,
        lower = false,
      ) => {
        const diff = after - now;
        if (Math.abs(diff) < 1e-9) return;
        const good = lower ? diff < 0 : diff > 0;
        changes.push(
          h(
            'li',
            { class: good ? 'up' : 'down' },
            `${label} ${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} ${good ? '▲' : '▼'}`,
          ),
        );
      };
      const whole = (n: number) => String(Math.round(n));
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      delta('Power', c.now.power, c.after.power, whole);
      if (kind === 'weapon') delta('Attack', c.now.damage, c.after.damage, whole);
      else if (kind === 'ring') {
        delta('Max HP', c.now.maxHp, c.after.maxHp, whole);
        delta('Max stamina', c.now.maxStamina, c.after.maxStamina, whole);
      } else delta('Damage taken', 1 - c.now.defense, 1 - c.after.defense, pct, true);
    }
    const perks = perkLines(sim.content, stack).filter((l) => !l.innate || legendary === undefined);
    const card = h(
      'div',
      { class: 'short-card' },
      h('div', { class: 'title' }, this.cell(sim, stack, null, null), this.gearName(sim, stack)),
      h(
        'div',
        { class: 'tierline' },
        `${gear.blighted ? 'Blighted ' : ''}${tier.name} ${kind ? capitalize(kind) : ''} · Power ${gear.power}`,
      ),
      changes.length ? h('ul', { class: 'changes' }, ...changes.slice(0, 3)) : '',
      h(
        'ul',
        { class: 'perks' },
        legendary ? h('li', { class: 'legendary' }, `${legendary.name}: ${legendary.text}`) : '',
        ...perks.map((l) => h('li', { class: l.drawback ? 'drawback' : '' }, perkText(sim.content, l))),
      ),
      h('p', { class: 'hint' }, hint),
    );
    card.style.setProperty('--tier', tier.color);
    return card;
  }

  /** The full stat sheet, behind Details. */
  private statSheet(sim: Simulation): HTMLElement {
    const stats = playerStats(sim, sim.player);
    const attrs = sim.ecs.get(sim.player, Attributes);
    const rows: [string, string][] = [
      ['Level', attrs ? String(playerLevel(attrs)) : '1'],
      ['Stamina regen', `${Math.round(stats.staminaRegen * TICK_RATE)}/s`],
      ...ATTRIBUTES.map((id): [string, string] => {
        const own = attrs?.[id] ?? 0;
        const extra = stats.attributes[id] - own;
        return [
          ATTRIBUTE_NAMES[id],
          extra > 0 ? `${stats.attributes[id]} (${own} +${extra} gear)` : String(own),
        ];
      }),
    ];
    return h('dl', { class: 'stat-sheet' }, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
  }

  /** Consumables and materials: the bag (with its limit) and the counts. */
  private bagTab(sim: Simulation): HTMLElement {
    const inv = sim.ecs.need(sim.player, Inventory);
    const picked = this.selected;
    const cells = (pocket: (p: Pocket) => boolean) =>
      inv.stacks
        .map((stack, i) => ({ stack, i }))
        .filter(({ stack }) => pocket(pocketOf(sim.content, stack.item)))
        .map(({ stack, i }) => {
          const on = picked !== null && 'pack' in picked && picked.pack === i;
          const cell = this.cell(sim, stack, null, () => this.select(on ? null : { pack: i }));
          if (on) cell.classList.add('selected');
          return cell;
        });
    const index = picked && 'pack' in picked ? picked.pack : null;
    const stack = index === null ? undefined : inv.stacks[index];
    const shown =
      index !== null && stack && !gearSlotOf(sim.content.item(stack.item))
        ? this.detail(sim, stack, index)
        : h('p', { class: 'hint' }, 'Select something to use it or stash it.');
    return h(
      'div',
      { class: 'body items' },
      h(
        'div',
        { class: 'col' },
        h('h2', {}, `Bag ${pocketUsed(sim.content, inv, 'bag')}/${sim.content.player.storage.bag}`),
        h('div', { class: 'grid' }, ...cells((p) => p === 'bag')),
        h('h2', {}, 'Materials'),
        h('div', { class: 'grid' }, ...cells((p) => p === 'materials')),
      ),
      h('div', { class: 'col detail' }, shown),
    );
  }

  private openSlot(slot: EquipSlot): void {
    if (this.flyoutSlot === slot) return;
    this.flyoutSlot = slot;
    this.hover = null;
    this.refresh(true);
  }

  private hoverPiece(piece: { from: 'pack' | 'stash'; index: number }): void {
    if (this.hover?.from === piece.from && this.hover.index === piece.index) return;
    this.hover = piece;
    this.selected = null;
    this.refresh(true);
  }

  private toggleDetails(): void {
    this.details = !this.details;
    this.refresh(true);
  }

  /**
   * Keyboard on the character screen: the arrows move between slots (up and down a column, left and right across),
   * Enter equips the highest-Power piece for the open slot. True if it used the key.
   */
  key(code: string): boolean {
    if (!this.el || this.tab !== 'items') return false;
    const columns: EquipSlot[][] = [
      ['weapon', 'ring0', 'ring1'],
      ['helmet', 'chest', 'legs'],
    ];
    const at = this.flyoutSlot ?? 'weapon';
    const col = columns.findIndex((c) => c.includes(at));
    const row = columns[col]!.indexOf(at);
    const move = (c: number, r: number) => {
      const next = columns[(c + 2) % 2]![(r + 3) % 3]!;
      this.openSlot(next);
      return true;
    };
    switch (code) {
      case 'ArrowUp':
        return move(col, row - 1);
      case 'ArrowDown':
        return move(col, row + 1);
      case 'ArrowLeft':
      case 'ArrowRight':
        return move(col + 1, row);
      case 'Enter': {
        const sim = this.host.sim();
        const best = sim ? this.owned(sim, at)[0] : undefined;
        if (!best) return false;
        this.host.act(
          best.from === 'pack'
            ? { type: 'equip', index: best.index, slot: at }
            : { type: 'equipStash', index: best.index, slot: at },
        );
        return true;
      }
      default:
        return false;
    }
  }

  private select(selection: Selection | null): void {
    this.selected = selection;
    this.confirmSalvage = false;
    this.refresh(true);
  }

  private selectedDetail(sim: Simulation): HTMLElement {
    const picked = this.selected;
    const back = h('button', { class: 'quiet', onclick: () => this.select(null) }, 'Back');
    if (picked && 'slot' in picked) {
      const stack = sim.ecs.need(sim.player, Equipment)[picked.slot];
      if (stack)
        return this.gearDetail(
          sim,
          stack,
          [
            back,
            h('button', { onclick: () => this.host.act({ type: 'unequip', slot: picked.slot }) }, 'Unequip'),
          ],
          null,
          this.work(sim, { slot: picked.slot }, stack),
        );
    }
    if (picked && 'stash' in picked) {
      const stack = stashOf(sim)[picked.stash];
      if (stack) {
        const index = picked.stash;
        const check = canUnstash(sim, index);
        return this.gearDetail(
          sim,
          stack,
          [
            back,
            h(
              'button',
              {
                disabled: !stashReachable(sim),
                title: stashReachable(sim) ? '' : STASH_CLOSED,
                onclick: () =>
                  this.host.act({
                    type: 'equipStash',
                    index,
                    ...(this.flyoutSlot ? { slot: this.flyoutSlot } : {}),
                  }),
              },
              'Equip',
            ),
            h(
              'button',
              {
                disabled: !check.ok,
                title: check.ok ? '' : check.reason,
                onclick: () => this.host.act({ type: 'unstash', index }),
              },
              'Take',
            ),
          ],
          compareStack(sim, stack, this.flyoutSlot ?? 'weapon'),
        );
      }
    }
    const index = picked && 'pack' in picked ? picked.pack : null;
    const stack = index === null ? undefined : sim.ecs.need(sim.player, Inventory).stacks[index];
    if (index === null || !stack) return h('p', { class: 'hint' }, 'Select an item or a piece of your gear.');
    return this.detail(sim, stack, index);
  }

  private detail(sim: Simulation, stack: ItemStack, index: number): HTMLElement {
    const def = sim.content.item(stack.item);
    if (gearSlotOf(def)) {
      const comparison = compareGear(sim, index);
      return this.gearDetail(
        sim,
        stack,
        [
          h('button', { class: 'quiet', onclick: () => this.select(null) }, 'Back'),
          h(
            'button',
            {
              onclick: () =>
                this.host.act({
                  type: 'equip',
                  index,
                  ...(this.flyoutSlot ? { slot: this.flyoutSlot } : {}),
                }),
            },
            'Equip',
          ),
          this.stashButton(sim, index),
        ],
        this.flyoutSlot ? compareStack(sim, stack, this.flyoutSlot) : comparison,
        this.work(sim, { pack: index }, stack),
      );
    }
    const quick = sim.ecs.need(sim.player, Equipment).quick;
    const buttons: HTMLElement[] = [];
    if (def.kind === 'consumable') {
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
    if (stashable(sim.content, stack.item)) buttons.push(this.stashButton(sim, index));
    return this.plainDetail(sim, stack, buttons);
  }

  private plainDetail(sim: Simulation, stack: ItemStack, buttons: HTMLElement[]): HTMLElement {
    const def = sim.content.item(stack.item);
    return h(
      'div',
      {},
      h('div', { class: 'title' }, this.host.icon(stack.item), h('h2', {}, itemName(def, stack.level))),
      h('p', {}, def.description),
      h('ul', { class: 'facts' }, ...facts(def).map((f) => h('li', {}, f))),
      h('div', { class: 'actions' }, ...buttons),
    );
  }

  /** Puts a carried piece in the stash; greyed out, with the reason, where the stash doesn't open. */
  private stashButton(sim: Simulation, index: number): HTMLElement {
    const check = canStash(sim, index);
    return h(
      'button',
      {
        disabled: !check.ok,
        title: check.ok ? '' : check.reason,
        onclick: () => this.host.act({ type: 'stash', index }),
      },
      'Stash',
    );
  }

  // ------------------------------------------------------------------ stash tab

  /** Everything kept at the bonfire: browse it anywhere, take from it where it opens. */
  private stashTab(sim: Simulation): HTMLElement {
    const kept = stashOf(sim);
    const picked = this.selected;
    const cells = kept.map((stack, i) => {
      const on = picked !== null && 'stash' in picked && picked.stash === i;
      const cell = this.cell(sim, stack, null, () => this.select(on ? null : { stash: i }));
      if (on) cell.classList.add('selected');
      return cell;
    });
    const where = stashReachable(sim)
      ? 'Open here: take what you need.'
      : 'Rest at the village bonfire to take from it (at any bonfire, once the Storehouse is rebuilt). Full pockets send new gear here from anywhere.';
    const index = picked && 'stash' in picked ? picked.stash : null;
    const stack = index === null ? undefined : kept[index];
    let detail: HTMLElement = h('p', { class: 'hint' }, 'Select something in the stash.');
    if (index !== null && stack) {
      const check = canUnstash(sim, index);
      const take = h(
        'button',
        {
          disabled: !check.ok,
          title: check.ok ? '' : check.reason,
          onclick: () => this.host.act({ type: 'unstash', index }),
        },
        'Take',
      );
      detail = gearSlotOf(sim.content.item(stack.item))
        ? this.gearDetail(sim, stack, [take])
        : this.plainDetail(sim, stack, [take]);
    }
    return h(
      'div',
      { class: 'body items' },
      h(
        'div',
        { class: 'col' },
        h('h2', {}, `Stash ${kept.length}/${stashCapacity(sim)}`),
        h('p', { class: 'hint' }, where),
        h('div', { class: 'grid' }, ...cells),
      ),
      h('div', { class: 'col detail' }, detail),
    );
  }

  /**
   * A piece of gear: its tier, item level and numbers, every perk, and (for a pack item) how wearing
   * it would change things, worked out by trying it on in the sim.
   */
  private gearDetail(
    sim: Simulation,
    stack: ItemStack,
    buttons: HTMLElement[],
    comparison: Comparison | null = null,
    work: HTMLElement | null = null,
  ): HTMLElement {
    const def = sim.content.item(stack.item);
    const gear = gearOf(stack);
    const tier = sim.content.loot.tiers[gear.tier];
    const slot = gearSlotOf(def);
    const lines = perkLines(sim.content, stack);
    const old = comparison?.replaces ? perkLines(sim.content, comparison.replaces) : [];
    const playing = sim.ecs.get(sim.player, Abilities)?.class;
    const perkRow = (line: (typeof lines)[number], change: string) => {
      const classes = ['perk', change, line.drawback ? 'drawback' : '', line.greater ? 'greater' : ''];
      // A class perk for another class does nothing while you play this one.
      if (line.cls !== undefined && line.cls !== playing) classes.push('idle');
      return h(
        'li',
        { class: classes.filter(Boolean).join(' ') },
        line.greater
          ? h('span', { class: 'star', title: 'Greater: stronger than its tier allows' }, '★ ')
          : '',
        perkText(sim.content, line),
        line.innate ? h('span', { class: 'tag' }, ' innate') : '',
        line.cls !== undefined
          ? h('span', { class: 'tag' }, ` ${sim.content.playerClass(line.cls).name}`)
          : '',
      );
    };
    const power = legendaryPower(sim.content, stack);
    const gained = (perk: string) => comparison !== null && !old.some((o) => o.perk === perk);
    const panel = h(
      'div',
      { class: 'gear-detail' },
      h('div', { class: 'title' }, this.cell(sim, stack, null, null), this.gearName(sim, stack)),
      h(
        'div',
        { class: 'tierline' },
        `${gear.blighted ? 'Blighted ' : ''}${tier.name} ${slot ? capitalize(slot) : ''} · Power ${gear.power}`,
      ),
      comparison ? this.comparisonTable(sim, comparison) : '',
      power
        ? h(
            'div',
            { class: 'power-line' },
            h('div', { class: 'pname' }, power.name),
            h('div', {}, power.text),
          )
        : '',
      h('ul', { class: 'facts' }, ...gearFacts(sim, stack).map((f) => h('li', {}, f))),
      lines.length > 0 || old.length > 0
        ? h(
            'ul',
            { class: 'perks' },
            ...lines.map((line) => perkRow(line, gained(line.perk) && !line.drawback ? 'gain' : '')),
            ...old.filter((o) => !lines.some((l) => l.perk === o.perk)).map((line) => perkRow(line, 'lose')),
          )
        : h('p', { class: 'hint' }, 'No perks.'),
      h('p', { class: 'flavor' }, def.description),
      h('div', { class: 'actions' }, ...buttons),
      work ?? '',
    );
    panel.style.setProperty('--tier', tier.color);
    return panel;
  }

  /** "Power +12 ▲" and the rest: the real change from wearing it, worse or better. */
  private comparisonTable(sim: Simulation, c: Comparison): HTMLElement {
    const replaced = c.replaces ? sim.content.item(c.replaces.item).name : null;
    const row = (
      label: string,
      now: number,
      after: number,
      format: (n: number) => string,
      lowerIsBetter = false,
    ) => {
      const diff = after - now;
      const better = lowerIsBetter ? diff < 0 : diff > 0;
      const cls = Math.abs(diff) < 1e-9 ? 'same' : better ? 'up' : 'down';
      const mark =
        cls === 'same' ? '–' : `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))} ${better ? '▲' : '▼'}`;
      return [h('dt', {}, label), h('dd', { class: cls }, mark)];
    };
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const whole = (n: number) => String(Math.round(n));
    const taken = (s: GearSummary) => 1 - s.defense;
    return h(
      'div',
      { class: 'compare' },
      h(
        'div',
        { class: 'against' },
        replaced ? `Compared with ${replaced}` : `Your ${SLOT_LABELS[c.slot].toLowerCase()} slot is empty`,
      ),
      h(
        'dl',
        {},
        ...row('Power', c.now.power, c.after.power, whole),
        ...row('Attack', c.now.damage, c.after.damage, whole),
        ...row('Armor', c.now.armor, c.after.armor, whole),
        ...row('Damage taken', taken(c.now), taken(c.after), pct, true),
        ...row('Max HP', c.now.maxHp, c.after.maxHp, whole),
        ...row('Max stamina', c.now.maxStamina, c.after.maxStamina, whole),
      ),
    );
  }

  /** The smithy's buttons for a piece of gear, wired to this screen. */
  private work(sim: Simulation, target: GearTarget, stack: ItemStack): HTMLElement {
    return gearWork(sim, target, stack, {
      act: (action) => this.host.act(action),
      confirming: this.confirmSalvage,
      confirm: (on) => {
        this.confirmSalvage = on;
        this.refresh(true);
      },
    });
  }

  /** Under the pack: salvage everything marked junk, and which tiers salvage themselves on pickup. */
  private packTools(sim: Simulation): HTMLElement {
    const stacks = sim.ecs.need(sim.player, Inventory).stacks;
    const junk = stacks.filter((s) => s.junk && !s.locked).length;
    const can = stationNearby(sim, 'forge') || sim.ecs.need(sim.player, Player).state === 'sit';
    const auto = sim.state.autoSalvage ?? [];
    return h(
      'div',
      { class: 'pack-tools' },
      h(
        'button',
        {
          class: 'work',
          disabled: !can || junk === 0,
          title: can ? '' : 'salvage at the forge or a bonfire',
          onclick: () => this.host.act({ type: 'salvageJunk' }),
        },
        `Salvage junk (${junk})`,
      ),
      h('span', { class: 'hint' }, 'Auto-salvage:'),
      ...AUTO_SALVAGE_TIERS.map((tier) => {
        const on = auto.includes(tier);
        return h(
          'button',
          {
            class: on ? 'work toggle on' : 'work toggle',
            onclick: () => this.host.act({ type: 'autoSalvage', tier, on: !on }),
          },
          `${on ? '☑' : '☐'} ${sim.content.loot.tiers[tier].name}`,
        );
      }),
    );
  }

  /** An item's name in its tier's color, with its upgrade level. */
  private gearName(sim: Simulation, stack: ItemStack): HTMLElement {
    const def = sim.content.item(stack.item);
    const tier = gearSlotOf(def) ? sim.content.loot.tiers[gearOf(stack).tier] : null;
    const name = h('div', { class: 'name' }, itemName(def, stack.level));
    if (tier) name.style.color = tier.color;
    return name;
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
      if (gearSlotOf(def)) {
        const tier = gearOf(stack).tier;
        cell.classList.add('tiered', `tier-${tier}`);
        cell.style.setProperty('--tier', sim.content.loot.tiers[tier].color);
      }
      if (stack.count > 1 || def.kind === 'consumable')
        cell.append(h('span', { class: 'count' }, String(stack.count)));
      if (stack.level > 0) cell.append(h('span', { class: 'level' }, `+${stack.level}`));
      if (stack.locked) cell.append(h('span', { class: 'mark', title: 'Locked' }, '🔒'));
      else if (stack.junk) cell.append(h('span', { class: 'mark junk', title: 'Junk' }, '✕'));
    }
    if (label) cell.append(h('span', { class: 'label' }, label));
    return cell;
  }

  // ------------------------------------------------------------------ crafting tab

  // ------------------------------------------------------------------ abilities tab

  /**
   * The other versions of an ability: what each does, and a button to learn or use it. Changes
   * happen at a bonfire, so away from one the buttons say so.
   */
  private versions(sim: Simulation, base: string, current: string): HTMLElement {
    const all = versionsOf(sim.content, base);
    if (all.length < 2) return h('div', { class: 'versions empty' });
    const a = sim.ecs.need(sim.player, Abilities);
    const rows = all
      .filter(([id]) => id !== current)
      .map(([id, def]) => {
        const check = canChoose(sim, base, id);
        const learned = id === base || a.learned[id] === true;
        const label = learned ? 'Use' : `Learn · ${def.souls ?? 0} souls`;
        const button = h(
          'button',
          {
            disabled: !check.ok,
            title: check.ok ? '' : check.reason,
            onclick: () => this.host.act({ type: 'chooseVariant', base, ability: id }),
          },
          label,
        );
        return h(
          'div',
          { class: 'version' },
          h(
            'div',
            {},
            h('span', { class: 'vname' }, def.name),
            ' ',
            h('span', { class: 'vdesc' }, def.description),
          ),
          button,
        );
      });
    const p = sim.ecs.get(sim.player, Player);
    const note =
      p?.state === 'sit' ? null : h('div', { class: 'rule' }, 'Rest at a bonfire to change versions.');
    return h(
      'div',
      { class: 'versions' },
      h('div', { class: 'kind' }, 'Other versions'),
      ...rows,
      ...(note ? [note] : []),
    );
  }

  /**
   * The class's modifiers: which are worn, in how many slots, and a button to put each on or take
   * it off. Like versions, changes happen at a bonfire.
   */
  private modifiers(sim: Simulation, cls: string): HTMLElement {
    const ids = modifiersOf(sim, cls);
    const a = sim.ecs.need(sim.player, Abilities);
    const worn = wornModifiers(sim);
    const slots = modifierSlots(sim);
    const rows = ids.map((id) => {
      const def = sim.content.modifier(id);
      const on = worn.includes(id);
      const check = canWear(sim, id, !on);
      const label = on
        ? 'Take off'
        : a.learned[id] || def.boss !== undefined
          ? 'Wear'
          : `Learn · ${def.souls ?? 0} souls`;
      const source =
        def.boss !== undefined && !sim.state.bossesDefeated[def.boss]
          ? h('span', { class: 'vsource' }, `From the ${sim.content.enemy(def.boss).name}.`)
          : null;
      return h(
        'div',
        { class: on ? 'version worn' : 'version' },
        h(
          'div',
          {},
          h('span', { class: 'vname' }, def.name),
          ' ',
          h('span', { class: 'vdesc' }, def.description),
          ...(source ? [' ', source] : []),
        ),
        h(
          'button',
          {
            disabled: !check.ok,
            title: check.ok ? '' : check.reason,
            onclick: () => this.host.act({ type: 'wearModifier', modifier: id, on: !on }),
          },
          label,
        ),
      );
    });
    const p = sim.ecs.get(sim.player, Player);
    const note =
      p?.state === 'sit' ? null : h('div', { class: 'rule' }, 'Rest at a bonfire to change modifiers.');
    return h(
      'div',
      { class: 'ability-row modifiers' },
      h(
        'div',
        { class: 'what' },
        h('div', { class: 'kind' }, 'Modifiers'),
        h('div', { class: 'name' }, `${worn.length} of ${slots} worn`),
        h(
          'div',
          { class: 'rule' },
          'Passive bonuses for your class. Each Warden you defeat opens another slot.',
        ),
        h('div', { class: 'versions' }, ...rows, ...(note ? [note] : [])),
      ),
    );
  }

  /** The class's three abilities: their keys, what they do, and whether they are ready. */
  private abilitiesTab(sim: Simulation): HTMLElement {
    const a = sim.ecs.get(sim.player, Abilities);
    const cls = a ? sim.content.classes[a.class] : undefined;
    if (!a || !cls) return h('div', { class: 'body abilities' }, h('p', { class: 'hint' }, 'No class.'));
    const status = abilityStatus(sim);
    const rows = ABILITY_SLOTS.map((slot) => {
      const base = cls.abilities[slot];
      const current = abilityIn(sim, slot);
      const def = sim.content.ability(current);
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
          this.host.abilityIcon(current),
          h('kbd', {}, primaryKey(this.host.bindings(), SLOT_BINDING[slot])),
        ),
        h(
          'div',
          { class: 'what' },
          h('div', { class: 'kind' }, SLOT_NAMES[slot]),
          h('div', { class: 'name' }, def.name),
          h('div', { class: 'desc' }, def.description),
          h('div', { class: 'rule' }, rule),
          ...(locked ? [] : [this.versions(sim, base, current)]),
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
      ...(modifiersOf(sim, a.class).length > 0 ? [this.modifiers(sim, a.class)] : []),
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

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The headline number under a piece of gear's name on the paper doll. */
/** A piece of gear's own numbers, before perks. */
function gearFacts(sim: Simulation, stack: ItemStack): string[] {
  const def = sim.content.item(stack.item);
  const weapon = weaponNumbers(sim.content, stack);
  if (weapon && def.kind === 'weapon')
    return [
      `Damage ${weapon.damage}`,
      `Stamina per swing ${weapon.staminaCost}`,
      `Reach ${weapon.reach}`,
      `Upgrades ${stack.level}/${def.upgrades.length}`,
    ];
  const armor = armorValue(sim.content, stack);
  return armor > 0 ? [`Armor ${armor}`] : [];
}

/** One-line facts about anything that is not gear, for the detail panel. */
function facts(def: ItemDef): string[] {
  switch (def.kind) {
    case 'key':
      return ['Kept for restoring the village'];
    case 'relic':
      return [`Bring it to Maren to awaken your ${def.unlocks === 'class' ? 'class ability' : 'super'}`];
    case 'material':
      return ['Crafting material', `Stacks to ${def.stack}`];
    case 'consumable':
      if (def.effect.type === 'heal') return [`Restores ${def.effect.amount} HP`, `Stacks to ${def.stack}`];
      if (def.effect.type === 'coat')
        return [`${coatingLine(def.effect.coating)} for ${def.effect.seconds}s`, `Stacks to ${def.stack}`];
      return [
        `${statLine(def.effect.stat, def.effect.amount)} for ${def.effect.seconds}s`,
        `Stacks to ${def.stack}`,
      ];
    case 'tool':
      return [
        `${def.tool.kind === 'axe' ? 'Fells trees and mushrooms' : 'Breaks rock'}: +${def.tool.power} ${def.tool.power === 1 ? 'hit' : 'hits'} a swing`,
        `+${Math.round(def.tool.yield * 100)}% materials, and the richer finds of tier ${def.tool.tier}`,
        'Works from the pack; the best one carried counts',
      ];
    default:
      return [];
  }
}

/** What a weapon coating does, as the player reads it. */
function coatingLine(c: CoatingDef): string {
  switch (c.kind) {
    case 'fire':
      return `Weapon hits set foes burning (${c.damage} a second for ${c.seconds}s)`;
    case 'bleed':
      return `Weapon hits make foes bleed (bursting at ${c.stacks})`;
    case 'warden':
      return `+${Math.round(c.bonus * 100)}% damage to Wardens`;
  }
}

function statLine(stat: keyof typeof STAT_LABELS, amount: number): string {
  if (stat === 'maxHp') return `+${amount} ${STAT_LABELS[stat]}`;
  // A defense buff lowers damage taken; the rest raise their stat.
  return stat === 'defense'
    ? `−${Math.round(amount * 100)}% ${STAT_LABELS[stat]}`
    : `+${Math.round(amount * 100)}% ${STAT_LABELS[stat]}`;
}

/** "Ready", "Ready in 7 s" or "Energy 43%" per slot. Whole seconds, so the screen redraws once a second. */
/** What the versions lists depend on: choices, learned variants and whether the player rests. */
function variantSignature(sim: Simulation): unknown {
  const a = sim.ecs.get(sim.player, Abilities);
  return [a?.class, a?.chosen, a?.learned, a?.unlocked, sim.ecs.get(sim.player, Player)?.state === 'sit'];
}

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
