/**
 * How big the game view is and how much it is scaled, for a window size. Pure,
 * so the edge cases (tiny or zero-size windows) are unit-tested.
 */

/** The base view: what the game was composed for. Pixel-perfect mode always shows exactly this. */
export const VIEW_W = 384;
export const VIEW_H = 216;
/**
 * The most a filled view may show. The world is only loaded a chunk or so around the player,
 * so a bigger view would reveal its unloaded edges (and make enemies easier to see coming).
 */
export const MAX_VIEW_W = 512;
export const MAX_VIEW_H = 288;

export interface ViewSize {
  /** The view in game pixels. */
  w: number;
  h: number;
  /** Screen pixels per game pixel: a whole number from 2x up, so every pixel is the same size. */
  scale: number;
}

/**
 * The view for a window. In fill mode the view grows to the window's shape (up to the cap)
 * instead of leaving black borders. Returns null for a window with no size yet (a hidden or
 * minimized tab, a pane still opening), so the caller keeps the view it had.
 */
export function viewFor(windowW: number, windowH: number, fill: boolean): ViewSize | null {
  if (!(windowW > 0 && windowH > 0)) return null;
  const fit = Math.min(windowW / VIEW_W, windowH / VIEW_H);
  const scale = fit >= 2 ? Math.floor(fit) : fit;
  if (!fill) return { w: VIEW_W, h: VIEW_H, scale };
  return {
    w: Math.min(MAX_VIEW_W, Math.ceil(windowW / scale)),
    h: Math.min(MAX_VIEW_H, Math.ceil(windowH / scale)),
    scale,
  };
}
