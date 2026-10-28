import { Container, Sprite } from 'pixi.js';
import type { Assets } from '../assets';

const GLYPH_ADVANCE = 4;

/**
 * Crisp bitmap text from the `font` sheet (digits and a few symbols), with a
 * 1px drop shadow for legibility over any terrain.
 */
export class PixelText extends Container {
  private current = '';

  constructor(
    private readonly assets: Assets,
    private color = 0xffffff,
  ) {
    super();
  }

  get text(): string {
    return this.current;
  }

  get pixelWidth(): number {
    return this.current.length * GLYPH_ADVANCE - 1;
  }

  set(text: string, color = this.color): this {
    if (text === this.current && color === this.color) return this;
    this.current = text;
    this.color = color;
    for (const child of this.removeChildren()) child.destroy();
    const font = this.assets.sheet('font');
    [...text].forEach((ch, i) => {
      const tex = font?.named.get(ch);
      if (!tex) return;
      const shadow = new Sprite(tex);
      shadow.tint = 0x000000;
      shadow.position.set(i * GLYPH_ADVANCE + 1, 1);
      const glyph = new Sprite(tex);
      glyph.tint = color;
      glyph.position.set(i * GLYPH_ADVANCE, 0);
      this.addChild(shadow, glyph);
    });
    return this;
  }
}
