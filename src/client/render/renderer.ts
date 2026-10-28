/**
 * Owns the Pixi application and the layer stack:
 *
 *   world (camera space): chunks -> entities -> effects -> debug
 *   lighting (screen space)
 *   debug (screen space) -> hud
 *
 * The game renders at a fixed low resolution and is scaled up with nearest
 * neighbour filtering, so every pixel stays crisp.
 */
import { Application, Container, TextureStyle } from 'pixi.js';
import { Body } from '../../sim/components';
import { TILE } from '../../sim/constants';
import type { SimEvent } from '../../sim/events';
import type { Simulation } from '../../sim/simulation';
import type { Assets } from '../assets';
import { ChunkLayer } from './chunk-layer';
import { Effects } from './effects';
import { EntityLayer } from './entity-layer';
import { Hud } from './hud';
import { Lighting } from './lighting';

export const VIEW_W = 384;
export const VIEW_H = 216;
/** Camera follow factor per 60Hz frame. */
const CAMERA_LERP = 0.12;

export class GameRenderer {
  readonly world = new Container();
  /** World-space container for debug overlays. */
  readonly debugWorld = new Container();
  /** Screen-space container for debug overlays. */
  readonly debugScreen = new Container();
  readonly camera = { x: 0, y: 0 };
  readonly chunks: ChunkLayer;
  readonly entities: EntityLayer;
  readonly effects: Effects;
  readonly hud: Hud;
  private readonly lighting = new Lighting(VIEW_W, VIEW_H);
  private sim: Simulation | null = null;

  private constructor(
    readonly app: Application,
    private readonly wrap: HTMLElement,
    assets: Assets,
  ) {
    this.chunks = new ChunkLayer(assets);
    this.entities = new EntityLayer(assets);
    this.effects = new Effects(assets);
    this.hud = new Hud(assets, VIEW_W, VIEW_H);
    this.world.addChild(this.chunks.root, this.entities.root, this.effects.root, this.debugWorld);
    app.stage.addChild(this.world, this.lighting.root, this.debugScreen, this.hud.root);
    addEventListener('resize', () => this.resize());
    this.resize();
  }

  static async create(wrap: HTMLElement, stage: HTMLElement, assets: Assets): Promise<GameRenderer> {
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    const app = new Application();
    await app.init({
      width: VIEW_W,
      height: VIEW_H,
      resolution: 1,
      antialias: false,
      roundPixels: true,
      background: '#000000',
      autoStart: false,
    });
    stage.appendChild(app.canvas);
    return new GameRenderer(app, wrap, assets);
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  /** Switch to a different simulation (new game, load, snapshot restore) or none. */
  attach(sim: Simulation | null): void {
    this.sim = sim;
    this.chunks.clear();
    this.entities.clear();
    this.effects.clear();
    this.hud.reset();
    this.world.visible = sim !== null;
    this.hud.root.visible = sim !== null;
    this.lighting.root.visible = sim !== null;
    if (sim) this.snapCamera(sim);
  }

  handle(events: readonly SimEvent[]): void {
    for (const e of events) {
      this.entities.handle(e);
      this.effects.handle(e);
      if (this.sim && (e.type === 'healed' || e.type === 'rested'))
        this.effects.aroundPlayer(this.sim, e.type === 'healed' ? 'heal' : 'rest');
    }
  }

  /** Updates every layer, runs `beforeDraw` (debug overlays), then draws. */
  render(dtMs: number, beforeDraw?: () => void): void {
    const sim = this.sim;
    if (sim) {
      const pb = sim.ecs.get(sim.player, Body);
      if (pb) {
        const k = 1 - Math.pow(1 - CAMERA_LERP, dtMs / (1000 / 60));
        this.camera.x += (pb.x - VIEW_W / 2 - this.camera.x) * k;
        this.camera.y += (pb.y - VIEW_H / 2 - this.camera.y) * k;
      }
      const shake = this.effects.shake;
      const cam = {
        x: Math.round(this.camera.x + (Math.random() - 0.5) * shake),
        y: Math.round(this.camera.y + (Math.random() - 0.5) * shake),
      };
      this.world.position.set(-cam.x, -cam.y);

      this.chunks.sync(sim);
      this.entities.sync(sim, dtMs);
      const biome = pb
        ? sim.content.biomes[sim.world.gen.biomeAt(Math.floor(pb.x / TILE), Math.floor(pb.y / TILE))]
        : undefined;
      this.effects.update(sim, dtMs, { ...cam, w: VIEW_W, h: VIEW_H }, biome);
      const area = pb ? sim.world.areaAt(pb.x, pb.y) : undefined;
      this.lighting.update(
        this.app.renderer,
        sim,
        cam,
        area?.darkness ?? biome?.darkness ?? 0,
        this.effects.hurtFlash,
      );
      this.hud.update(sim, dtMs);
    }
    beforeDraw?.();
    this.app.render();
  }

  /** Converts a mouse position to world pixels. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * VIEW_W + this.camera.x,
      y: ((clientY - rect.top) / rect.height) * VIEW_H + this.camera.y,
    };
  }

  private snapCamera(sim: Simulation): void {
    const pb = sim.ecs.get(sim.player, Body);
    if (!pb) return;
    this.camera.x = pb.x - VIEW_W / 2;
    this.camera.y = pb.y - VIEW_H / 2;
  }

  private resize(): void {
    const fit = Math.min(innerWidth / VIEW_W, innerHeight / VIEW_H);
    const scale = fit >= 2 ? Math.floor(fit) : fit;
    const w = Math.floor(VIEW_W * scale);
    const h = Math.floor(VIEW_H * scale);
    this.wrap.style.width = `${w}px`;
    this.wrap.style.height = `${h}px`;
    this.wrap.style.fontSize = `${Math.max(11, h / 34)}px`;
  }
}
