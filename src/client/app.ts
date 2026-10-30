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
import { Body, Abilities, Player } from '../sim/components';
import { TICK_RATE, TILE } from '../sim/constants';
import type { SimEvent } from '../sim/events';
import { findInteraction } from '../sim/modules/interaction';
import { Simulation } from '../sim/simulation';
import type { Assets } from './assets';
import { Audio } from './audio';
import { InputCapture, isTyping } from './input';
import { primaryKey } from './keybinds';
import { compassDirection } from './ui/travel';
import { SettingsStore } from './settings';
import { Tutorial } from './tutorial';
import { FixedLoop } from './loop';
import type { GameRenderer } from './render/renderer';
import { iconElement, tintedIcon } from './ui/icons';
import { InventoryScreen } from './ui/inventory';
import { LevelScreen } from './ui/level';
import { Ui, type ClassLabel } from './ui/ui';

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
  readonly level: LevelScreen;
  readonly audio = new Audio();
  /** Per-device settings: controls, display, audio, tutorial hints. */
  readonly settings = new SettingsStore();
  private readonly tutorial: Tutorial;
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
      bindings: () => this.input.bindings,
      sigil: (cls) => this.sigilIcon(cls, 2),
      abilityIcon: (ability) => this.abilityIcon(ability, 2),
    });
    this.level = new LevelScreen(uiRoot, {
      sim: () => this.sim,
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
        const pack = this.input.bindings.inventory.includes(e.code);
        if (this.level.isOpen && e.code === 'Escape') {
          e.preventDefault();
          this.level.close();
        } else if (this.inventory.isOpen && (e.code === 'Escape' || pack)) {
          e.preventDefault();
          this.inventory.close();
        } else if (pack && this.sim && !this.ui.blocking && this.inputHolds.size === 0) {
          e.preventDefault();
          this.ui.clearHint();
          this.inventory.open('items');
        }
      },
      { capture: true },
    );
    addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !e.defaultPrevented) this.togglePause();
    });
    this.tutorial = new Tutorial(this.settings, this.ui, (ability) => this.abilityIcon(ability, 2));
    this.settings.watch((s) => {
      this.input.bindings = s.bindings;
      this.ui.bindings = s.bindings;
      this.renderer.hud.bindings = s.bindings;
      this.audio.setVolume(s.volume);
      this.audio.muted = s.muted;
      this.renderer.setFill(s.fill);
    });
    document.addEventListener('fullscreenchange', () => this.ui.refreshSettings());
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
  /** A class's sigil, tinted with its element. */
  sigilIcon(cls: string, scale = 2): HTMLElement {
    const def = this.content.classes[cls];
    return tintedIcon(this.assets.sheet('sigils')?.frameRect(cls), def?.element.base ?? '#ffffff', scale);
  }

  /** An ability's icon, tinted with its class's element. */
  abilityIcon(ability: string, scale = 2): HTMLElement {
    const cls = Object.values(this.content.classes).find((c) => Object.values(c.abilities).includes(ability));
    return tintedIcon(
      this.assets.sheet('abilities')?.frameRect(ability),
      cls?.element.base ?? '#ffffff',
      scale,
    );
  }

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
        settings: () => this.openSettings(() => void this.showTitle()),
        classLabel: (id) => this.classLabel(id),
      },
      this.titleFooter,
    );
  }

  /** How menus name a class; null for one the content no longer has. */
  private classLabel(id: string): ClassLabel | null {
    const cls = this.content.classes[id];
    return cls
      ? {
          name: cls.name,
          element: cls.element.name,
          color: cls.element.light,
          sigil: () => this.sigilIcon(id, 1),
        }
      : null;
  }

  /** The class the running game is playing, as menus show it. */
  private currentClassLabel(): ClassLabel | null {
    const sim = this.sim;
    const id = sim ? sim.ecs.get(sim.player, Abilities)?.class : undefined;
    return id ? this.classLabel(id) : null;
  }

  /** The new-game class screen; picking a class starts the game in `slot`. */
  private chooseClassFor(slot: SaveSlot): void {
    this.ui.showClasses({
      content: this.content,
      current: null,
      mode: 'newGame',
      unlocked: { ...this.content.player.start.unlocked },
      bindings: this.input.bindings,
      sigil: (cls) => this.sigilIcon(cls, 3),
      abilityIcon: (ability) => this.abilityIcon(ability, 2),
      pick: (cls) => void this.newGame(slot, randomSeed(), cls).then(() => this.save()),
      cancel: () => void this.showTitle(),
    });
  }

  /** The bonfire travel screen: every lit bonfire, nearest first. */
  private openTravel(): void {
    const sim = this.sim;
    const pb = sim?.ecs.get(sim.player, Body);
    if (!sim || !pb) return;
    const here = sim.state.checkpoint?.id;
    const destinations = Object.entries(sim.state.bonfires)
      .map(([id, b]) => {
        const tx = Math.floor(b.x / TILE);
        const ty = Math.floor(b.y / TILE);
        const area =
          sim.world.areaAt(b.x, b.y)?.name ?? sim.content.biomes[sim.world.gen.biomeAt(tx, ty)]?.name ?? '';
        const dx = b.x - pb.x;
        const dy = b.y - pb.y;
        return {
          id,
          name: b.name,
          area,
          paces: Math.round(Math.hypot(dx, dy) / TILE),
          direction: compassDirection(dx, dy),
          here: id === here,
        };
      })
      .sort((a, b) => Number(b.here) - Number(a.here) || a.paces - b.paces);
    this.ui.showTravel({
      destinations,
      travel: (id) => {
        this.ui.hideScreen();
        this.ui.fade(true);
        this.input.queueAction({ type: 'travel', bonfire: id });
      },
      cancel: () => this.ui.hideScreen(),
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
      unlocked: { ...(sim.ecs.get(sim.player, Abilities)?.unlocked ?? this.content.player.start.unlocked) },
      bindings: this.input.bindings,
      sigil: (cls) => this.sigilIcon(cls, 3),
      abilityIcon: (ability) => this.abilityIcon(ability, 2),
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
    this.level.close();
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
    this.showPauseMenu();
  }

  private showPauseMenu(): void {
    this.ui.showPause(
      {
        resume: () => this.ui.hideScreen(),
        settings: () => this.openSettings(() => this.showPauseMenu()),
        saveAndQuit: () => void this.quitToTitle(),
      },
      this.currentClassLabel(),
    );
  }

  /** The settings screen; `back` reopens whatever it was opened from. */
  private openSettings(back: () => void): void {
    this.ui.showSettings({
      settings: () => this.settings.current,
      change: (update) => this.settings.update(update),
      isFullscreen: () => document.fullscreenElement !== null,
      toggleFullscreen: () => {
        const done = document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen();
        void done
          .catch(() => this.ui.toast('Full screen is not available here.'))
          .finally(() => this.ui.refreshSettings());
      },
      back,
    });
  }

  // ------------------------------------------------------------------ per tick / frame

  private tick(): void {
    const sim = this.sim;
    // The inventory and level screen hold game input but not the game: the world keeps moving.
    if (this.inventory.isOpen || this.level.isOpen) this.inputHolds.add('menu');
    else this.inputHolds.delete('menu');
    this.input.enabled = !this.ui.blocking && this.inputHolds.size === 0;
    if (!sim || this.ui.blocking) return;
    sim.step(this.input.consume());
    const events = sim.events.drain();
    if (events.length > 0) {
      this.renderer.handle(events);
      // Pickup toasts first, so a message about something bigger (a new power) in the same tick wins.
      this.toastGains(events);
      for (const e of events) {
        this.audio.handle(e);
        this.react(e);
      }
      for (const fn of this.eventListeners) fn(events);
    }
    this.inventory.refresh();
    this.level.refresh();
    // Hints wait while a menu is open; they would cover it.
    if (!this.inventory.isOpen && !this.level.isOpen) this.tutorial.update(sim);
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
      case 'abilityUnlocked': {
        const name = this.content.ability(e.ability).name;
        const binding = e.slot === 'class' ? 'classAbility' : 'super';
        this.ui.banner('NEW POWER', 'good');
        return this.ui.toast(`${name} awakened. Press ${primaryKey(this.input.bindings, binding)}.`, 4000);
      }
      case 'abilityLocked':
        return this.ui.toast(
          `Not yet awakened. Open the pack (${primaryKey(this.input.bindings, 'inventory')}), then Abilities.`,
        );
      case 'leveledUp': {
        const name = `${e.attribute.charAt(0).toUpperCase()}${e.attribute.slice(1)}`;
        return this.ui.toast(`${name} raised. You are level ${e.level}.`);
      }
      case 'traveled':
        // The screen faded out when the trip was chosen; fade back in on arrival.
        window.setTimeout(() => this.ui.fade(false), 250);
        return;
      case 'classChanged': {
        const cls = this.content.playerClass(e.class);
        const article = /^[aeiou]/i.test(cls.name) ? 'an' : 'a';
        return this.ui.toast(
          `You are now ${article} ${cls.name}, of the ${cls.element.name}.`,
          3200,
          cls.element.light,
        );
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
        this.level.close();
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
    const free = sim !== null && !this.ui.blocking && !this.inventory.isOpen && !this.level.isOpen;
    if (sim && free) {
      const target = findInteraction(sim);
      this.ui.prompt(target ? target.label : null, primaryKey(this.input.bindings, 'use'));
    } else this.ui.prompt(null);
    const resting = free && sim.ecs.get(sim.player, Player)?.state === 'sit';
    this.ui.restMenu(resting ? this.currentClassLabel() : null, {
      travel: () => this.openTravel(),
      levelUp: () => this.level.open(),
      changeClass: () => this.changeClass(),
    });
    this.renderer.render(dtMs, () => {
      for (const fn of this.frameListeners) fn(dtMs);
    });
  }
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}
