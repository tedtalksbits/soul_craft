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
import { Player } from '../sim/components';
import { TICK_RATE } from '../sim/constants';
import type { SimEvent } from '../sim/events';
import { findInteraction } from '../sim/modules/interaction';
import { Simulation } from '../sim/simulation';
import type { Assets } from './assets';
import { Audio } from './audio';
import { InputCapture } from './input';
import { FixedLoop } from './loop';
import type { GameRenderer } from './render/renderer';
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
    this.loop = new FixedLoop(
      () => this.tick(),
      (dt) => this.frame(dt),
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
        newGame: (slot) => {
          void this.newGame(slot).then(() => this.save());
        },
        continueGame: (slot) => void this.continueSlot(slot),
        deleteSlot: (slot) => void this.saves.delete(slot).then(() => this.showTitle()),
      },
      this.titleFooter,
    );
  }

  newGame(slot: SaveSlot | null, seed: number = randomSeed()): Promise<Simulation> {
    const sim = Simulation.create({ seed, content: this.content });
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
    this.ui.hideScreen();
    this.ui.resetHud();
    this.renderer.attach(sim);
    for (const fn of this.simListeners) fn(sim);
  }

  private togglePause(): void {
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
      for (const fn of this.eventListeners) fn(events);
    }
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
      case 'playerDied':
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

  private frame(dtMs: number): void {
    const sim = this.sim;
    if (sim && !this.ui.blocking) {
      const target = findInteraction(sim);
      this.ui.prompt(target ? `E: ${target.label}` : null);
    } else this.ui.prompt(null);
    this.renderer.render(dtMs, () => {
      for (const fn of this.frameListeners) fn(dtMs);
    });
  }
}

export function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] ?? 1;
}
