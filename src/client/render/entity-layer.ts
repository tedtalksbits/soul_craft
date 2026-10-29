/**
 * Sprites for every entity with a `Sprite` component, plus per-enemy health
 * bars. Animation choice is derived from sim state each frame; nothing here
 * feeds back into the simulation.
 */
import { Container, Graphics, Sprite as PixiSprite } from 'pixi.js';
import type { Entity } from '../../core/ecs';
import { Ai, Body, Dying, Health, Invulnerable, Pickup, Player, Sprite } from '../../sim/components';
import type { SimEvent } from '../../sim/events';
import { TELEGRAPH_STATES } from '../../sim/modules/brains';
import { DEATH_TICKS } from '../../sim/modules/combat';
import type { Simulation } from '../../sim/simulation';
import type { Assets } from '../assets';
import { selectAnim } from './anim-select';
import type { Dir8 } from './facing';
import { PixelText } from './pixel-text';

const HIT_FLASH_MS = 110;
const BAR_VISIBLE_MS = 4000;
const CHIP_HOLD_MS = 450;
const COMBO_WINDOW_MS = 1500;
/** Pixels between the top of an enemy's head and its health bar. */
const BAR_GAP = 4;

interface EntityView {
  root: Container;
  sprite: PixiSprite;
  /** Additive copy of the sprite used for hit flashes and attack telegraphs. */
  glow: PixiSprite;
  anim: string;
  animMs: number;
  /** Last drawn facing, so diagonals persist when the entity stops. */
  dir8: Dir8 | undefined;
  flashMs: number;
  bar: HealthBar | null;
  /** Health bar width: sized to the body, not the (mostly empty) sprite frame. */
  barWidth: number;
}

export class EntityLayer {
  readonly root = new Container({ sortableChildren: true });
  private readonly views = new Map<Entity, EntityView>();
  private clockMs = 0;

  constructor(private readonly assets: Assets) {}

  handle(e: SimEvent): void {
    if (e.type !== 'damaged') return;
    const view = this.views.get(e.target);
    if (!view) return;
    view.flashMs = HIT_FLASH_MS;
    if (!e.isPlayer) (view.bar ??= this.makeBar(view)).hit(e.amount, e.hp, e.maxHp);
  }

  sync(sim: Simulation, dtMs: number): void {
    this.clockMs += dtMs;
    const { ecs } = sim;
    const seen = new Set<Entity>();
    for (const [e, spriteDef, body] of ecs.query(Sprite, Body)) {
      seen.add(e);
      const view = this.views.get(e) ?? this.create(e);
      const sheet = this.assets.sheet(spriteDef.sheet);
      const { key, dir8, elapsedMs } = selectAnim(sim, e, view.dir8, (k) => sheet?.anim(k) !== undefined);
      view.dir8 = dir8;
      if (elapsedMs !== undefined) view.animMs = elapsedMs;
      else if (key !== view.anim) view.animMs = 0;
      else view.animMs += dtMs;
      view.anim = key;
      const anim = sheet?.anim(key);
      if (anim) {
        const n = Math.floor((view.animMs / 1000) * anim.fps);
        const idx = anim.loop ? n % anim.textures.length : Math.min(n, anim.textures.length - 1);
        const tex = anim.textures[idx] ?? this.assets.missingTexture;
        view.sprite.texture = tex;
        view.glow.texture = tex;
        view.sprite.anchor.set(...sheet!.def.anchor);
        view.glow.anchor.set(...sheet!.def.anchor);
        view.sprite.position.set(...anim.offset);
        view.glow.position.set(...anim.offset);
      }

      view.barWidth = Math.max(16, body.w + 8);
      const z = ecs.get(e, Pickup)?.z ?? 0;
      const feetY = Math.round(body.y + body.h / 2);
      view.root.position.set(Math.round(body.x), feetY - Math.round(z));
      view.root.zIndex = feetY;

      const dying = ecs.get(e, Dying);
      let alpha = dying ? 1 - dying.t / DEATH_TICKS : 1;
      const player = ecs.get(e, Player);
      if (player && player.state !== 'roll' && ecs.has(e, Invulnerable) && Math.floor(this.clockMs / 70) % 2)
        alpha *= 0.35;
      view.sprite.alpha = alpha;

      view.flashMs = Math.max(0, view.flashMs - dtMs);
      const ai = ecs.get(e, Ai);
      const telegraph =
        ai !== undefined &&
        !dying &&
        TELEGRAPH_STATES.has(ai.state) &&
        Math.floor(this.clockMs / 66) % 2 === 0;
      if (view.flashMs > 0) {
        view.glow.tint = 0xffffff;
        view.glow.alpha = (view.flashMs / HIT_FLASH_MS) * 0.85;
      } else if (telegraph) {
        view.glow.tint = 0xff5020;
        view.glow.alpha = 0.55;
      } else view.glow.alpha = 0;

      if (view.bar) {
        const health = ecs.get(e, Health);
        // Above the head pivot when the art provides one; the frame top is a poor guess for big frames.
        const head = sheet?.def.pivots['head'];
        view.bar.root.y = (head ? head[1] : -view.sprite.height) - BAR_GAP;
        view.bar.update(dtMs, health?.hp ?? 0, health?.max ?? 1, !!dying);
      }
    }
    for (const [e, view] of this.views) {
      if (seen.has(e)) continue;
      view.root.destroy({ children: true });
      this.views.delete(e);
    }
  }

  clear(): void {
    for (const view of this.views.values()) view.root.destroy({ children: true });
    this.views.clear();
  }

  private create(e: Entity): EntityView {
    const root = new Container();
    const sprite = new PixiSprite(this.assets.missingTexture);
    const glow = new PixiSprite(this.assets.missingTexture);
    glow.blendMode = 'add';
    glow.alpha = 0;
    root.addChild(sprite, glow);
    this.root.addChild(root);
    const view: EntityView = {
      root,
      sprite,
      glow,
      anim: '',
      animMs: 0,
      dir8: undefined,
      flashMs: 0,
      bar: null,
      barWidth: 16,
    };
    this.views.set(e, view);
    return view;
  }

  private makeBar(view: EntityView): HealthBar {
    const bar = new HealthBar(this.assets, view.barWidth);
    view.root.addChild(bar.root);
    return bar;
  }
}

/**
 * Enemy health: a bar whose lost portion lingers as a pale "chip" before
 * draining, and a running total of damage dealt in the current flurry.
 */
class HealthBar {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly combo: PixelText;
  private visibleMs = 0;
  private chip = 1;
  private chipHoldMs = 0;
  private comboTotal = 0;
  private comboAgeMs = Infinity;

  constructor(
    assets: Assets,
    private readonly width: number,
  ) {
    this.combo = new PixelText(assets);
    this.root.addChild(this.g, this.combo);
  }

  hit(amount: number, hp: number, max: number): void {
    if (this.visibleMs <= 0) this.chip = Math.min(1, (hp + amount) / max);
    this.visibleMs = BAR_VISIBLE_MS;
    this.chipHoldMs = CHIP_HOLD_MS;
    this.comboTotal = this.comboAgeMs < COMBO_WINDOW_MS ? this.comboTotal + amount : amount;
    this.comboAgeMs = 0;
  }

  update(dtMs: number, hp: number, max: number, dying: boolean): void {
    this.visibleMs -= dtMs;
    this.comboAgeMs += dtMs;
    this.root.visible = this.visibleMs > 0 && !dying;
    if (!this.root.visible) return;
    const frac = Math.max(0, hp / max);
    if (this.chipHoldMs > 0) this.chipHoldMs -= dtMs;
    else this.chip = Math.max(frac, this.chip - dtMs / 600);

    const w = this.width;
    const x = -Math.floor(w / 2);
    this.g.clear();
    this.g.rect(x - 1, -1, w + 2, 4).fill({ color: 0x000000, alpha: 0.75 });
    this.g.rect(x, 0, Math.round(w * this.chip), 2).fill(0xe8d8b0);
    this.g.rect(x, 0, Math.round(w * frac), 2).fill(0xb8261c);

    const showCombo = this.comboAgeMs < COMBO_WINDOW_MS + 600;
    this.combo.visible = showCombo;
    if (showCombo) {
      const fresh = this.comboAgeMs < 120;
      this.combo.set(String(this.comboTotal), fresh ? 0xffffff : 0xf0c870);
      this.combo.position.set(x + w + 3, -2);
    }
  }
}
