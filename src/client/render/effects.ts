/**
 * Purely cosmetic world-space effects: particles, floating damage numbers,
 * the sword arc and projectiles. Uses Math.random freely: none of this is
 * simulation state.
 */
import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Content } from '../../content/content';
import type { BiomeDef } from '../../content/schemas';
import {
  Body,
  Magnetized,
  Pickup,
  Player,
  Projectile,
  Sprite as SpriteDef,
  type PickupKind,
  type ProjectileKind,
} from '../../sim/components';
import type { SimEvent } from '../../sim/events';
import type { Simulation } from '../../sim/simulation';
import type { Assets } from '../assets';
import { dir8FromVec } from './facing';
import { PixelText } from './pixel-text';

const MAX_PARTICLES = 700;
const FRAME_MS = 1000 / 60;
const SLASH_MS = 170;
/** Which sprite sheet each projectile kind is fired from (its release pivots set the flight height). */
const PROJECTILE_SHEET: Readonly<Record<ProjectileKind, string>> = { arrow: 'archer' };
/** Shimmer colour behind loot flying to the player. */
const TRAIL_COLOR: Readonly<Record<PickupKind, number>> = {
  souls: 0xb8ccff,
  ember: 0xffb050,
  item: 0xfff0c8,
};
/** Flight height when the shooter's sheet has no release pivot (sized for 24px placeholders). */
const DEFAULT_FLIGHT_HEIGHT = -8;
/** Chip colour for anything woody that a sword bites into. */
const WOOD = 0x6e5236;
/** Arc centre above the feet when a sheet has no `swing` pivot (sized for 24px-tall sprites). */
const DEFAULT_SWING_PIVOT: readonly [number, number] = [0, -9];

interface Particle {
  sprite: Sprite;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  grav: number;
  drag: number;
}

interface FloatingNumber {
  text: PixelText;
  x: number;
  y: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
}

interface BurstOptions {
  count: number;
  color: number;
  speed?: number;
  life?: number;
  size?: number;
  z?: number;
  vz?: number;
  grav?: number;
  drag?: number;
  add?: boolean;
  angle?: number;
  spread?: number;
}

export class Effects {
  readonly root = new Container();
  /** Screen shake magnitude in pixels, decays each frame. Read by the camera. */
  shake = 0;
  /** 0..1 red vignette pulse after the player is hurt. */
  hurtFlash = 0;
  private readonly particleLayer = new Container();
  private readonly numberLayer = new Container();
  private readonly slashG = new Graphics();
  private readonly projectileG = new Graphics();
  private readonly particles: Particle[] = [];
  private readonly pool: Sprite[] = [];
  private readonly numbers: FloatingNumber[] = [];
  private slash: { ageMs: number; dirX: number; dirY: number } | null = null;

  constructor(private readonly assets: Assets) {
    this.root.addChild(this.projectileG, this.particleLayer, this.slashG, this.numberLayer);
  }

  handle(e: SimEvent, content?: Content): void {
    switch (e.type) {
      case 'damaged':
        this.burst(e.x, e.y, {
          count: 10,
          color: 0x7a1008,
          speed: 1.6,
          size: 2,
          life: 30,
          z: 6,
          vz: 1.2,
          grav: 0.12,
        });
        if (e.isPlayer) {
          this.number(e.x, e.y - 18, `-${e.amount}`, 0xff5a4a, 1);
          this.shake = Math.min(7, this.shake + 3);
          this.hurtFlash = 1;
        } else {
          this.number(
            e.x,
            e.y - 20,
            e.crit ? `${e.amount}!` : String(e.amount),
            e.crit ? 0xffd040 : 0xffffff,
            e.crit ? 2 : 1,
          );
          this.shake = Math.min(5, this.shake + (e.crit ? 2.5 : 1.2));
        }
        return;
      case 'blocked':
        this.burst(e.x, e.y, { count: 10, color: 0xffd080, speed: 2.2, life: 16, add: true, z: 8 });
        this.shake = Math.min(5, this.shake + 1);
        return;
      case 'killed':
        this.burst(e.x, e.y, { count: 24, color: 0xd0e0ff, speed: 0.8, life: 60, add: true, z: 8, vz: 0.6 });
        if (e.souls > 0) this.number(e.x, e.y - 30, `+${e.souls}`, 0xb8ccff, 1);
        return;
      case 'tileHit': {
        const color = tileColor(content, e.tile);
        this.burst(e.x, e.y - 4, { count: 5, color: WOOD, speed: 1.4, life: 20, z: 6, vz: 1, grav: 0.12 });
        this.burst(e.x, e.y - 4, { count: 4, color, speed: 1, life: 24, z: 8, vz: 0.6, grav: 0.08 });
        this.shake = Math.min(4, this.shake + 1);
        return;
      }
      case 'tileCut':
        if (e.hits <= 1) {
          this.burst(e.x, e.y, { count: 8, color: 0x7a9a50, speed: 1, life: 30, z: 4, vz: 1, grav: 0.06 });
          return;
        }
        this.burst(e.x, e.y - 4, {
          count: 14,
          color: WOOD,
          speed: 1.8,
          size: 2,
          life: 30,
          z: 6,
          vz: 1.4,
          grav: 0.12,
        });
        this.burst(e.x, e.y - 6, {
          count: 18,
          color: tileColor(content, e.tile),
          speed: 1.4,
          size: 2,
          life: 40,
          z: 10,
          vz: 0.8,
          grav: 0.08,
        });
        this.shake = Math.min(6, this.shake + 2.5);
        return;
      case 'wallSlam':
        this.burst(e.x, e.y, { count: 24, color: 0x8a8278, speed: 1.4, size: 3, life: 45, z: 4, vz: 0.4 });
        this.shake = Math.min(9, this.shake + 6);
        return;
      case 'swing':
        this.slash = { ageMs: 0, dirX: e.dirX, dirY: e.dirY };
        return;
      case 'bonfireLit':
      case 'rested':
        return;
      default:
        return;
    }
  }

  /** Particles at the player's position, for events that carry no coordinates. */
  aroundPlayer(sim: Simulation, kind: 'heal' | 'rest' | 'collect'): void {
    const b = sim.ecs.get(sim.player, Body);
    if (!b) return;
    if (kind === 'collect') {
      // A small upward sparkle as loot lands in the pack.
      this.burst(b.x, b.y, { count: 6, color: 0xfff0c8, speed: 0.9, life: 18, add: true, z: 10, vz: 0.8 });
      return;
    }
    this.burst(b.x, b.y, {
      count: kind === 'heal' ? 16 : 24,
      color: 0xffb050,
      speed: 0.6,
      life: 40,
      add: true,
      z: 8,
      vz: 0.5,
    });
  }

  update(
    sim: Simulation,
    dtMs: number,
    view: { x: number; y: number; w: number; h: number },
    biome: BiomeDef | undefined,
  ): void {
    const k = dtMs / FRAME_MS;
    this.shake *= Math.pow(0.86, k);
    if (this.shake < 0.3) this.shake = 0;
    this.hurtFlash = Math.max(0, this.hurtFlash - 0.05 * k);
    this.ambient(biome, view, k);
    this.magnetTrails(sim, k);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.life -= k;
      if (p.life <= 0) {
        this.release(p.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      const drag = Math.pow(p.drag, k);
      p.vx *= drag;
      p.vy *= drag;
      p.x += p.vx * k;
      p.y += p.vy * k;
      p.vz -= p.grav * k;
      p.z = Math.max(0, p.z + p.vz * k);
      p.sprite.position.set(Math.round(p.x), Math.round(p.y - p.z));
      p.sprite.alpha = Math.min(1, p.life / (p.max * 0.5));
    }

    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i]!;
      n.ageMs += dtMs;
      if (n.ageMs >= n.lifeMs) {
        n.text.destroy({ children: true });
        this.numbers.splice(i, 1);
        continue;
      }
      n.y += n.vy * k;
      n.vy *= Math.pow(0.9, k);
      n.text.position.set(Math.round(n.x - n.text.width / 2), Math.round(n.y));
      n.text.alpha = Math.min(1, (n.lifeMs - n.ageMs) / 300);
    }

    this.drawSlash(sim, dtMs);
    this.drawProjectiles(sim);
  }

  clear(): void {
    for (const p of this.particles) this.release(p.sprite);
    this.particles.length = 0;
    for (const n of this.numbers) n.text.destroy({ children: true });
    this.numbers.length = 0;
    this.slash = null;
    this.shake = 0;
    this.hurtFlash = 0;
  }

  /** Loot caught by the magnet leaves a short shimmer trail, denser as it speeds up. */
  private magnetTrails(sim: Simulation, k: number): void {
    for (const [, pull, pickup, b] of sim.ecs.query(Magnetized, Pickup, Body)) {
      if (Math.random() > Math.min(1, 0.3 + pull.ticks * 0.03) * k) continue;
      this.burst(b.x, b.y, {
        count: 1,
        color: TRAIL_COLOR[pickup.kind],
        speed: 0.15,
        life: 14,
        add: true,
        z: pickup.z + 3,
      });
    }
  }

  burst(x: number, y: number, o: BurstOptions): void {
    for (let i = 0; i < o.count && this.particles.length < MAX_PARTICLES; i++) {
      const a = (o.angle ?? 0) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const s = (o.speed ?? 1) * (0.4 + Math.random() * 0.8);
      const life = (o.life ?? 30) * (0.6 + Math.random() * 0.6);
      const sprite = this.acquire(o.color, o.size ?? 1, o.add ?? false);
      this.particles.push({
        sprite,
        x,
        y,
        z: o.z ?? 0,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        vz: o.vz ?? 0,
        life,
        max: life,
        grav: o.grav ?? 0,
        drag: o.drag ?? 0.95,
      });
    }
  }

  private number(x: number, y: number, text: string, color: number, scale: number): void {
    const t = new PixelText(this.assets).set(text, color);
    t.scale.set(scale);
    this.numberLayer.addChild(t);
    this.numbers.push({ text: t, x: x + (Math.random() - 0.5) * 8, y, vy: -1.4, ageMs: 0, lifeMs: 900 });
  }

  private ambient(
    biome: BiomeDef | undefined,
    v: { x: number; y: number; w: number; h: number },
    k: number,
  ): void {
    if (!biome || Math.random() > 0.25 * k) return;
    const rx = v.x + Math.random() * v.w * 1.2;
    const ry = v.y + Math.random() * v.h;
    switch (biome.ambient) {
      case 'ash':
        this.burst(rx, v.y - 6, { count: 1, color: 0xd2cdc3, speed: 0, life: 420, drag: 1, spread: 0 });
        this.particles[this.particles.length - 1]!.vx = -0.25;
        this.particles[this.particles.length - 1]!.vy = 0.45;
        return;
      case 'spores':
        this.burst(rx, ry, {
          count: 1,
          color: Math.random() < 0.5 ? 0xc49aff : 0x7ad8d0,
          speed: 0.15,
          life: 160,
          add: true,
          z: 6,
          drag: 1,
        });
        return;
      case 'mist':
        this.burst(rx, ry, { count: 1, color: 0x9aa4a8, speed: 0.1, size: 3, life: 200, drag: 1 });
        return;
      case 'none':
        return;
    }
  }

  private drawSlash(sim: Simulation, dtMs: number): void {
    const g = this.slashG;
    g.clear();
    if (!this.slash) return;
    this.slash.ageMs += dtMs;
    const p = sim.ecs.get(sim.player, Player);
    const b = sim.ecs.get(sim.player, Body);
    if (!p || !b || p.state !== 'attack' || this.slash.ageMs > SLASH_MS) {
      this.slash = null;
      return;
    }
    const f = Math.min(1, this.slash.ageMs / (SLASH_MS * 0.6));
    const base = Math.atan2(this.slash.dirY, this.slash.dirX);
    const a = base - 1.3 + f * 2.6;
    const sheet = this.assets.sheet(sim.ecs.get(sim.player, SpriteDef)?.sheet ?? '');
    const [px, py] = sheet?.def.pivots['swing'] ?? DEFAULT_SWING_PIVOT;
    const cx = Math.round(b.x + px);
    const cy = Math.round(b.y + b.h / 2 + py);
    g.moveTo(cx, cy)
      .lineTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15)
      .stroke({ width: 2, color: 0xe4e8ea });
    g.arc(cx, cy, 14, base - 1.3, a).stroke({ width: 3, color: 0xfff0d2, alpha: 0.5 * (1 - f * 0.5) });
  }

  private drawProjectiles(sim: Simulation): void {
    const g = this.projectileG;
    g.clear();
    for (const [, proj, body] of sim.ecs.query(Projectile, Body)) {
      const x = body.x;
      const y = body.y + this.flightHeight(proj);
      g.moveTo(x, y)
        .lineTo(x - proj.vx * 3, y - proj.vy * 3)
        .stroke({ width: 1, color: 0xc8b898 });
      g.rect(Math.round(x), Math.round(y), 1, 1).fill(0xe8e0d0);
    }
  }

  /**
   * Height (negative = up) a projectile flies at above its ground position: the shooter's
   * release pivot for the direction of flight, so an arrow leaves from the bow hand.
   */
  private flightHeight(proj: Projectile): number {
    const sheet = this.assets.sheet(PROJECTILE_SHEET[proj.kind]);
    const dir = dir8FromVec(proj.vx, proj.vy);
    const release = sheet?.anim(`attack_${dir}`)?.pivots['release'] ?? sheet?.def.pivots['release'];
    return release ? release[1] : DEFAULT_FLIGHT_HEIGHT;
  }

  private acquire(color: number, size: number, add: boolean): Sprite {
    const s = this.pool.pop() ?? new Sprite(Texture.WHITE);
    s.tint = color;
    s.setSize(size, size);
    s.blendMode = add ? 'add' : 'normal';
    s.alpha = 1;
    s.visible = true;
    this.particleLayer.addChild(s);
    return s;
  }

  private release(s: Sprite): void {
    s.visible = false;
    this.particleLayer.removeChild(s);
    this.pool.push(s);
  }
}

/** A tile's map colour (its dominant colour), used to tint debris; leaf green if unknown. */
function tileColor(content: Content | undefined, id: string): number {
  const hex = content?.tiles.find((t) => t.id === id)?.map;
  return hex === undefined ? 0x7a9a50 : parseInt(hex.slice(1), 16);
}
