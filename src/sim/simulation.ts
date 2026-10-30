/**
 * The deterministic game simulation.
 *
 * Given the same content, seed and sequence of InputFrames it produces the
 * same world, tick for tick. It knows nothing about rendering, audio or the
 * DOM: it consumes input frames and emits SimEvents. That boundary is what
 * lets us run it headless in tests, replay bugs from snapshots and, later,
 * run it on a server for co-op.
 */
import type { Content } from '../content/content';
import { World, type EcsSnapshot, type Entity } from '../core/ecs';
import { EventQueue } from '../core/event-queue';
import { Rng, type RngState } from '../core/rng';
import { Enemy, Player } from './components';
import type { SimEvent } from './events';
import { NO_INPUT, type InputFrame } from './input';
import { PHASES, type SimCommand, type SimModule, type System } from './module';
import { SIM_MODULES } from './modules';
import { spawnPlayer } from './modules/player';
import { updateStreaming } from './modules/streaming';
import { kindleOrigin } from './modules/travel';
import { initialState, type SimState } from './state';
import { ChunkWorld } from './world/chunk-world';

export const SNAPSHOT_VERSION = 1;

export interface SimSnapshot {
  version: number;
  tick: number;
  hitstop: number;
  carriedPresses: number;
  rng: RngState;
  state: SimState;
  ecs: EcsSnapshot;
  loadedChunks: string[];
}

export class Simulation {
  /** Number of ticks stepped since the world was created. Doubles as play time. */
  tick: number;
  /** Ticks left to freeze for hit impact. Input presses during a freeze are carried over. */
  hitstop: number;
  input: InputFrame = NO_INPUT;
  readonly events = new EventQueue<SimEvent>();
  readonly world: ChunkWorld;
  readonly modules: readonly SimModule[];
  private readonly systems: readonly System[];
  private carriedPresses: number;

  private constructor(
    public content: Content,
    readonly state: SimState,
    readonly ecs: World,
    public rng: Rng,
    opts: { tick: number; hitstop: number; carriedPresses: number; modules: readonly SimModule[] },
  ) {
    this.tick = opts.tick;
    this.hitstop = opts.hitstop;
    this.carriedPresses = opts.carriedPresses;
    this.modules = opts.modules;
    this.systems = PHASES.flatMap((phase) =>
      opts.modules.flatMap((m) => (m.systems ?? []).filter((s) => s.phase === phase).map((s) => s.run)),
    );
    this.world = new ChunkWorld(state, content);
  }

  /** A new game. `playerClass` defaults to the content's start class. */
  static create(opts: {
    seed: number;
    content: Content;
    playerClass?: string;
    modules?: readonly SimModule[];
  }): Simulation {
    const seed = opts.seed >>> 0;
    const sim = new Simulation(opts.content, initialState(seed), new World(), new Rng(seed), {
      tick: 0,
      hitstop: 0,
      carriedPresses: 0,
      modules: opts.modules ?? SIM_MODULES,
    });
    const spawn = sim.world.gen.originSpawn();
    spawnPlayer(sim, spawn.x, spawn.y, opts.playerClass);
    updateStreaming(sim);
    kindleOrigin(sim);
    sim.ecs.flush();
    return sim;
  }

  static restore(
    snapshot: SimSnapshot,
    content: Content,
    modules: readonly SimModule[] = SIM_MODULES,
  ): Simulation {
    if (snapshot.version !== SNAPSHOT_VERSION) {
      throw new Error(`Snapshot version ${snapshot.version} is not supported (expected ${SNAPSHOT_VERSION})`);
    }
    const sim = new Simulation(
      content,
      structuredClone(snapshot.state),
      World.fromSnapshot(snapshot.ecs),
      new Rng(snapshot.rng),
      { tick: snapshot.tick, hitstop: snapshot.hitstop, carriedPresses: snapshot.carriedPresses, modules },
    );
    for (const key of snapshot.loadedChunks) {
      const [cx, cy] = key.split(',').map(Number);
      if (cx !== undefined && cy !== undefined) sim.world.load(cx, cy);
    }
    // Content may have changed since the snapshot was taken; drop what it no longer defines.
    for (const [e, enemy] of sim.ecs.query(Enemy))
      if (!(enemy.archetype in content.enemies)) sim.ecs.destroy(e);
    sim.ecs.flush();
    if (sim.ecs.first(Player) === undefined) throw new Error('Snapshot has no player');
    return sim;
  }

  get player(): Entity {
    const e = this.ecs.first(Player);
    if (e === undefined) throw new Error('The player entity is missing');
    return e;
  }

  get commands(): SimCommand[] {
    return this.modules.flatMap((m) => m.commands ?? []);
  }

  step(input: InputFrame): void {
    this.tick++;
    if (this.hitstop > 0) {
      this.hitstop--;
      this.carriedPresses |= input.pressed;
      return;
    }
    this.input = this.carriedPresses ? { ...input, pressed: input.pressed | this.carriedPresses } : input;
    this.carriedPresses = 0;
    for (const system of this.systems) system(this);
    this.ecs.flush();
  }

  /** Swaps in hot-reloaded content. Loaded chunks are regenerated; entities keep their state. */
  setContent(content: Content): void {
    this.content = content;
    this.world.setContent(content);
  }

  snapshot(): SimSnapshot {
    return {
      version: SNAPSHOT_VERSION,
      tick: this.tick,
      hitstop: this.hitstop,
      carriedPresses: this.carriedPresses,
      rng: this.rng.state(),
      state: structuredClone(this.state),
      ecs: this.ecs.snapshot(),
      loadedChunks: this.world.loadedKeys,
    };
  }
}
