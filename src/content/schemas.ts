/**
 * Schemas for every file under /content. These are the contract between
 * designers editing JSON and the simulation reading it; types are inferred
 * from them so the two cannot drift apart.
 */
import { z } from 'zod';

const pos = z.number().positive();
const nonneg = z.number().nonnegative();
const ticks = z.number().int().nonnegative();
const fraction = z.number().min(0).max(1);
/** Inclusive `[min, max]`. */
const range = z.tuple([z.number(), z.number()]).refine(([a, b]) => a <= b, 'range min must be <= max');
const size = z.object({ w: pos, h: pos });
const weighted = <T extends z.ZodType>(item: T) => z.array(z.tuple([item, pos])).min(1);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected a #rrggbb colour');

// ------------------------------------------------------------------ player

export const PlayerSchema = z.object({
  sprite: z.string(),
  body: size,
  maxHp: pos,
  maxStamina: pos,
  staminaRegen: pos,
  staminaRegenDelay: ticks,
  moveSpeed: pos,
  interactRange: pos,
  /** How far (px) the player is nudged around a corner it clips while walking straight. 0 disables. */
  cornerSlide: nonneg,
  attack: z.object({
    damage: pos,
    variance: fraction,
    critChance: fraction,
    critMultiplier: z.number().min(1),
    staminaCost: nonneg,
    duration: ticks,
    activeFrom: ticks,
    activeTo: ticks,
    reach: pos,
    width: pos,
    knockback: nonneg,
    hitstop: ticks,
  }),
  roll: z.object({
    staminaCost: nonneg,
    minStamina: nonneg,
    duration: ticks,
    iframesFrom: ticks,
    iframesTo: ticks,
    speed: pos,
  }),
  flask: z.object({ charges: z.number().int().min(0), heal: pos, duration: ticks, healAt: ticks }),
  hurt: z.object({ iframes: ticks, stun: ticks, knockback: nonneg }),
  death: z.object({ soulPenalty: fraction, respawnDelay: ticks }),
});
export type PlayerDef = z.infer<typeof PlayerSchema>;

// ------------------------------------------------------------------ loot

/** A pickup that may spawn when something dies or a tile is cut. */
export const DropSchema = z.object({
  kind: z.enum(['souls', 'ember']),
  chance: fraction,
  amount: range,
});
export type DropDef = z.infer<typeof DropSchema>;

// ------------------------------------------------------------------ enemies

const BrainSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hopper'), hopSpeed: pos, hopTicks: ticks, hopCooldown: range }),
  z.object({
    type: z.literal('lunger'),
    range: pos,
    windupTicks: ticks,
    lungeSpeed: pos,
    lungeTicks: ticks,
    lungeDamage: pos,
    cooldown: ticks,
  }),
  z.object({
    type: z.literal('archer'),
    preferredRange: range,
    drawTicks: ticks,
    cooldown: range,
    arrowSpeed: pos,
    arrowDamage: pos,
  }),
  z.object({
    type: z.literal('shieldKnight'),
    chargeRange: pos,
    windupTicks: ticks,
    chargeSpeed: pos,
    chargeTicks: ticks,
    chargeDamage: pos,
    stunTicks: ticks,
    cooldown: ticks,
  }),
]);
export type BrainDef = z.infer<typeof BrainSchema>;
export type BrainType = BrainDef['type'];

export const EnemySchema = z.object({
  name: z.string(),
  sprite: z.string(),
  body: size,
  hp: pos,
  speed: nonneg,
  aggroRange: pos,
  contactDamage: nonneg,
  /** Souls awarded straight to the player on kill. */
  souls: z.number().int().nonnegative(),
  /** Pickups scattered on death. */
  drops: z.array(DropSchema).default([]),
  recoilTicks: ticks,
  /** Multiplier on knockback received. 0 = immovable. */
  knockbackTaken: nonneg,
  brain: BrainSchema,
});
export type EnemyDef = z.infer<typeof EnemySchema>;
export const EnemiesSchema = z.record(z.string(), EnemySchema);

// ------------------------------------------------------------------ tiles

export const TileSchema = z.object({
  id: z.string(),
  /** Frame names in the `tiles` sprite sheet; a variant is picked per tile position. */
  frames: z.array(z.string()).min(1),
  solid: z.boolean().default(false),
  /** The frame has transparency and is drawn over the local biome's ground (trees, rocks). */
  overlay: z.boolean().default(false),
  /** Defaults to `solid`. Water is solid to walkers but arrows fly over it. */
  blocksProjectiles: z.boolean().optional(),
  /**
   * Tiles a sword can cut down: tall grass, trees, mushrooms. It breaks after `hits` swings and
   * becomes `into`, or the local biome's ground when omitted (so a tree leaves the right floor in
   * any biome). Partial damage is remembered per tile.
   */
  cut: z
    .object({
      hits: z.number().int().min(1).default(1),
      into: z.string().optional(),
      drops: z.array(DropSchema).default([]),
    })
    .optional(),
  light: z.object({ radius: pos, intensity: fraction }).optional(),
  /** Colour on the world map and minimap. */
  map: color,
});
export type TileDef = z.infer<typeof TileSchema>;
export const TilesSchema = z.array(TileSchema).min(1);

// ------------------------------------------------------------------ biomes & world

export const BiomeSchema = z.object({
  name: z.string(),
  ground: weighted(z.string()),
  scatter: z
    .array(z.object({ tile: z.string(), scale: pos, threshold: fraction, chance: fraction }))
    .default([]),
  darkness: fraction,
  ambient: z.enum(['none', 'ash', 'spores', 'mist']),
  spawns: z.object({ perChunk: nonneg, table: weighted(z.string()) }),
});
export type BiomeDef = z.infer<typeof BiomeSchema>;
export const BiomesSchema = z.record(z.string(), BiomeSchema);

export const WorldSchema = z.object({
  terrain: z.object({
    climateScale: pos,
    elevationScale: pos,
    lakeLevel: fraction,
    riverScale: pos,
    riverWidth: fraction,
    fordScale: pos,
    fordThreshold: fraction,
    shoreWidth: fraction,
    waterTile: z.string(),
    shallowTile: z.string(),
  }),
  /** First matching rule wins; a rule with no ranges is the fallback. */
  biomeRules: z
    .array(z.object({ biome: z.string(), moisture: range.optional(), temperature: range.optional() }))
    .min(1),
  /**
   * The starting area: `prefab` is centred on tile (0, 0); no water, scattered
   * prefabs or enemy spawns within `safeRadius` tiles; `biome` (if set) is
   * forced within twice that radius so every seed starts somewhere readable.
   */
  origin: z.object({ prefab: z.string(), safeRadius: nonneg, biome: z.string().optional() }),
  regions: z.object({ sizeChunks: z.number().int().min(1), prefabs: weighted(z.string().nullable()) }),
});
export type WorldDef = z.infer<typeof WorldSchema>;

// ------------------------------------------------------------------ prefabs

export const PrefabEntitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('bonfire'), name: z.string() }),
  z.object({ kind: z.literal('sign'), lines: z.array(z.string()).min(1) }),
  z.object({ kind: z.literal('enemy'), archetype: z.string() }),
  z.object({ kind: z.literal('torch') }),
  z.object({ kind: z.literal('playerSpawn') }),
]);
export type PrefabEntityDef = z.infer<typeof PrefabEntitySchema>;

export const PrefabSchema = z
  .object({
    /** Shown when the player walks in. Omit for unnamed set pieces. */
    name: z.string().optional(),
    darkness: fraction.optional(),
    /** Biomes this prefab may be placed in by region scattering. Omit for anywhere. */
    biomes: z.array(z.string()).optional(),
    legend: z.record(
      z.string().length(1),
      z.object({ tile: z.string().optional(), entity: PrefabEntitySchema.optional() }),
    ),
    rows: z.array(z.string()).min(1),
  })
  .superRefine((p, ctx) => {
    const width = p.rows[0]?.length ?? 0;
    p.rows.forEach((row, y) => {
      if (row.length !== width)
        ctx.addIssue({ code: 'custom', message: `row ${y} is ${row.length} wide, expected ${width}` });
      for (const ch of row) {
        if (ch !== ' ' && !(ch in p.legend))
          ctx.addIssue({ code: 'custom', message: `row ${y}: "${ch}" is not in the legend` });
      }
    });
  });
export type PrefabDef = z.infer<typeof PrefabSchema>;

// ------------------------------------------------------------------ scenarios

export const ScenarioSchema = z.object({
  description: z.string(),
  seed: z.number().int().optional(),
  /** Console commands run in order once the world is ready. */
  commands: z.array(z.string()).default([]),
});
export type ScenarioDef = z.infer<typeof ScenarioSchema>;
