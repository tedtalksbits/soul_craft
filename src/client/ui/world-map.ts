/**
 * The world map screen (M): the ground the player has seen, in each tile's map
 * color, with markers for bonfires, places and stations, the player, where they
 * last died, and their own pin. Drag to pan, scroll to zoom, click to place or
 * remove the pin. The game is paused while it is open.
 */
import { DIR_VEC } from '../../core/math';
import { Abilities, Body, Facing } from '../../sim/components';
import { CHUNK, TILE } from '../../sim/constants';
import { CELL_TILES, CELLS_PER_CHUNK } from '../../sim/modules/mapping';
import type { Simulation } from '../../sim/simulation';
import type { LandmarkKind } from '../../sim/state';
import { chunkKey } from '../../sim/world/generator';
import { classPalette } from '../render/class-palette';
import type { MapTerrain } from '../render/map-terrain';
import { h } from './dom';

export interface WorldMapOptions {
  sim: Simulation;
  terrain: MapTerrain;
  /** The key that opens and closes the map, for the hint. */
  mapKey: string;
  setPin(at: { x: number; y: number } | null): void;
  close(): void;
}

/** Screen pixels per tile at each zoom step. */
const ZOOMS = [1, 2, 3, 4, 6] as const;
/** How close (screen px) a click must be to the pin to remove it rather than move it. */
const PIN_HIT = 10;

const LANDMARK_STYLE: Readonly<Record<LandmarkKind, { color: string; label: string }>> = {
  village: { color: '#f0b866', label: 'Village' },
  shrine: { color: '#9fb4d8', label: 'Shrine' },
  camp: { color: '#d0705a', label: 'Camp' },
  wayshrine: { color: '#c8c0a8', label: 'Wayshrine' },
  forge: { color: '#ff9a40', label: 'Forge' },
  alchemy: { color: '#7ad8d0', label: 'Alchemy table' },
};

export class WorldMapScreen {
  readonly el: HTMLElement;
  private readonly canvas = h('canvas', { class: 'map-canvas' });
  private readonly footer = h('div', { class: 'map-footer' });
  /** The world point at the center of the view, and the zoom step. */
  private cx: number;
  private cy: number;
  // Two pixels per tile: close enough to read the ground, far enough to see the way home.
  private zoom = 1;
  /** The pin as the player sees it now (the sim catches up when the game resumes). */
  private pin: { x: number; y: number } | null;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private cursor: { x: number; y: number } | null = null;

  constructor(private readonly o: WorldMapOptions) {
    const pb = o.sim.ecs.get(o.sim.player, Body);
    this.cx = pb?.x ?? 0;
    this.cy = pb?.y ?? 0;
    this.pin = o.sim.state.pin;
    this.el = h(
      'div',
      { class: 'screen world-map' },
      h(
        'div',
        { class: 'map-head' },
        h('h1', {}, 'MAP'),
        h('button', { onclick: () => this.centerOnPlayer() }, 'Center on me'),
        h('button', { onclick: () => this.placePin(null) }, 'Clear pin'),
        h('button', { class: 'quiet', onclick: () => o.close() }, `Close (${o.mapKey})`),
      ),
      h('div', { class: 'map-frame' }, this.canvas, legend()),
      this.footer,
    );
    this.canvas.addEventListener('mousedown', (e) => {
      this.drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    addEventListener('mousemove', this.onMove);
    addEventListener('mouseup', this.onUp);
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.canvas.addEventListener('mouseleave', () => {
      this.cursor = null;
      this.draw();
    });
    // Sized once it is in the page.
    requestAnimationFrame(() => this.draw());
  }

  /** Stop listening to the window; call when the screen closes. */
  dispose(): void {
    removeEventListener('mousemove', this.onMove);
    removeEventListener('mouseup', this.onUp);
  }

  private get scale(): number {
    return ZOOMS[this.zoom] ?? 2;
  }

  private centerOnPlayer(): void {
    const pb = this.o.sim.ecs.get(this.o.sim.player, Body);
    if (pb) {
      this.cx = pb.x;
      this.cy = pb.y;
    }
    this.draw();
  }

  private placePin(at: { x: number; y: number } | null): void {
    this.pin = at;
    this.o.setPin(at);
    this.draw();
  }

  /** Screen point (canvas pixels) to world pixels. */
  private toWorld(sx: number, sy: number): { x: number; y: number } {
    const k = this.scale / TILE;
    return { x: this.cx + (sx - this.canvas.width / 2) / k, y: this.cy + (sy - this.canvas.height / 2) / k };
  }

  private toScreen(x: number, y: number): { x: number; y: number } {
    const k = this.scale / TILE;
    return { x: (x - this.cx) * k + this.canvas.width / 2, y: (y - this.cy) * k + this.canvas.height / 2 };
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private readonly onMove = (e: MouseEvent): void => {
    const p = this.local(e);
    this.cursor = this.toWorld(p.x, p.y);
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (this.drag.moved || Math.hypot(dx, dy) > 3) {
        const k = this.scale / TILE;
        this.cx -= dx / k;
        this.cy -= dy / k;
        this.drag = { x: e.clientX, y: e.clientY, moved: true };
      }
    }
    this.draw();
  };

  private readonly onUp = (e: MouseEvent): void => {
    const drag = this.drag;
    this.drag = null;
    if (!drag || drag.moved || e.target !== this.canvas) return;
    // A click, not a drag: move the pin here, or remove it if the click was on it.
    const p = this.local(e);
    if (this.pin) {
      const s = this.toScreen(this.pin.x, this.pin.y);
      if (Math.hypot(s.x - p.x, s.y - p.y) < PIN_HIT) {
        this.placePin(null);
        return;
      }
    }
    this.placePin(this.toWorld(p.x, p.y));
  };

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const before = this.toWorld(p.x, p.y);
    this.zoom = Math.max(0, Math.min(ZOOMS.length - 1, this.zoom + (e.deltaY < 0 ? 1 : -1)));
    // Keep the point under the cursor where it was.
    const after = this.toWorld(p.x, p.y);
    this.cx += before.x - after.x;
    this.cy += before.y - after.y;
    this.draw();
  }

  draw(): void {
    const c = this.canvas;
    const w = Math.max(1, Math.floor(c.clientWidth));
    const hgt = Math.max(1, Math.floor(c.clientHeight));
    if (c.width !== w || c.height !== hgt) {
      c.width = w;
      c.height = hgt;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0b0a09';
    ctx.fillRect(0, 0, w, hgt);
    this.drawGround(ctx, w, hgt);
    this.drawMarkers(ctx);
    this.footer.textContent = this.footerText();
  }

  /** Seen cells only; the rest stays dark (fog of war). */
  private drawGround(ctx: CanvasRenderingContext2D, w: number, hgt: number): void {
    const { sim, terrain } = this.o;
    const tl = this.toWorld(0, 0);
    const br = this.toWorld(w, hgt);
    const span = CHUNK * TILE;
    const cell = CELL_TILES * this.scale;
    for (let cy = Math.floor(tl.y / span); cy <= Math.floor(br.y / span); cy++) {
      for (let cx = Math.floor(tl.x / span); cx <= Math.floor(br.x / span); cx++) {
        const mask = sim.state.explored[chunkKey(cx, cy)] ?? 0;
        if (mask === 0) continue;
        const img = terrain.chunk(sim, cx, cy);
        const origin = this.toScreen(cx * span, cy * span);
        for (let bit = 0; bit < CELLS_PER_CHUNK * CELLS_PER_CHUNK; bit++) {
          if ((mask & (1 << bit)) === 0) continue;
          const lx = bit % CELLS_PER_CHUNK;
          const ly = Math.floor(bit / CELLS_PER_CHUNK);
          ctx.drawImage(
            img,
            lx * CELL_TILES,
            ly * CELL_TILES,
            CELL_TILES,
            CELL_TILES,
            Math.round(origin.x + lx * cell),
            Math.round(origin.y + ly * cell),
            cell,
            cell,
          );
        }
      }
    }
  }

  private drawMarkers(ctx: CanvasRenderingContext2D): void {
    const { sim } = this.o;
    const labels = this.scale >= 2;
    for (const l of Object.values(sim.state.landmarks)) {
      const s = this.toScreen(l.x, l.y);
      const style = LANDMARK_STYLE[l.kind];
      diamond(ctx, s.x, s.y, l.kind === 'village' ? 6 : 4, style.color);
      if (labels && (l.kind === 'village' || l.kind === 'shrine'))
        label(ctx, l.name, s.x, s.y - 9, style.color);
    }
    for (const b of Object.values(sim.state.bonfires)) {
      const s = this.toScreen(b.x, b.y);
      flame(ctx, s.x, s.y);
    }
    if (sim.state.lastDeath) {
      const s = this.toScreen(sim.state.lastDeath.x, sim.state.lastDeath.y);
      cross(ctx, s.x, s.y, '#e05a4a');
      if (labels) label(ctx, 'Died here', s.x, s.y - 9, '#e05a4a');
    }
    if (this.pin) {
      const s = this.toScreen(this.pin.x, this.pin.y);
      pinMark(ctx, s.x, s.y);
    }
    const pb = sim.ecs.get(sim.player, Body);
    if (pb) {
      const s = this.toScreen(pb.x, pb.y);
      const a = sim.ecs.get(sim.player, Abilities);
      const color = a
        ? `#${classPalette(sim.content, a.class).base.toString(16).padStart(6, '0')}`
        : '#ffffff';
      const [fx, fy] = DIR_VEC[sim.ecs.get(sim.player, Facing)?.dir ?? 'down'];
      arrow(ctx, s.x, s.y, fx, fy, color);
    }
  }

  private footerText(): string {
    const pb = this.o.sim.ecs.get(this.o.sim.player, Body);
    const at = (p: { x: number; y: number }) => `${Math.floor(p.x / TILE)}, ${Math.floor(p.y / TILE)}`;
    const parts = [
      pb ? `You: ${at(pb)}` : '',
      this.cursor ? `Cursor: ${at(this.cursor)}` : '',
      'Drag to move · scroll to zoom · click to place or remove your pin',
    ];
    return parts.filter(Boolean).join('   ·   ');
  }
}

function legend(): HTMLElement {
  const row = (swatch: string, text: string) =>
    h('li', {}, h('span', { class: 'swatch', textContent: swatch }), text);
  return h(
    'ul',
    { class: 'map-legend' },
    row('▲', 'You'),
    row('✦', 'Bonfire'),
    ...Object.values(LANDMARK_STYLE).map((s) => {
      const li = row('◆', s.label);
      const sw = li.querySelector('.swatch');
      if (sw instanceof HTMLElement) sw.style.color = s.color;
      return li;
    }),
    row('✕', 'Where you died'),
    row('●', 'Your pin'),
  );
}

// ------------------------------------------------------------------ marker shapes

function diamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
}

function flame(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, 4, 0, Math.PI * 2);
  ctx.fillStyle = '#ff9a30';
  ctx.fill();
  ctx.strokeStyle = '#3a1a00';
  ctx.stroke();
  ctx.fillStyle = '#ffe0a0';
  ctx.fillRect(Math.round(x) - 1, Math.round(y) - 2, 2, 3);
}

function cross(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 4, y - 4);
  ctx.lineTo(x + 4, y + 4);
  ctx.moveTo(x + 4, y - 4);
  ctx.lineTo(x - 4, y + 4);
  ctx.stroke();
  ctx.lineWidth = 1;
}

function pinMark(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = '#f0b866';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y - 9);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y - 11, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = '#f0b866';
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

function arrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fx: number,
  fy: number,
  color: string,
): void {
  const len = Math.hypot(fx, fy) || 1;
  const ux = fx / len;
  const uy = fy / len;
  ctx.beginPath();
  ctx.moveTo(x + ux * 7, y + uy * 7);
  ctx.lineTo(x - ux * 4 - uy * 5, y - uy * 4 + ux * 5);
  ctx.lineTo(x - ux * 4 + uy * 5, y - uy * 4 - ux * 5);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.stroke();
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.font = '12px "EB Garamond", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.lineWidth = 1;
}
