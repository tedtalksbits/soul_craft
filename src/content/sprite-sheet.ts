/**
 * Format of `assets/sprites/<name>.json`, the sidecar describing a grid-based
 * PNG sprite sheet. Frames are numbered left to right, top to bottom. Kept
 * deliberately simple so any pixel editor can be used on the PNG.
 */
import { z } from 'zod';

const frameRef = z.union([z.number().int().nonnegative(), z.string()]);

export const SpriteSheetSchema = z.object({
  image: z.string(),
  frameWidth: z.number().int().positive(),
  frameHeight: z.number().int().positive(),
  /** Normalised pivot within a frame. `[0.5, 1]` puts it at the feet. */
  anchor: z.tuple([z.number(), z.number()]).default([0.5, 1]),
  /**
   * Named attachment points in pixels relative to the anchor (x right, y down), e.g. `swing`:
   * where the player's sword arc is centred. Lets art of any size line up with effects.
   */
  pivots: z.record(z.string(), z.tuple([z.number(), z.number()])).default({}),
  /** Named single frames, e.g. tile variants. */
  frames: z.record(z.string(), z.number().int().nonnegative()).default({}),
  animations: z
    .record(
      z.string(),
      z.object({
        frames: z.array(frameRef).min(1),
        fps: z.number().positive(),
        loop: z.boolean().default(true),
        /**
         * Pixel offset (x right, y down) added to the sprite's position for this animation.
         * Generators set it when they had to shift a pose to fit the frame (lying, rolling).
         */
        offset: z.tuple([z.number(), z.number()]).default([0, 0]),
      }),
    )
    .default({}),
});
/** A parsed sheet, defaults applied. */
export type SpriteSheetDef = z.infer<typeof SpriteSheetSchema>;
/** What a sheet file may contain (defaulted fields optional). Use when writing sheets. */
export type SpriteSheetFile = z.input<typeof SpriteSheetSchema>;
