/**
 * Gear on the ground, made findable and readable (docs/gear-and-loot.md, "Drop feel"): a thin pillar of light
 * in the tier's color over every Noble and Legendary piece, and the piece's name in its tier's color over
 * any gear close to the player. Drawn over the darkness, so night never hides loot. No other thing uses a tier's
 * beam: bonfires have their own, wider and warm. Purely presentation.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import { TIERS, type TierId } from '../../content/schemas';
import { Body, Pickup } from '../../sim/components';
import type { Simulation } from '../../sim/simulation';
import type { Assets } from '../assets';
import { PixelText } from './pixel-text';

const BEAM_W = 8;
const BEAM_H = 140;
/** Gear this close (px) to the player shows its name. */
const LABEL_RANGE = 72;
const GLYPH_H = 7;
/** Space (px) kept between two labels side by side. */
const GAP = 4;

function beamTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    // A hard bright core with soft edges, fading out toward the top.
    const vertical = g.createLinearGradient(0, 0, 0, c.height);
    vertical.addColorStop(0, 'rgba(255,255,255,0)');
    vertical.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    vertical.addColorStop(1, 'rgba(255,255,255,0.95)');
    g.fillStyle = vertical;
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'destination-in';
    const horizontal = g.createLinearGradient(0, 0, c.width, 0);
    horizontal.addColorStop(0, 'rgba(0,0,0,0)');
    horizontal.addColorStop(0.5, 'rgba(0,0,0,1)');
    horizontal.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = horizontal;
    g.fillRect(0, 0, c.width, c.height);
  }
  return Texture.from(c);
}

export const tierColor = (sim: Simulation, tier: TierId): number =>
  Number.parseInt(sim.content.loot.tiers[tier].color.slice(1), 16);

/** Whether a tier gets a beam and a compass pip: Noble and better. */
export const beamed = (tier: TierId): boolean => TIERS.indexOf(tier) >= TIERS.indexOf('noble');

/** The name as the pixel font can draw it: capitals, and only the characters it has. */
const fontText = (name: string) => name.toUpperCase().replace(/[^A-Z0-9 !+\-/]/g, '');

export class LootMarks {
  /** Screen space, drawn over the darkness. */
  readonly root = new Container();
  private readonly beams = new Container();
  private readonly labels = new Container();
  private readonly texture = beamTexture();
  private readonly beamPool: Sprite[] = [];
  private readonly labelPool: PixelText[] = [];
  private clockMs = 0;

  constructor(private readonly assets: Assets) {
    this.root.addChild(this.beams, this.labels);
  }

  update(sim: Simulation, cam: { x: number; y: number }, view: { w: number; h: number }, dtMs: number): void {
    this.clockMs += dtMs;
    const pb = sim.ecs.get(sim.player, Body);
    let beams = 0;
    const near: { name: string; color: number; x: number; y: number }[] = [];
    for (const [, pickup, body] of sim.ecs.query(Pickup, Body)) {
      const tier = pickup.gear?.tier;
      if (!tier || pickup.item === null) continue;
      const sx = Math.round(body.x - cam.x);
      const sy = Math.round(body.y - cam.y - pickup.z);
      if (sx < -BEAM_W || sx > view.w + BEAM_W || sy < 0 || sy - BEAM_H > view.h + 20) continue;
      if (beamed(tier)) {
        const legendary = tier === 'legendary';
        const s = this.beam(beams++);
        s.position.set(sx, sy + 2);
        s.tint = tierColor(sim, tier);
        s.setSize(legendary ? BEAM_W + 2 : BEAM_W, legendary ? BEAM_H + 40 : BEAM_H);
        s.alpha = (legendary ? 0.8 : 0.6) + 0.12 * Math.sin(this.clockMs / (legendary ? 180 : 260) + body.x);
      }
      if (pb && Math.hypot(body.x - pb.x, body.y - pb.y) < LABEL_RANGE)
        near.push({
          name: fontText(sim.content.item(pickup.item).name),
          color: tierColor(sim, tier),
          x: sx,
          y: sy,
        });
    }
    for (let i = beams; i < this.beamPool.length; i++) this.beamPool[i]!.visible = false;

    // Bottom to top, each label nudged up clear of any it would overlap, so a pile stays readable.
    near.sort((a, b) => b.y - a.y);
    const placed: { x0: number; x1: number; y: number }[] = [];
    near.forEach((n, i) => {
      const t = this.label(i).set(n.name, n.color);
      const x0 = n.x - Math.floor(t.pixelWidth / 2);
      const x1 = x0 + t.pixelWidth;
      let y = n.y - 14;
      for (const p of placed)
        if (x0 < p.x1 + GAP && x1 + GAP > p.x0 && Math.abs(p.y - y) < GLYPH_H) y = p.y - GLYPH_H;
      placed.push({ x0, x1, y });
      t.position.set(x0, y);
    });
    for (let i = near.length; i < this.labelPool.length; i++) this.labelPool[i]!.visible = false;
  }

  private beam(i: number): Sprite {
    let s = this.beamPool[i];
    if (!s) {
      s = new Sprite(this.texture);
      s.anchor.set(0.5, 1);
      s.blendMode = 'add';
      this.beamPool.push(s);
      this.beams.addChild(s);
    }
    s.visible = true;
    return s;
  }

  private label(i: number): PixelText {
    let t = this.labelPool[i];
    if (!t) {
      t = new PixelText(this.assets);
      this.labelPool.push(t);
      this.labels.addChild(t);
    }
    t.visible = true;
    return t;
  }
}
