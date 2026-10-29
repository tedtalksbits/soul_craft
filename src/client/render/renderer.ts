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
import { AbilityFx } from './ability-fx';
import { Hud } from './hud';
import { VIEW_H, VIEW_W, viewFor } from './view-size';
import { Lighting } from './lighting';

export { VIEW_H, VIEW_W } from './view-size';
/** Camera follow factor per 60Hz frame. */
const CAMERA_LERP = 0.12;

export class GameRenderer {
  readonly world = new Container();
  /** World-space container for debug overlays. */
  readonly debugWorld = new Container();
  /** Screen-space container for debug overlays. */
  readonly debugScreen = new Container();
  readonly camera = { x: 0, y: 0 };
  /** The view in world pixels (game pixels) right now. Fill mode changes it with the window. */
  readonly view = { w: VIEW_W, h: VIEW_H };
  private fill = false;
  readonly chunks: ChunkLayer;
  readonly entities: EntityLayer;
  readonly effects: Effects;
  readonly abilityFx: AbilityFx;
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
    this.abilityFx = new AbilityFx(this.effects);
    this.hud = new Hud(assets, VIEW_W, VIEW_H);
    this.world.addChild(
      this.chunks.root,
      this.abilityFx.ground,
      this.entities.root,
      this.effects.root,
      this.abilityFx.air,
      this.debugWorld,
    );
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
    this.abilityFx.clear();
    this.hud.reset();
    this.world.visible = sim !== null;
    this.hud.root.visible = sim !== null;
    this.lighting.root.visible = sim !== null;
    if (sim) this.snapCamera(sim);
  }

  handle(events: readonly SimEvent[]): void {
    for (const e of events) {
      this.entities.handle(e);
      this.effects.handle(e, this.sim?.content);
      this.abilityFx.handle(e, this.sim?.content);
      if (this.sim && (e.type === 'healed' || e.type === 'rested'))
        this.effects.aroundPlayer(this.sim, e.type === 'healed' ? 'heal' : 'rest');
      if (this.sim && (e.type === 'pickedUp' || e.type === 'itemGained'))
        this.effects.aroundPlayer(this.sim, 'collect');
    }
  }

  /** Updates every layer, runs `beforeDraw` (debug overlays), then draws. */
  render(dtMs: number, beforeDraw?: () => void): void {
    const sim = this.sim;
    if (sim) {
      const pb = sim.ecs.get(sim.player, Body);
      if (pb) {
        const k = 1 - Math.pow(1 - CAMERA_LERP, dtMs / (1000 / 60));
        this.camera.x += (pb.x - this.view.w / 2 - this.camera.x) * k;
        this.camera.y += (pb.y - this.view.h / 2 - this.camera.y) * k;
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
      this.effects.update(sim, dtMs, { ...cam, w: this.view.w, h: this.view.h }, biome);
      this.abilityFx.update(sim, dtMs);
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
      x: ((clientX - rect.left) / rect.width) * this.view.w + this.camera.x,
      y: ((clientY - rect.top) / rect.height) * this.view.h + this.camera.y,
    };
  }

  private snapCamera(sim: Simulation): void {
    const pb = sim.ecs.get(sim.player, Body);
    if (!pb) return;
    this.camera.x = pb.x - this.view.w / 2;
    this.camera.y = pb.y - this.view.h / 2;
  }

  /** Fill the window (a slightly bigger view, same pixel scale) or keep the base view with borders. */
  setFill(fill: boolean): void {
    this.fill = fill;
    this.resize();
  }

  /**
   * Scales the game by a whole number so every pixel is the same size (no shimmer). In fill mode
   * the view then grows to the window's shape, up to the cap, so there are no black borders;
   * otherwise it stays at the base view and the rest is border.
   */
  private resize(): void {
    const size = viewFor(innerWidth, innerHeight, this.fill);
    if (!size) return; // No window size yet (hidden tab, pane opening): keep the current view.
    const { w: vw, h: vh, scale } = size;
    if (vw !== this.view.w || vh !== this.view.h) {
      this.view.w = vw;
      this.view.h = vh;
      this.app.renderer.resize(vw, vh);
      this.lighting.resize(vw, vh);
      this.hud.resize(vw, vh);
    }
    const w = Math.floor(vw * scale);
    const h = Math.floor(vh * scale);
    this.wrap.style.width = `${w}px`;
    this.wrap.style.height = `${h}px`;
    this.wrap.style.fontSize = `${Math.max(11, (VIEW_H * scale) / 34)}px`;
  }
}
