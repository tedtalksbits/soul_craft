/**
 * Ability visuals: what the class abilities look like in the world. Ground
 * marks (burning zones, a lobbed charge's landing ring) draw under the
 * entities; blast shockwaves, the thrown charge and super auras draw above.
 * Everything is drawn in the caster's class palette, so the color alone says
 * which class is playing. Purely cosmetic: it all derives from sim state and events.
 */
import { Container, Graphics } from 'pixi.js';
import type { Content } from '../../content/content';
import { Abilities, Blast, Body, Empowered, Enemy, Player, Staggered, Zone } from '../../sim/components';
import { FULL_ENERGY } from '../../sim/modules/energy';
import type { SimEvent } from '../../sim/events';
import type { Simulation } from '../../sim/simulation';
import { abilityPalette, classPalette } from './class-palette';
import type { Assets } from '../assets';
import type { Effects } from './effects';
import { dir8FromVec } from './facing';

const FRAME_MS = 1000 / 60;
/** How long a blast's shockwave ring takes to expand and fade. */
const RING_MS = 320;
/** How high (px) a lobbed charge arcs at the middle of its flight. */
const LOB_HEIGHT = 18;
/** Where a lob starts when the caster's pose has no hand pivot: about chest height. */
const DEFAULT_THROW_HEIGHT = 13;

interface Ring {
  x: number;
  y: number;
  radius: number;
  color: number;
  ageMs: number;
}

interface Lob {
  fromX: number;
  /** The ground point under the hand at the throw, and the height of the hand above it. */
  fromY: number;
  fromHeight: number;
  toX: number;
  toY: number;
  color: number;
  ageMs: number;
  flightMs: number;
}

export class AbilityFx {
  /** Under the entities: marks on the ground. */
  readonly ground = new Graphics();
  /** Over the entities: shockwaves and things in the air. */
  readonly air = new Container();
  private readonly airG = new Graphics();
  private readonly rings: Ring[] = [];
  private readonly lobs: Lob[] = [];
  private clockMs = 0;
  /** A class change to celebrate on the next update, when the player's position is known. */
  private attuned: string | null = null;

  constructor(
    private readonly effects: Effects,
    private readonly assets: Assets,
  ) {
    this.air.addChild(this.airG);
  }

  handle(e: SimEvent, content: Content | undefined): void {
    if (!content) return;
    switch (e.type) {
      case 'blast': {
        const pal = abilityPalette(content, e.ability);
        const color = pal.base;
        this.rings.push({ x: e.x, y: e.y, radius: e.radius, color: pal.light, ageMs: 0 });
        this.effects.burst(e.x, e.y, {
          count: Math.round(e.radius / 2),
          color,
          speed: e.radius / 14,
          life: 26,
          add: true,
          z: 4,
          vz: 0.8,
          grav: 0.05,
        });
        this.effects.burst(e.x, e.y, {
          count: 10,
          color: 0x6a6258,
          speed: 1.2,
          size: 2,
          life: 40,
          z: 2,
          vz: 0.6,
          grav: 0.04,
        });
        this.effects.shake = Math.min(8, this.effects.shake + e.radius / 14);
        return;
      }
      case 'abilityUsed': {
        const def = content.abilities[e.ability];
        if (!def) return;
        const color = abilityPalette(content, e.ability).light;
        // A lobbed charge flies from the caster to where it will burst, over its fuse.
        for (const fx of def.effects) {
          if (fx.type === 'blast' && fx.at === 'aim' && fx.fuse > 0) {
            const hand = this.throwingHand(content, def.pose, e.tx - e.x, e.ty - e.y);
            const feetY = e.y + content.player.body.h / 2;
            this.lobs.push({
              fromX: e.x + (hand?.[0] ?? 0),
              fromY: feetY,
              fromHeight: hand ? -hand[1] : DEFAULT_THROW_HEIGHT,
              toX: e.tx,
              toY: e.ty,
              color,
              ageMs: 0,
              flightMs: (fx.fuse * 1000) / 60,
            });
          }
        }
        if (e.slot === 'super')
          this.effects.burst(e.x, e.y, { count: 30, color, speed: 1.6, life: 40, add: true, z: 10, vz: 1 });
        return;
      }
      case 'empowered':
        this.effects.shake = Math.min(8, this.effects.shake + 3);
        return;
      case 'classChanged':
        this.attuned = e.class;
        return;
      default:
        return;
    }
  }

  update(sim: Simulation, dtMs: number): void {
    const k = dtMs / FRAME_MS;
    this.clockMs += dtMs;
    const { ecs, content } = sim;
    const g = this.ground.clear();
    const air = this.airG.clear();

    // Burning ground: a flickering rim, embers rising from inside.
    for (const [, zone, body] of ecs.query(Zone, Body)) {
      if (zone.t < zone.delay) continue;
      const pal = abilityPalette(content, zone.ability);
      const color = pal.base;
      const fade = Math.min(1, (zone.delay + zone.duration - zone.t) / 30);
      const flicker = 0.75 + 0.25 * Math.sin(this.clockMs / 70 + body.x);
      g.ellipse(body.x, body.y, zone.radius, zone.radius * 0.7).fill({ color: pal.dark, alpha: 0.22 * fade });
      g.ellipse(body.x, body.y, zone.radius, zone.radius * 0.7).stroke({
        color,
        alpha: 0.55 * fade * flicker,
        width: 1,
      });
      const density = (zone.radius * zone.radius) / 900;
      if (Math.random() < density * 0.35 * k) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * zone.radius;
        this.effects.burst(body.x + Math.cos(a) * r, body.y + Math.sin(a) * r * 0.7, {
          count: 1,
          color,
          speed: 0.1,
          life: 30,
          add: true,
          z: 1,
          vz: 0.5,
          grav: 0,
          drag: 0.98,
        });
      }
    }

    // A lit charge waiting to burst: the area it will cover, blinking faster as the fuse runs down.
    for (const [, blast, body] of ecs.query(Blast, Body)) {
      const color = abilityPalette(content, blast.ability).light;
      const blink = Math.sin(this.clockMs / Math.max(30, blast.fuse * 4)) > 0 ? 0.55 : 0.25;
      g.ellipse(body.x, body.y, blast.radius, blast.radius * 0.7).stroke({ color, alpha: blink, width: 1 });
    }

    for (let i = this.lobs.length - 1; i >= 0; i--) {
      const lob = this.lobs[i]!;
      lob.ageMs += dtMs;
      const t = Math.min(1, lob.ageMs / lob.flightMs);
      if (t >= 1) {
        this.lobs.splice(i, 1);
        continue;
      }
      // Along the ground from under the hand to the landing point, falling from the hand's height.
      const x = lob.fromX + (lob.toX - lob.fromX) * t;
      const height = lob.fromHeight * (1 - t) + Math.sin(t * Math.PI) * LOB_HEIGHT;
      const y = lob.fromY + (lob.toY - lob.fromY) * t - height;
      air
        .circle(x, y, 2)
        .fill(0x2a2420)
        .circle(x - 0.5, y - 0.5, 1)
        .fill(lob.color);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]!;
      ring.ageMs += dtMs;
      const t = ring.ageMs / RING_MS;
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const r = ring.radius * (0.35 + 0.65 * Math.sqrt(t));
      air.ellipse(ring.x, ring.y, r, r * 0.7).stroke({ color: ring.color, alpha: 1 - t, width: 2 });
    }

    // The player: dash trails, a charged super, super auras, a class change.
    const p = ecs.get(sim.player, Player);
    const pb = ecs.get(sim.player, Body);
    const a = ecs.get(sim.player, Abilities);
    if (p && pb && a) {
      const pal = classPalette(content, a.class);
      const color = pal.base;
      if (this.attuned) {
        const burst = classPalette(content, this.attuned);
        this.effects.burst(pb.x, pb.y, {
          count: 36,
          color: burst.light,
          speed: 1.4,
          life: 44,
          add: true,
          z: 10,
          vz: 0.9,
        });
        this.rings.push({ x: pb.x, y: pb.y, radius: 34, color: burst.base, ageMs: 0 });
        this.attuned = null;
      }
      // A charged super shows on the player, not just the HUD: faint wisps rising off them.
      if (a.energy >= FULL_ENERGY && !ecs.has(sim.player, Empowered) && Math.random() < 0.18 * k) {
        this.effects.burst(pb.x + (Math.random() - 0.5) * 10, pb.y - 2, {
          count: 1,
          color: pal.light,
          speed: 0.05,
          life: 34,
          add: true,
          z: 4 + Math.random() * 14,
          vz: 0.35,
          grav: 0,
          drag: 0.99,
        });
      }
      const casting = a.casting ? content.abilities[a.casting.ability] : undefined;
      const dash = casting?.effects.find((fx) => fx.type === 'dash');
      if (p.state === 'cast' && dash && casting && p.t >= casting.cast.release && Math.random() < 0.9 * k)
        this.effects.burst(pb.x, pb.y, {
          count: 2,
          color,
          speed: 0.2,
          life: 16,
          add: true,
          z: 8,
          spread: 0.6,
        });
      if (ecs.has(sim.player, Empowered) && Math.random() < 0.6 * k) {
        const ang = Math.random() * Math.PI * 2;
        this.effects.burst(pb.x + Math.cos(ang) * 8, pb.y + Math.sin(ang) * 4, {
          count: 1,
          color,
          speed: 0.15,
          life: 26,
          add: true,
          z: 6,
          vz: 0.5,
          grav: 0,
          drag: 0.97,
        });
      }
    }
    this.staggerSparks(sim, k);
  }

  /** Staggered enemies spark in the class color (only the player staggers things). */
  private staggerSparks(sim: Simulation, k: number): void {
    const a = sim.ecs.get(sim.player, Abilities);
    if (!a) return;
    const color = classPalette(sim.content, a.class).light;
    for (const [, , , body] of sim.ecs.query(Staggered, Enemy, Body)) {
      if (Math.random() > 0.35 * k) continue;
      this.effects.burst(body.x + (Math.random() - 0.5) * body.w, body.y - 6 - Math.random() * 10, {
        count: 1,
        color,
        speed: 0.6,
        life: 12,
        add: true,
        z: 8,
        vz: 0.4,
      });
    }
  }

  /**
   * The throwing hand's position relative to the feet, from the cast pose's per-direction
   * `release` pivot, so a lobbed charge leaves from the hand rather than the chest.
   */
  private throwingHand(
    content: Content,
    pose: string,
    dx: number,
    dy: number,
  ): readonly [number, number] | null {
    const sheet = this.assets.sheet(content.player.sprite);
    return sheet?.anim(`${pose}_${dir8FromVec(dx, dy)}`)?.pivots['release'] ?? null;
  }

  clear(): void {
    this.attuned = null;
    this.rings.length = 0;
    this.lobs.length = 0;
    this.ground.clear();
    this.airG.clear();
  }
}
