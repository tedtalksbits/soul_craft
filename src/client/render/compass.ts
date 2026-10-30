/**
 * The compass bar across the top of the HUD. North is always up in this game,
 * so the bar is fixed rather than turning with the player: a full 360° strip
 * with N in the middle, E right, W left and S at both ends. Each marker sits at
 * its true bearing from the player, so a marker over NE means "up and right",
 * the same way the world map reads.
 */
import { Container, Graphics } from 'pixi.js';
import { Abilities, Body } from '../../sim/components';
import { TILE } from '../../sim/constants';
import type { Simulation } from '../../sim/simulation';
import type { Assets } from '../assets';
import { classPalette } from './class-palette';
import { PixelText } from './pixel-text';

/** Bar width in game pixels: 360° across it. */
const WIDTH = 160;
const HEIGHT = 9;
/** A marker this close (tiles) is where you are; it hides. */
const ARRIVED_TILES = 3;

interface Mark {
  x: number;
  y: number;
  draw(g: Graphics, sx: number, sy: number): void;
}

export class Compass {
  readonly root = new Container();
  private readonly g = new Graphics();
  private readonly letters: PixelText[];

  constructor(assets: Assets) {
    this.letters = ['N', 'E', 'S', 'W', 'S'].map((l) => new PixelText(assets).set(l, 0xd8d0c0));
    this.root.addChild(this.g, ...this.letters);
  }

  /**
   * Draws the bar centered at the top of the view, but never over the health bar, whose
   * right end is `leftLimit`.
   */
  update(sim: Simulation, viewW: number, leftLimit: number): void {
    const pb = sim.ecs.get(sim.player, Body);
    const g = this.g.clear();
    if (!pb) return;
    const x0 = Math.round(Math.max((viewW - WIDTH) / 2, leftLimit + 8));
    const y0 = 4;
    const mid = x0 + WIDTH / 2;
    g.rect(x0 - 1, y0 - 1, WIDTH + 2, HEIGHT + 2).fill({ color: 0x000000, alpha: 0.55 });
    // Ticks every 45°, with N / E / S / W letters at the quarters.
    for (let deg = -180; deg <= 180; deg += 45) {
      const x = Math.round(mid + (deg / 360) * WIDTH);
      g.rect(x, y0 + (deg % 90 === 0 ? 0 : 3), 1, deg % 90 === 0 ? 2 : 3).fill({
        color: 0xd8d0c0,
        alpha: 0.5,
      });
    }
    const quarters = [0, 90, 180, -90, -180];
    this.letters.forEach((t, i) => {
      const deg = quarters[i] ?? 0;
      const x = Math.round(mid + (deg / 360) * WIDTH) - 1;
      t.position.set(Math.min(Math.max(x, x0), x0 + WIDTH - 3), y0 + 2);
    });

    for (const m of this.marks(sim, pb)) {
      const dx = m.x - pb.x;
      const dy = m.y - pb.y;
      if (Math.hypot(dx, dy) < ARRIVED_TILES * TILE) continue;
      // Bearing clockwise from north (screen up), -180..180.
      const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
      m.draw(g, Math.round(mid + (bearing / 360) * WIDTH), y0 + Math.floor(HEIGHT / 2));
    }
  }

  /** What the bar points at: the nearest lit bonfire, the village, the pin and where you died. */
  private marks(sim: Simulation, pb: Body): Mark[] {
    const marks: Mark[] = [];
    let nearest: { x: number; y: number; d: number } | null = null;
    for (const b of Object.values(sim.state.bonfires)) {
      const d = Math.hypot(b.x - pb.x, b.y - pb.y);
      if (!nearest || d < nearest.d) nearest = { x: b.x, y: b.y, d };
    }
    const village = Object.values(sim.state.landmarks).find((l) => l.kind === 'village');
    if (village) {
      marks.push({ x: village.x, y: village.y, draw: (g, x, y) => diamond(g, x, y, 0xf0b866) });
    }
    if (nearest) {
      const n = nearest;
      marks.push({ x: n.x, y: n.y, draw: (g, x, y) => flame(g, x, y) });
    }
    const death = sim.state.lastDeath;
    if (death) marks.push({ x: death.x, y: death.y, draw: (g, x, y) => cross(g, x, y) });
    const pin = sim.state.pin;
    if (pin) {
      const a = sim.ecs.get(sim.player, Abilities);
      const color = a ? classPalette(sim.content, a.class).light : 0xf0b866;
      marks.push({ x: pin.x, y: pin.y, draw: (g, x, y) => pinMark(g, x, y, color) });
    }
    return marks;
  }
}

function diamond(g: Graphics, x: number, y: number, color: number): void {
  g.poly([x, y - 3, x + 3, y, x, y + 3, x - 3, y]).fill(color);
}

function flame(g: Graphics, x: number, y: number): void {
  g.rect(x - 1, y - 2, 3, 4).fill(0xff9a30);
  g.rect(x, y - 3, 1, 1).fill(0xffe0a0);
}

function cross(g: Graphics, x: number, y: number): void {
  for (let i = -2; i <= 2; i++) {
    g.rect(x + i, y + i, 1, 1).fill(0xe05a4a);
    g.rect(x + i, y - i, 1, 1).fill(0xe05a4a);
  }
}

function pinMark(g: Graphics, x: number, y: number, color: number): void {
  g.rect(x - 1, y - 3, 3, 3).fill(color);
  g.rect(x, y, 1, 3).fill(color);
}
