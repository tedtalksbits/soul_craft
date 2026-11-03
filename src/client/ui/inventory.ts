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
  type ToolKind,
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
import { canSalvage, junkYield } from '../../sim/modules/smithy';
import { beltOf, durabilityLeft, toolDef } from '../../sim/modules/tools';
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
import { gearWork, HOLD_MS, holdButton } from './smithy-panel';

export interface InventoryHost {
  sim(): Simulation | null;
  /** An element showing the item's icon. */
  icon(item: string): HTMLElement;
  act(action: PlayerAction): void;
  /** The player's key bindings, for key hints. */
  bindings(): Bindings;
  /** Tinted class sigils and ability icons. */
  sigil(cls: string): HTMLElement;
  /** The player as they stand, in the gear they wear, for the middle of the character screen. */
  portrait(): HTMLElement;
  /** A menu glyph (`ui_icons`: stats, attributes, actions), tinted. */
  glyph(name: string, color: string): HTMLElement;
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
const ATTRIBUTE_GLYPHS = {
  vigor: 'health',
  endurance: 'stamina',
  might: 'might',
  attunement: 'attunement',
} as const;
/** What a change chip's glyph means, for its hover text. */
const CHANGE_NAMES: Readonly<Record<string, string>> = {
  power: 'Power',
  attack: 'Attack',
  health: 'Max health',
  stamina: 'Max stamina',
  armor: 'Damage taken',
};
/** Glyph tints: ember for Power, ink for what you press, dim ash for labels. */
const EMBER = '#f0b866';
/** A carried or stashed piece, by where it is and its index there. */
type Piece = { from: 'pack' | 'stash'; index: number };
type StashFilter = 'weapon' | 'helmet' | 'chest' | 'legs' | 'ring' | 'other';
/** The stash's slot filters, each shown as a plain piece of that slot. */
const STASH_FILTERS: readonly (readonly [StashFilter, string, string])[] = [
  ['weapon', 'iron_sword', 'Weapons'],
  ['helmet', 'iron_helm', 'Helmets'],
  ['chest', 'iron_mail', 'Chest armor'],
  ['legs', 'iron_greaves', 'Leg armor'],
  ['ring', 'ring_of_vigor', 'Rings'],
];
const INK = '#ece4d2';
const DIM = '#a39a88';

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
  /** "Dismantle all junk" takes Noble pieces too, for the next run only. */
  private includeNoble = false;
  /** The slot whose flyout is open, and the piece hovered in it. */
  private flyoutSlot: EquipSlot | null = null;
  /** The tool belt quarter whose flyout is open. */
  private toolFlyout: ToolKind | null = null;
  private hover: Piece | null = null;
  /** The stash's filter by slot (null: everything). */
  private stashFilter: StashFilter | null = null;
  /** The full stat sheet is shown. */
  private details = false;
  /** A dismantle under way while F is held: the tile filling, and the timer that breaks the piece. */
  private dismantling: { cell: HTMLElement; timer: number } | null = null;
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
      this.toolFlyout,
      this.hover,
      this.stashFilter,
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
      sim.state.autoJunk,
      this.includeNoble,
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
   * The character screen (the mood board, 2026-11-02): weapon and rings left of the character, the tool belt beside
   * the weapon, armor right, one big Power number on top, a quiet info column, and key hints along the bottom. Slots
   * show only an icon, a tier frame and Power. Hovering a slot opens its flyout over the character (everything owned
   * for it, highest Power first); hovering a piece there puts its short card in the info column; clicking equips,
   * right-clicking inspects. Moving off the slots and the flyout closes it, so at rest the character is in view.
   */
  private itemsTab(sim: Simulation): HTMLElement {
    const e = sim.player;
    const eq = sim.ecs.need(e, Equipment);
    const power = playerPower(sim);
    const max = maxPower(sim);

    const slotTile = (slot: EquipSlot) => {
      const stack = eq[slot];
      const tile = h(
        'button',
        {
          class: this.flyoutSlot === slot ? 'c-slot open' : 'c-slot',
          title: SLOT_LABELS[slot],
          onmouseenter: () => this.openSlot(slot),
          onfocus: () => this.openSlot(slot),
          onclick: () => (stack ? this.select({ slot }) : this.openSlot(slot)),
        },
        this.cell(sim, stack, null, null),
      );
      if (!stack) tile.classList.add('empty');
      if (stack?.gear) tile.append(h('span', { class: 'c-power' }, String(stack.gear.power)));
      return tile;
    };

    // The tool belt: a round frame, a quarter per kind of tool (the hoe and rod quarters wait on farming and fishing).
    const belt = beltOf(sim);
    const quarter = (kind: ToolKind | null, label: string) => {
      const stack = kind ? belt[kind] : null;
      const el = h('button', {
        class: `c-quarter${kind && this.toolFlyout === kind ? ' open' : ''}${kind ? '' : ' unused'}`,
        title: label,
        disabled: !kind,
      });
      if (kind) {
        el.onmouseenter = () => this.openTool(kind);
        el.onfocus = () => this.openTool(kind);
      }
      if (stack) {
        el.append(this.host.icon(stack.item));
        const def = toolDef(sim, stack.item);
        if (def) {
          const left = durabilityLeft(sim, stack) / def.durability;
          const wear = h('span', { class: 'c-wear' });
          wear.style.setProperty('--left', String(Math.max(0, Math.min(1, left))));
          el.append(wear);
        }
      }
      return el;
    };
    const tools = h(
      'div',
      { class: 'c-tools', title: 'Tool belt' },
      quarter('axe', 'Axe'),
      quarter('pick', 'Pickaxe'),
      quarter(null, 'Hoe (comes with farming)'),
      quarter(null, 'Fishing rod (comes with fishing)'),
    );

    const quick = this.quickCell(sim);

    const info = this.selected
      ? this.selectedDetail(sim)
      : this.toolFlyout
        ? this.toolCard(sim)
        : this.hover || this.flyoutSlot
          ? this.card(sim)
          : this.statColumn(sim);

    const stage = h(
      'div',
      { class: 'c-stage' },
      h(
        'div',
        { class: 'c-left' },
        h('div', { class: 'c-weapon-row' }, slotTile('weapon'), tools),
        slotTile('ring0'),
        slotTile('ring1'),
      ),
      h(
        'div',
        { class: 'c-center' },
        this.host.portrait(),
        this.flyoutSlot || this.toolFlyout ? this.flyout(sim) : '',
      ),
      h('div', { class: 'c-right' }, slotTile('helmet'), slotTile('chest'), slotTile('legs')),
    );
    // Off the slots and the flyout, the flyout closes and the character shows again.
    stage.onmouseleave = () => this.closeFlyout();

    const key = (input: string | HTMLElement, glyph: string, what: string) =>
      this.footKey(input, glyph, what);
    return h(
      'div',
      { class: 'body character' },
      h(
        'div',
        { class: 'c-top' },
        this.tip(this.host.glyph('power', EMBER), 'Power: the average of what you wear'),
        h('span', { class: 'c-power-value' }, String(power)),
        this.tip(
          h('span', { class: 'c-max' }, this.host.glyph('power_max', DIM), String(max)),
          'Max Power: the best piece you own per slot. Drops are based on it.',
        ),
        h(
          'button',
          {
            class: 'work',
            disabled: max <= power && !this.betterReachable(sim),
            title: 'Put on the highest-Power piece you can reach for every slot',
            onclick: () => this.host.act({ type: 'equipBest' }),
          },
          this.host.glyph('best', INK),
          'Best',
        ),
        h('span', { class: 'c-gap' }),
        quick,
      ),
      h('div', { class: 'c-main' }, stage, h('div', { class: 'c-info' }, info)),
      h(
        'div',
        { class: 'c-footer' },
        key(this.host.glyph('mouse_left', INK), 'equip', 'Click: equip'),
        key(this.host.glyph('mouse_right', INK), 'inspect', 'Right-click: inspect'),
        key('X', 'junk', 'X: mark as junk'),
        key('L', 'lock', 'L: lock'),
        key('F', 'dismantle', 'Hold F: dismantle'),
        h('span', { class: 'c-gap' }),
        this.packTools(sim),
      ),
    );
  }

  /** Hover text on an element: what an icon means, so the screen itself can stay wordless. */
  private tip<T extends HTMLElement>(el: T, text: string): T {
    el.title = text;
    return el;
  }

  /** The info column at rest: the numbers that matter, one per line, the rest behind Details. */
  private statColumn(sim: Simulation): HTMLElement {
    const stats = playerStats(sim, sim.player);
    const attrs = sim.ecs.get(sim.player, Attributes);
    const capped = stats.defense >= sim.content.player.armor.cap;
    const row = (glyph: string, value: string, title: string) =>
      this.tip(h('div', { class: 'c-stat' }, this.host.glyph(glyph, DIM), h('span', {}, value)), title);
    return h(
      'div',
      { class: 'c-stats' },
      row('attack', String(Math.round(stats.damage)), 'Attack: the damage of a light blow, before crits'),
      row(
        'armor',
        `${stats.armor} · ${Math.round(stats.defense * 100)}%${capped ? ' max' : ''}`,
        'Armor, and how much less damage you take',
      ),
      row('health', String(stats.maxHp), 'Max health'),
      row('stamina', String(stats.maxStamina), 'Max stamina'),
      row('level', attrs ? String(playerLevel(attrs)) : '1', 'Level: level up at a bonfire'),
      h(
        'button',
        { class: 'quiet', onclick: () => this.toggleDetails() },
        this.details ? 'Fewer' : 'Details',
      ),
      this.details ? this.statSheet(sim) : '',
    );
  }

  /** The flyout for the open slot (or tool belt quarter): everything owned for it, highest Power first. */
  private flyout(sim: Simulation): HTMLElement {
    const tool = this.toolFlyout;
    if (tool) {
      const tools = sim.ecs
        .need(sim.player, Inventory)
        .stacks.map((stack, index) => ({ stack, index }))
        .filter(({ stack }) => toolDef(sim, stack.item)?.kind === tool);
      const cells = tools.map(({ stack, index }) => {
        const on = this.hover?.from === 'pack' && this.hover.index === index;
        const cell = this.cell(sim, stack, null, () => this.host.act({ type: 'equip', index }));
        cell.classList.add('flyout-cell');
        if (on) cell.classList.add('selected', 'hovered');
        cell.onmouseenter = () => this.hoverPiece({ from: 'pack', index });
        return cell;
      });
      return h(
        'div',
        { class: 'c-flyout left' },
        h('div', { class: 'c-fly-head' }, tool === 'axe' ? 'Axes' : 'Pickaxes'),
        cells.length ? h('div', { class: 'grid' }, ...cells) : h('p', { class: 'hint' }, 'Craft one'),
      );
    }
    const slot = this.flyoutSlot;
    if (!slot) return h('div', {});
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
      if (on) cell.classList.add('selected', 'hovered');
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
    const side = slot === 'helmet' || slot === 'chest' || slot === 'legs' ? 'right' : 'left';
    return h(
      'div',
      { class: `c-flyout ${side}` },
      h('div', { class: 'c-fly-head' }, `${SLOT_LABELS[slot]}s`),
      tiles.length ? h('div', { class: 'grid' }, ...tiles) : h('p', { class: 'hint' }, 'Nothing else yet'),
    );
  }

  /** A tool's short card: what it gathers, how many swings it has left, and its numbers. */
  private toolCard(sim: Simulation): HTMLElement {
    const kind = this.toolFlyout;
    const hover = this.hover;
    const carried =
      hover?.from === 'pack' ? sim.ecs.need(sim.player, Inventory).stacks[hover.index] : undefined;
    const stack = carried ?? (kind ? beltOf(sim)[kind] : null);
    if (!stack)
      return h('p', { class: 'hint' }, kind === 'pick' ? 'No pickaxe on the belt' : 'No axe on the belt');
    const def = toolDef(sim, stack.item);
    if (!def) return h('div', {});
    const left = durabilityLeft(sim, stack);
    const pips = 10;
    const filled = Math.ceil((left / def.durability) * pips);
    return h(
      'div',
      { class: 'short-card tool-card' },
      h(
        'div',
        { class: 'title' },
        this.host.icon(stack.item),
        h('div', { class: 'name' }, itemName(sim.content.item(stack.item), 0)),
      ),
      h('div', { class: 'tierline' }, def.kind === 'axe' ? 'Axe: trees, mushrooms' : 'Pickaxe: rock'),
      h(
        'div',
        { class: 'c-pips', title: `${left} of ${def.durability} swings left` },
        ...Array.from({ length: pips }, (_, i) => h('span', { class: i < filled ? 'on' : '' })),
        h('b', {}, `${left}`),
      ),
      h(
        'ul',
        { class: 'perks' },
        def.bite > 0 ? h('li', {}, `+${def.bite} hit${def.bite === 1 ? '' : 's'} a swing`) : '',
        def.yield > 0 ? h('li', {}, `+${Math.round(def.yield * 100)}% materials`) : '',
      ),
      h('p', { class: 'hint' }, carried ? 'Click to put it on the belt' : 'On the belt'),
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
        : 'Click equip · right-click inspect · hold F dismantle';
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
        glyph: string,
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
            { class: good ? 'up' : 'down', title: CHANGE_NAMES[glyph] ?? glyph },
            this.host.glyph(glyph, DIM),
            `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))} ${good ? '▲' : '▼'}`,
          ),
        );
      };
      const whole = (n: number) => String(Math.round(n));
      const pct = (n: number) => `${Math.round(n * 100)}%`;
      delta('power', c.now.power, c.after.power, whole);
      if (kind === 'weapon') delta('attack', c.now.damage, c.after.damage, whole);
      else if (kind === 'ring') {
        delta('health', c.now.maxHp, c.after.maxHp, whole);
        delta('stamina', c.now.maxStamina, c.after.maxStamina, whole);
      } else delta('armor', 1 - c.now.defense, 1 - c.after.defense, pct, true);
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
    const rows = [
      this.tip(
        h(
          'div',
          { class: 'c-stat' },
          this.host.glyph('stamina', DIM),
          h('span', {}, `${Math.round(stats.staminaRegen * TICK_RATE)}/s`),
        ),
        'Stamina back per second',
      ),
      ...ATTRIBUTES.map((id) => {
        const own = attrs?.[id] ?? 0;
        const extra = stats.attributes[id] - own;
        return this.tip(
          h(
            'div',
            { class: 'c-stat' },
            this.host.glyph(ATTRIBUTE_GLYPHS[id], DIM),
            h('span', {}, String(stats.attributes[id])),
            extra > 0 ? h('span', { class: 'c-extra' }, `+${extra}`) : '',
          ),
          extra > 0 ? `${ATTRIBUTE_NAMES[id]}: ${own}, and ${extra} from gear` : ATTRIBUTE_NAMES[id],
        );
      }),
    ];
    return h('div', { class: 'stat-sheet' }, ...rows);
  }

  /**
   * The bag, in the character screen's look: how full it is on top, its fixed slots (the empty ones shown, so the
   * limit is plain) and the materials below, the hovered or selected item in the info column.
   */
  private bagTab(sim: Simulation): HTMLElement {
    const inv = sim.ecs.need(sim.player, Inventory);
    const size = sim.content.player.storage.bag;
    const used = pocketUsed(sim.content, inv, 'bag');
    const held = (pocket: Pocket) =>
      inv.stacks
        .map((stack, index) => ({ stack, index }))
        .filter(({ stack }) => pocketOf(sim.content, stack.item) === pocket)
        .map(({ stack, index }) => this.storeCell(sim, stack, { pack: index }, { from: 'pack', index }));
    const bag = held('bag');
    while (bag.length < size) bag.push(this.cell(sim, null, null, null));
    const materials = held('materials');

    const pips = h('div', { class: 'c-pips' });
    for (let i = 0; i < size; i++) pips.append(h('span', { class: i < used ? 'on' : '' }));
    const grids = h(
      'div',
      { class: 'c-store' },
      h('div', { class: 'c-fly-head' }, 'Bag'),
      h('div', { class: 'grid' }, ...bag),
      h('div', { class: 'c-fly-head' }, 'Materials'),
      materials.length ? h('div', { class: 'grid' }, ...materials) : h('p', { class: 'hint' }, 'None yet'),
    );
    grids.onmouseleave = () => this.unhover();

    const hovered = this.hover?.from === 'pack' ? inv.stacks[this.hover.index] : undefined;
    const index = this.selected && 'pack' in this.selected ? this.selected.pack : null;
    const picked = index === null ? undefined : inv.stacks[index];
    const info = hovered
      ? this.itemCard(sim, hovered)
      : index !== null && picked && !gearSlotOf(sim.content.item(picked.item))
        ? this.detail(sim, picked, index)
        : h('p', { class: 'hint' }, 'Click an item to use it or stash it.');

    return this.storeScreen(
      [
        this.tip(this.host.glyph('bag', EMBER), `Bag: ${size} slots for potions and other things you use`),
        h('span', { class: 'c-count' }, String(used), h('small', {}, `/${size}`)),
        pips,
        h('span', { class: 'c-gap' }),
        this.quickCell(sim),
      ],
      grids,
      info,
      [this.footKey(this.host.glyph('mouse_left', INK), 'inspect', 'Click: select')],
    );
  }

  /**
   * The Bag and Stash tabs share the character screen's frame: a top bar, the grid beside the info column, key hints
   * along the bottom.
   */
  private storeScreen(
    top: HTMLElement[],
    grids: HTMLElement,
    info: HTMLElement,
    keys: HTMLElement[],
  ): HTMLElement {
    return h(
      'div',
      { class: 'body character store' },
      h('div', { class: 'c-top' }, ...top),
      h('div', { class: 'c-main' }, grids, h('div', { class: 'c-info' }, info)),
      h('div', { class: 'c-footer' }, ...keys),
    );
  }

  /** A cell in the bag or stash: hovering shows it in the info column, clicking selects it. */
  private storeCell(sim: Simulation, stack: ItemStack, selection: Selection, piece: Piece): HTMLElement {
    const on = JSON.stringify(this.selected) === JSON.stringify(selection);
    const cell = this.cell(sim, stack, null, () => this.select(on ? null : selection));
    if (on) cell.classList.add('selected');
    if (this.hover?.from === piece.from && this.hover.index === piece.index) cell.classList.add('hovered');
    cell.onmouseenter = () => this.hoverStored(piece);
    if (gearSlotOf(sim.content.item(stack.item))) {
      cell.append(h('span', { class: 'power-badge' }, String(gearPower(stack))));
      if (this.aboveWorn(sim, stack))
        cell.append(h('span', { class: 'better', title: 'More Power than what you wear' }, '▲'));
    }
    return cell;
  }

  /** A short card for anything that isn't gear: what it is and what it does. */
  private itemCard(sim: Simulation, stack: ItemStack): HTMLElement {
    const def = sim.content.item(stack.item);
    return h(
      'div',
      { class: 'short-card' },
      h('div', { class: 'title' }, this.cell(sim, stack, null, null), this.gearName(sim, stack)),
      h('p', { class: 'hint' }, def.description),
      h('ul', { class: 'perks' }, ...facts(def).map((f) => h('li', {}, f))),
    );
  }

  /** The quick item (Q): shown on the character and bag screens, a click clears it. */
  private quickCell(sim: Simulation): HTMLElement {
    const quick = sim.ecs.need(sim.player, Equipment).quick;
    const count = quick ? countItem(sim.ecs.need(sim.player, Inventory), quick) : 0;
    const cell = this.cell(
      sim,
      quick ? { item: quick, count, level: 0 } : null,
      'Q',
      quick ? () => this.host.act({ type: 'setQuick', item: null }) : null,
    );
    cell.title = 'Quick item (Q): click to clear';
    return cell;
  }

  /** A key hint for the footer: the key (or mouse button) and its action's glyph, the words in hover text. */
  private footKey(input: string | HTMLElement, glyph: string, what: string): HTMLElement {
    return this.tip(
      h(
        'span',
        { class: 'c-key' },
        typeof input === 'string' ? h('b', {}, input) : input,
        this.host.glyph(glyph, DIM),
      ),
      what,
    );
  }

  private openSlot(slot: EquipSlot): void {
    if (this.flyoutSlot === slot) return;
    this.cancelDismantle();
    this.flyoutSlot = slot;
    this.toolFlyout = null;
    this.hover = null;
    this.refresh(true);
  }

  private openTool(kind: ToolKind): void {
    if (this.toolFlyout === kind) return;
    this.cancelDismantle();
    this.toolFlyout = kind;
    this.flyoutSlot = null;
    this.hover = null;
    this.refresh(true);
  }

  private closeFlyout(): void {
    if (!this.flyoutSlot && !this.toolFlyout && !this.hover) return;
    this.cancelDismantle();
    this.flyoutSlot = null;
    this.toolFlyout = null;
    this.hover = null;
    this.refresh(true);
  }

  private hoverPiece(piece: Piece): void {
    if (this.hover?.from === piece.from && this.hover.index === piece.index) return;
    this.cancelDismantle();
    this.hover = piece;
    this.selected = null;
    this.refresh(true);
  }

  /** Hovering in the bag or stash: the info column shows the piece, and a selection stays for when you move off. */
  private hoverStored(piece: Piece): void {
    if (this.hover?.from === piece.from && this.hover.index === piece.index) return;
    this.cancelDismantle();
    this.hover = piece;
    this.refresh(true);
  }

  private unhover(): void {
    if (!this.hover) return;
    this.cancelDismantle();
    this.hover = null;
    this.refresh(true);
  }

  private toggleDetails(): void {
    this.details = !this.details;
    this.refresh(true);
  }

  /** The hovered piece, as the smithy names it. */
  private hoveredTarget(): GearTarget | null {
    const hover = this.hover;
    if (!hover) return null;
    return hover.from === 'pack' ? { pack: hover.index } : { stash: hover.index };
  }

  /**
   * Holding F over a piece dismantles it once held for `HOLD_MS`; its tile fills meanwhile, and letting go (or moving
   * to another piece) before then calls it off.
   */
  private startDismantle(): boolean {
    const sim = this.host.sim();
    const target = this.hoveredTarget();
    if (!sim || !target || this.dismantling) return target !== null;
    const check = canSalvage(sim, target);
    const cell = this.el?.querySelector<HTMLElement>('.cell.hovered');
    if (!check.ok || !cell) return true;
    cell.style.setProperty('--hold', `${HOLD_MS}ms`);
    cell.classList.add('holding');
    this.dismantling = {
      cell,
      timer: window.setTimeout(() => {
        this.dismantling = null;
        cell.classList.remove('holding');
        this.host.act({ type: 'salvage', target });
      }, HOLD_MS),
    };
    return true;
  }

  private cancelDismantle(): void {
    if (!this.dismantling) return;
    window.clearTimeout(this.dismantling.timer);
    this.dismantling.cell.classList.remove('holding');
    this.dismantling = null;
  }

  /** A key let go on the character screen: F calls off a dismantle under way. */
  keyUp(code: string): void {
    if (code === 'KeyF') this.cancelDismantle();
  }

  /**
   * Keyboard on the character screen: the arrows move between slots (up and down a column, left and right across),
   * Enter equips the highest-Power piece for the open slot. True if it used the key.
   */
  key(code: string): boolean {
    if (!this.el) return false;
    if (this.tab === 'stash' && (code === 'KeyF' || code === 'KeyX' || code === 'KeyL'))
      return this.markKey(code);
    if (this.tab !== 'items') return false;
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
      case 'KeyF':
      case 'KeyX':
      case 'KeyL':
        return this.markKey(code);
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

  /** F dismantles the hovered piece (held), X marks it junk, L locks it; on the character screen and the stash. */
  private markKey(code: 'KeyF' | 'KeyX' | 'KeyL'): boolean {
    if (code === 'KeyF') return this.startDismantle();
    const sim = this.host.sim();
    const hover = this.hover;
    const target = this.hoveredTarget();
    if (!sim || !hover || !target) return false;
    const stack =
      hover.from === 'pack'
        ? sim.ecs.need(sim.player, Inventory).stacks[hover.index]
        : stashOf(sim)[hover.index];
    if (!stack || !gearSlotOf(sim.content.item(stack.item))) return false;
    const as = code === 'KeyX' ? 'junk' : 'lock';
    const on = as === 'junk' ? stack.junk : stack.locked;
    this.host.act({ type: 'mark', target, mark: on ? null : as });
    return true;
  }

  private select(selection: Selection | null): void {
    this.selected = selection;
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
          this.work(sim, { stash: index }, stack),
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

  /**
   * Everything kept at the bonfire, in the character screen's look: how full it is and whether it opens here on top,
   * filters by slot, the pieces best first, the hovered or selected one in the info column. Browse it anywhere; take
   * from it where it opens. Junk, lock and dismantle work on the hovered piece as they do in a flyout.
   */
  private stashTab(sim: Simulation): HTMLElement {
    const kept = stashOf(sim);
    const cap = stashCapacity(sim);
    const open = stashReachable(sim);
    const filter = this.stashFilter;
    const kindOf = (stack: ItemStack) => gearSlotOf(sim.content.item(stack.item)) ?? 'other';
    const shown = kept
      .map((stack, index) => ({ stack, index }))
      .filter(({ stack }) => filter === null || kindOf(stack) === filter)
      // Gear first, highest Power first; everything else after, in the order it was put away.
      .sort((x, y) => gearPower(y.stack) - gearPower(x.stack) || x.index - y.index)
      .map(({ stack, index }) => this.storeCell(sim, stack, { stash: index }, { from: 'stash', index }));

    const chip = (kind: StashFilter | null, glyph: HTMLElement, label: string) =>
      this.tip(
        h(
          'button',
          {
            class: `c-filter${filter === kind ? ' on' : ''}`,
            onclick: () => {
              this.stashFilter = kind;
              this.refresh(true);
            },
          },
          glyph,
        ),
        label,
      );
    const filters = h(
      'div',
      { class: 'c-filters' },
      chip(null, this.host.glyph('all', INK), 'Everything'),
      ...STASH_FILTERS.map(([kind, item, label]) => chip(kind, this.host.icon(item), label)),
      chip('other', this.host.glyph('bag', INK), 'Everything else'),
    );
    const grids = h(
      'div',
      { class: 'c-store' },
      filters,
      shown.length
        ? h('div', { class: 'grid' }, ...shown)
        : h('p', { class: 'hint' }, kept.length ? 'Nothing of that kind' : 'Empty'),
    );
    grids.onmouseleave = () => this.unhover();

    const hovered = this.hover?.from === 'stash' ? kept[this.hover.index] : undefined;
    const where = open ? 'Click to take it or equip it.' : `Browse only: ${STASH_CLOSED} to take from it.`;
    const index = this.selected && 'stash' in this.selected ? this.selected.stash : null;
    const picked = index === null ? undefined : kept[index];
    let info: HTMLElement = h('p', { class: 'hint' }, open ? 'Hover a piece to see it.' : where);
    if (hovered)
      info = gearSlotOf(sim.content.item(hovered.item))
        ? this.shortCard(sim, hovered, compareStack(sim, hovered), where)
        : this.itemCard(sim, hovered);
    else if (index !== null && picked) {
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
      const back = h('button', { class: 'quiet', onclick: () => this.select(null) }, 'Back');
      info = gearSlotOf(sim.content.item(picked.item))
        ? this.gearDetail(
            sim,
            picked,
            [
              back,
              h(
                'button',
                {
                  disabled: !open,
                  title: open ? '' : STASH_CLOSED,
                  onclick: () => this.host.act({ type: 'equipStash', index }),
                },
                'Equip',
              ),
              take,
            ],
            compareStack(sim, picked),
            this.work(sim, { stash: index }, picked),
          )
        : this.plainDetail(sim, picked, [back, take]);
    }

    const fill = h('span', { class: 'c-fill' });
    fill.style.setProperty('--full', String(Math.min(1, kept.length / Math.max(1, cap))));
    return this.storeScreen(
      [
        this.tip(this.host.glyph('stash', EMBER), 'Stash: kept at the bonfire, and counted in Max Power'),
        h('span', { class: 'c-count' }, String(kept.length), h('small', {}, `/${cap}`)),
        fill,
        this.tip(
          h(
            'span',
            { class: open ? 'c-open on' : 'c-open' },
            this.host.glyph(open ? 'stash' : 'lock', open ? EMBER : DIM),
            open ? 'Open' : 'Browse only',
          ),
          open
            ? 'Open here: take what you need.'
            : 'Rest at the village bonfire to take from it (at any bonfire, once the Storehouse is rebuilt). Full pockets send new gear here from anywhere.',
        ),
      ],
      grids,
      info,
      [
        this.footKey(this.host.glyph('mouse_left', INK), 'inspect', 'Click: select'),
        // The smithy reaches stashed pieces only where the stash opens.
        ...(open
          ? [
              this.footKey('X', 'junk', 'X: mark as junk'),
              this.footKey('L', 'lock', 'L: lock'),
              this.footKey('F', 'dismantle', 'Hold F: dismantle'),
            ]
          : []),
        h('span', { class: 'c-gap' }),
        this.packTools(sim),
      ],
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
    return gearWork(sim, target, stack, { act: (action) => this.host.act(action) });
  }

  /**
   * "Dismantle all junk", anywhere, with what it will give shown first; Noble pieces only when ticked for that run,
   * locked pieces and Legendaries never. Below it, auto-junk.
   */
  private packTools(sim: Simulation): HTMLElement {
    const preview = junkYield(sim, this.includeNoble);
    const gives = preview.materials.map((m) => `${m.count} ${sim.content.item(m.item).name}`).join(', ');
    const label = preview.pieces ? `Dismantle all junk: ${preview.pieces} → ${gives}` : 'Dismantle all junk';
    const includeNoble = this.includeNoble;
    return h(
      'div',
      { class: 'pack-tools' },
      holdButton(label, preview.pieces ? { ok: true } : { ok: false, reason: 'nothing marked' }, () => {
        this.host.act({ type: 'salvageJunk', includeNoble });
        this.includeNoble = false;
      }),
      h(
        'button',
        {
          class: this.includeNoble ? 'work toggle on' : 'work toggle',
          title: 'Locked pieces and Legendaries are never dismantled in bulk',
          onclick: () => {
            this.includeNoble = !this.includeNoble;
            this.refresh(true);
          },
        },
        `${this.includeNoble ? '☑' : '☐'} include Noble`,
      ),
      h(
        'button',
        {
          class: sim.state.autoJunk ? 'work toggle on' : 'work toggle',
          title: 'Marks Common and Standard pieces below your best for their slot as junk when picked up',
          onclick: () => this.host.act({ type: 'autoJunk', on: !sim.state.autoJunk }),
        },
        `${sim.state.autoJunk ? '☑' : '☐'} Auto-junk`,
      ),
    );
  }

  /** Whether a piece has more Power than the worn piece of its slot (the weaker ring, for rings). */
  private aboveWorn(sim: Simulation, stack: ItemStack): boolean {
    const eq = sim.ecs.need(sim.player, Equipment);
    const kind = gearSlotOf(sim.content.item(stack.item));
    if (!kind) return false;
    const worn = kind === 'ring' ? Math.min(gearPower(eq.ring0), gearPower(eq.ring1)) : gearPower(eq[kind]);
    return gearPower(stack) > worn;
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
      else if (stack.junk && this.aboveWorn(sim, stack))
        // Junk with more Power than what is worn is worth feeding into it before it is broken.
        cell.append(h('span', { class: 'mark fuel', title: 'Junk, but it could infuse what you wear' }, '⇪'));
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
        def.tool.kind === 'axe' ? 'Fells trees and mushrooms' : 'Breaks rock',
        ...(def.tool.bite > 0 ? [`+${def.tool.bite} ${def.tool.bite === 1 ? 'hit' : 'hits'} a swing`] : []),
        ...(def.tool.yield > 0 ? [`+${Math.round(def.tool.yield * 100)}% materials`] : []),
        `Lasts ${def.tool.durability} swings`,
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
