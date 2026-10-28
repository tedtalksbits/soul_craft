/** A tiny RGBA raster for drawing placeholder pixel art in Node. */
import { PNG } from 'pngjs';

export type RGBA = readonly [number, number, number, number];

export function hex(s: string, a = 255): RGBA {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Multiplies RGB by `k` (lighten > 1, darken < 1). */
export function shade(c: RGBA, k: number): RGBA {
  return [byte(c[0] * k), byte(c[1] * k), byte(c[2] * k), c[3]];
}

export function withAlpha(c: RGBA, a: number): RGBA {
  return [c[0], c[1], c[2], byte(a * 255)];
}

export class Sheet {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4);
  }

  /** A drawing surface for one grid cell. */
  frame(index: number, fw: number, fh: number): Surface {
    const cols = Math.floor(this.width / fw);
    return new Surface(this, (index % cols) * fw, Math.floor(index / cols) * fh, fw, fh);
  }

  toPNG(): Buffer {
    const png = new PNG({ width: this.width, height: this.height });
    png.data = Buffer.from(this.data);
    return PNG.sync.write(png);
  }
}

/** A clipped window into a Sheet. All drawing is integer pixels with src-over blending. */
export class Surface {
  constructor(
    private readonly sheet: Sheet,
    private readonly ox: number,
    private readonly oy: number,
    readonly w: number,
    readonly h: number,
  ) {}

  px(x: number, y: number, c: RGBA): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= this.w || iy >= this.h || c[3] === 0) return;
    const i = ((this.oy + iy) * this.sheet.width + this.ox + ix) * 4;
    const d = this.sheet.data;
    const a = c[3] / 255;
    if (a >= 1) {
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
      return;
    }
    const da = (d[i + 3] ?? 0) / 255;
    const out = a + da * (1 - a);
    for (let k = 0; k < 3; k++) d[i + k] = byte((c[k]! * a + (d[i + k] ?? 0) * da * (1 - a)) / (out || 1));
    d[i + 3] = byte(out * 255);
  }

  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    for (let yy = 0; yy < Math.round(h); yy++)
      for (let xx = 0; xx < Math.round(w); xx++) this.px(x0 + xx, y0 + yy, c);
  }

  /** Filled ellipse. `half: 'top'` draws only the upper half (mushroom caps). */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA, half?: 'top'): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      if (half === 'top' && y + 0.5 > cy) continue;
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.px(x, y, c);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, c: RGBA): void {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
}
