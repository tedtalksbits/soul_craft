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
  /** Named single frames, e.g. tile variants. */
  frames: z.record(z.string(), z.number().int().nonnegative()).default({}),
  animations: z
    .record(
      z.string(),
      z.object({
        frames: z.array(frameRef).min(1),
        fps: z.number().positive(),
        loop: z.boolean().default(true),
      }),
    )
    .default({}),
});
export type SpriteSheetDef = z.infer<typeof SpriteSheetSchema>;
