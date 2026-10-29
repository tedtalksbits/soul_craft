/**
 * The browser application: owns the current Simulation and wires it to the
 * renderer, audio, DOM UI and save system. Game rules never live here; this
 * layer only moves input in and events out.
 */
import type { Content } from '../content/content';
import { createSave, type SaveFile } from '../save/format';
import { IndexedDbStore } from '../save/indexeddb-store';
import { SaveManager, type SaveSlot } from '../save/save-manager';
import { SnapshotLibrary } from '../save/snapshot-library';
import type { KeyValueStore } from '../save/store';
import { Abilities, Player } from '../sim/components';
import { TICK_RATE } from '../sim/constants';
import type { SimEvent } from '../sim/events';
import { findInteraction } from '../sim/modules/interaction';
import { Simulation } from '../sim/simulation';
import type { Assets } from './assets';
import { Audio } from './audio';
import { InputCapture, isTyping } from './input';
import { FixedLoop } from './loop';
import type { GameRenderer } from './render/renderer';
import { iconElement } from './ui/icons';
import { InventoryScreen } from './ui/inventory';
import { Ui } from './ui/ui';

/** Autosave this often while playing, in addition to every bonfire rest. */
const AUTOSAVE_INTERVAL_TICKS = TICK_RATE * 120;
/** Delay from the death banner to the fade to black. */
const DEATH_FADE_MS = 2400;

export type SimListener = (sim: Simulation | null) => void;

export class App {
  sim: Simulation | null = null;
  /** The save slot the current game writes to; null for scratch games (scenarios, snapshots). */
  slot: SaveSlot | null = null;
  readonly saves: SaveManager;
  readonly snapshots: SnapshotLibrary;
  readonly input: InputCapture;
  readonly loop: FixedLoop;
  readonly ui: Ui;
  readonly inventory: InventoryScreen;
  readonly audio = new Audio();
  /** Extra reasons to hold input, e.g. the dev console having focus. */
  readonly inputHolds = new Set<string>();
  private readonly simListeners = new Set<SimListener>();
  private readonly eventListeners = new Set<(events: readonly SimEvent[]) => void>();
  private readonly frameListeners = new Set<(dtMs: number) => void>();
  private lastSaveTick = 0;
  private titleFooter = '';

  constructor(
    public content: Content,
    readonly assets: Assets,
    readonly renderer: GameRenderer,
    uiRoot: HTMLElement,
    store: KeyValueStore = new IndexedDbStore(),
  ) {
    this.saves = new SaveManager(store);
    this.snapshots = new SnapshotLibrary(store);
    this.ui = new Ui(uiRoot);
    this.input = new InputCapture(renderer.canvas, (x, y) => renderer.toWorld(x, y));
    this.inventory = new InventoryScreen(uiRoot, {
      sim: () => this.sim,
      icon: (item) => this.itemIcon(item),
      act: (action) => this.input.queueAction(action),
    });
    this.loop = new FixedLoop(
      () => this.tick(),
      (dt) => this.frame(dt),
    );
    // Capture phase, so an open inventory takes Escape before the pause menu sees it.
    addEventListener(
      'keydown',
      (e) => {
        if (e.repeat || isTyping(e)) return;
        if (this.inventory.isOpen && ['Escape', 'Tab', 'KeyI'].includes(e.code)) {
          e.preventDefault();
          this.inventory.close();
        } else if (
          (e.code === 'Tab' || e.code === 'KeyI') &&
          this.sim &&
          !this.ui.blocking &&
          this.inputHolds.size === 0
        ) {
          e.preventDefault();
          this.inventory.open('items');
        }
      },
      { capture: true },
    );
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !e.defaultPrevented) this.togglePause();
    });
    addEventListener('pointerdown', () => this.audio.unlock());
    addEventListener('keydown', () => this.audio.unlock());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.save();
    });
  }

  start(): void {
    this.loop.start();
  }

  // ------------------------------------------------------------------ observers (dev tools)

  onSimChange(fn: SimListener): () => void {
    this.simListeners.add(fn);
    return () => this.simListeners.delete(fn);
  }

  onEvents(fn: (events: readonly SimEvent[]) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** Called every rendered frame, after the scene is updated and before it is drawn. */
  onFrame(fn: (dtMs: number) => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  /** An item's icon from the items sheet, as a DOM element. */
  itemIcon(item: string, scale = 2): HTMLElement {
    const def = this.content.items[item];
    return iconElement(def ? this.assets.sheet('items')?.frameRect(def.icon) : undefined, scale);
  }

  setTitleFooter(text: string): void {
    this.titleFooter = text;
  }

  // ------------------------------------------------------------------ game lifecycle

  async showTitle(): Promise<void> {
    this.setSim(null, null);
    const slots = await this.saves.list();
    this.ui.showTitle(
      slots,
      {
        newGame: (slot) => this.chooseClassFor(slot),
        continueGame: (slot) => void this.continueSlot(slot),
        deleteSlot: (slot) => void this.saves.delete(slot).then(() => this.showTitle()),
      },
      this.titleFooter,
    );
  }

  /** The new-game class screen; picking a class starts the game in `slot`. */
  private chooseClassFor(slot: SaveSlot): void {
    this.ui.showClasses({
      content: this.content,
      current: null,
      mode: 'newGame',
      pick: (cls) => void this.newGame(slot, randomSeed(), cls).then(() => this.save()),
      cancel: () => void this.showTitle(),
    });
  }

  /** The bonfire's class screen. The change goes to the sim as a `setClass` action. */
  private changeClass(): void {
    const sim = this.sim;
    if (!sim) return;
    this.ui.showClasses({
      content: this.content,
      current: sim.ecs.get(sim.player, Abilities)?.class ?? null,
      mode: 'bonfire',
      pick: (cls) => {
        this.input.queueAction({ type: 'setClass', class: cls });
        this.ui.hideScreen();
      },
      cancel: () => this.ui.hideScreen(),
    });
  }

  newGame(slot: SaveSlot | null, seed: number = randomSeed(), playerClass?: string): Promise<Simulation> {
    const sim = Simulation.create({ seed, content: this.content, ...(playerClass ? { playerClass } : {}) });
    this.setSim(sim, slot);
    return Promise.resolve(sim);
  }

  async continueSlot(slot: SaveSlot): Promise<void> {
    try {
      const loaded = await this.saves.load(slot);
      if (!loaded) {
        this.ui.toast(`Slot ${slot} is empty.`);
        return;
      }
      this.loadSave(loaded.save, slot);
      if (loaded.fromBackup) this.ui.toast('The latest save was damaged; restored the previous one.', 4000);
    } catch (err) {
      this.ui.toast(`Could not load slot ${slot}: ${err instanceof Error ? err.message : String(err)}`, 5000);
    }
  }

  /** Replaces the running game with a saved one. Pass a slot to keep saving there. */
  loadSave(file: SaveFile, slot: SaveSlot | null): void {
    this.setSim(Simulation.restore(file.snapshot, this.content), slot);
  }

  async save(): Promise<boolean> {
    const { sim, slot } = this;
    if (!sim || !slot) return false;
    if (sim.ecs.get(sim.player, Player)?.state === 'dead') return false;
    await this.saves.save(slot, createSave(sim, slot));
    this.lastSaveTick = sim.tick;
    return true;
  }

  async quitToTitle(): Promise<void> {
    await this.save();
    await this.showTitle();
  }

  /** Hot-swaps validated content into the running game. */
  setContent(content: Content): void {
    this.content = content;
    this.sim?.setContent(content);
  }

  private setSim(sim: Simulation | null, slot: SaveSlot | null): void {
    this.sim = sim;
    this.slot = slot;
    this.lastSaveTick = sim?.tick ?? 0;
    this.input.reset();
    this.inventory.close();
    this.ui.hideScreen();
    this.ui.resetHud();
    this.renderer.attach(sim);
    for (const fn of this.simListeners) fn(sim);
  }

  private togglePause(): void {
    if (this.ui.cancelScreen()) return;
    if (!this.sim || this.ui.screen === 'title') return;
    if (this.ui.screen === 'pause') {
      this.ui.hideScreen();
      return;
    }
    this.ui.closeDialog();
    this.ui.showPause({
      resume: () => this.ui.hideScreen(),
      saveAndQuit: () => void this.quitToTitle(),
    });
  }

  // ------------------------------------------------------------------ per tick / frame

  private tick(): void {
    const sim = this.sim;
    // The inventory holds game input but not the game: the world keeps moving around an open pack.
    if (this.inventory.isOpen) this.inputHolds.add('menu');
    else this.inputHolds.delete('menu');
    this.input.enabled = !this.ui.blocking && this.inputHolds.size === 0;
    if (!sim || this.ui.blocking) return;
    sim.step(this.input.consume());
    const events = sim.events.drain();
    if (events.length > 0) {
      this.renderer.handle(events);
      for (const e of events) {
        this.audio.handle(e);
        this.react(e);
      }
      this.toastGains(events);
      for (const fn of this.eventListeners) fn(events);
    }
    this.inventory.refresh();
    if (this.slot && sim.tick - this.lastSaveTick >= AUTOSAVE_INTERVAL_TICKS) void this.save();
  }

  private react(e: SimEvent): void {
    switch (e.type) {
      case 'read':
        return this.ui.dialog(e.lines);
      case 'bonfireLit':
        return this.ui.banner('BONFIRE LIT', 'good');
      case 'rested':
        void this.save().then((saved) => saved && this.ui.toast(`Rested at ${e.name}. Progress saved.`));
        return;
      case 'flaskEmpty':
        return this.ui.toast('The flask is empty. Rest at a bonfire.');
      case 'classChanged': {
        const name = this.content.playerClass(e.class).name;
        return this.ui.toast(`You are now ${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}.`);
      }
      case 'stationOpened':
        return this.inventory.open('craft', e.station);
      case 'crafted': {
        const name = this.content.item(e.item).name;
        return this.ui.toast(e.count > 1 ? `Crafted ${name} ×${e.count}` : `Crafted ${name}`);
      }
      case 'craftFailed':
        return this.ui.toast(`Cannot craft: ${e.reason}`);
      case 'upgraded':
        return this.ui.banner(`${this.content.item(e.item).name.toUpperCase()} +${e.level}`, 'good');
      case 'inventoryFull':
        return this.ui.toast(`No room for ${this.content.item(e.item).name}`);
      case 'buffStarted':
        return this.ui.toast(`${this.content.item(e.item).name}: ${e.seconds}s`);
      case 'playerDied':
        this.inventory.close();
        this.ui.banner('YOU DIED', 'death');
        window.setTimeout(() => this.ui.fade(true), DEATH_FADE_MS);
        return;
      case 'playerRespawned':
        return this.ui.fade(false);
      case 'areaEntered':
        if (e.firstVisit) this.ui.area(e.name);
        return;
      default:
        return;
    }
  }

  /** One toast for everything picked up this tick, so a burst of drops reads as one line. */
  private toastGains(events: readonly SimEvent[]): void {
    const parts = events.flatMap((e) =>
      e.type === 'itemGained' ? [`+${e.count} ${this.content.item(e.item).name}`] : [],
    );
    if (parts.length > 0) this.ui.toast(parts.join(', '), 1800);
  }

  private frame(dtMs: number): void {
    const sim = this.sim;
    const free = sim !== null && !this.ui.blocking && !this.inventory.isOpen;
    if (sim && free) {
      const target = findInteraction(sim);
      this.ui.prompt(target ? target.label : null, 'E');
    } else this.ui.prompt(null);
    const resting = free && sim.ecs.get(sim.player, Player)?.state === 'sit';
    this.ui.restMenu(resting, () => this.changeClass());
    this.renderer.render(dtMs, () => {
      for (const fn of this.frameListeners) fn(dtMs);
    });
  }
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}
