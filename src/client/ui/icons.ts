import type { FrameRect } from '../assets';
import { h } from './dom';

/**
 * A sprite-sheet frame as a DOM element, drawn by CSS from the sheet's PNG, so menus
 * show the same art as the game without a second set of image files.
 */
export function iconElement(rect: FrameRect | undefined, scale = 2): HTMLElement {
  const el = h('span', { class: 'icon' });
  if (!rect) return el;
  const s = el.style;
  s.width = `${rect.w * scale}px`;
  s.height = `${rect.h * scale}px`;
  s.backgroundImage = `url("${rect.url}")`;
  s.backgroundPosition = `${-rect.x * scale}px ${-rect.y * scale}px`;
  s.backgroundSize = `${rect.sheetW * scale}px ${rect.sheetH * scale}px`;
  return el;
}

/**
 * A grayscale glyph (class sigils, ability icons) tinted with a color, like Pixi's tint on the
 * HUD: the glyph multiplies the color, then is masked to its own shape so the transparent
 * area stays clear. Keeps the icons' shading while letting content pick the color.
 */
export function tintedIcon(rect: FrameRect | undefined, color: string, scale = 2): HTMLElement {
  const el = iconElement(rect, scale);
  if (!rect) return el;
  const s = el.style;
  s.backgroundColor = color;
  s.backgroundBlendMode = 'multiply';
  s.maskImage = `url("${rect.url}")`;
  s.maskPosition = s.backgroundPosition;
  s.maskSize = s.backgroundSize;
  s.maskRepeat = 'no-repeat';
  return el;
}
