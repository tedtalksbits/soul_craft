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
