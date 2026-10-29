import { describe, expect, it } from 'vitest';
import { MAX_VIEW_H, MAX_VIEW_W, VIEW_H, VIEW_W, viewFor } from '../../src/client/render/view-size';

describe('view size', () => {
  it('fills a browser window at a whole-number scale, with no black borders', () => {
    const v = viewFor(1920, 969, true);
    expect(v).toEqual({ w: 480, h: 243, scale: 4 });
    expect(v && v.w * v.scale).toBeGreaterThanOrEqual(1920);
    expect(v && v.h * v.scale).toBeGreaterThanOrEqual(969);
  });

  it('never shows more than the cap, however big the window', () => {
    const v = viewFor(5000, 3000, true);
    expect(v?.w).toBeLessThanOrEqual(MAX_VIEW_W);
    expect(v?.h).toBeLessThanOrEqual(MAX_VIEW_H);
  });

  it('keeps the base view with borders in pixel-perfect mode', () => {
    expect(viewFor(1920, 969, false)).toEqual({ w: VIEW_W, h: VIEW_H, scale: 4 });
  });

  it('ignores a window with no size yet, instead of producing NaN', () => {
    expect(viewFor(0, 0, true)).toBeNull();
    expect(viewFor(0, 768, false)).toBeNull();
  });
});
