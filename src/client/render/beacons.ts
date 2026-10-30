/**
 * A pillar of light above every lit bonfire. Drawn above the darkness layer and
 * tall enough to rise into view long before the bonfire itself, so a lit bonfire
 * can be found from a distance: walk toward the beam. Purely presentation; the
 * bonfire list comes from the save's registry, so far ones show too.
 */
import { Container, Sprite, Texture } from 'pixi.js';
import type { Simulation } from '../../sim/simulation';

/** The beam's size in game pixels. */
const BEAM_W = 16;
const BEAM_H = 300;
const WARM = 0xffb050;

function beamTexture(): Texture {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 128;
  const g = c.getContext('2d');
  if (g) {
    // Brightest at the base, fading upward; soft at the sides.
    const vertical = g.createLinearGradient(0, 0, 0, c.height);
    vertical.addColorStop(0, 'rgba(255,255,255,0)');
    vertical.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    vertical.addColorStop(1, 'rgba(255,255,255,0.8)');
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

export class Beacons {
  /** Screen space, drawn over the darkness. */
  readonly root = new Container();
  private readonly texture = beamTexture();
  private readonly pool: Sprite[] = [];
  private clockMs = 0;

  update(sim: Simulation, cam: { x: number; y: number }, view: { w: number; h: number }, dtMs: number): void {
    this.clockMs += dtMs;
    let used = 0;
    for (const [id, b] of Object.entries(sim.state.bonfires)) {
      const sx = b.x - cam.x;
      const sy = b.y - cam.y;
      // On screen if the beam's column crosses the view anywhere along its height.
      if (sx < -BEAM_W || sx > view.w + BEAM_W || sy < 0 || sy - BEAM_H > view.h) continue;
      const s = this.sprite(used++);
      s.position.set(Math.round(sx), Math.round(sy) - 4);
      // A slow, out-of-step flicker per bonfire, so several beams don't pulse together.
      const phase = id.length * 0.7 + b.x * 0.01;
      s.alpha = 0.32 + 0.08 * Math.sin(this.clockMs / 500 + phase);
    }
    for (let i = used; i < this.pool.length; i++) {
      const s = this.pool[i];
      if (s) s.visible = false;
    }
  }

  private sprite(i: number): Sprite {
    let s = this.pool[i];
    if (!s) {
      s = new Sprite(this.texture);
      s.anchor.set(0.5, 1);
      s.setSize(BEAM_W, BEAM_H);
      s.tint = WARM;
      s.blendMode = 'add';
      this.pool.push(s);
      this.root.addChild(s);
    }
    s.visible = true;
    return s;
  }
}
