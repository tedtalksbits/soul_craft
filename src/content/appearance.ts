import { z } from 'zod';

export const AppearanceSchema = z.object({
  skin: z.enum(['fair', 'warm', 'brown', 'deep']).default('warm'),
  hair: z.enum(['bald', 'short', 'swept']).default('short'),
  hairColor: z.enum(['black', 'brown', 'auburn', 'blond', 'silver']).default('brown'),
  beard: z.boolean().default(false),
  hideHelmet: z.boolean().default(false),
  prototype: z.boolean().default(true),
});
export type AppearanceDef = z.infer<typeof AppearanceSchema>;
export const DEFAULT_APPEARANCE = AppearanceSchema.parse({});
