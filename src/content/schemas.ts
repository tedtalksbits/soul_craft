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

// ------------------------------------------------------------------ classes & abilities

/** The three ability slots, on F / C / V. Supers spend energy; the others have cooldowns. */
export const AbilitySlotSchema = z.enum(['aoe', 'class', 'super']);
export type AbilitySlot = z.infer<typeof AbilitySlotSchema>;
export const ABILITY_SLOTS: readonly AbilitySlot[] = AbilitySlotSchema.options;

/** `self` centres on the player; `aim` lands at the cursor, at most `range` px away. */
const AbilityTargetSchema = z.enum(['self', 'aim']);

/**
 * The building blocks every ability is made of. A kit is just a list of these,
 * applied at the cast's release tick, so new abilities need no code.
 */
export const AbilityEffectSchema = z.discriminatedUnion('type', [
  /** A hit on everything in a circle, after an optional fuse. Unblockable: shields don't stop it. */
  z.object({
    type: z.literal('blast'),
    at: AbilityTargetSchema,
    range: nonneg.default(0),
    radius: pos,
    damage: nonneg,
    knockback: nonneg,
    /** Ticks the enemies hit are staggered (stopped, guard broken). */
    stagger: ticks,
    fuse: ticks.default(0),
  }),
  /** Ground that hurts whatever stands in it, every `interval` ticks for `duration` ticks. */
  z.object({
    type: z.literal('zone'),
    at: AbilityTargetSchema,
    range: nonneg.default(0),
    radius: pos,
    delay: ticks.default(0),
    duration: ticks,
    interval: ticks.refine((n) => n > 0, 'interval must be at least 1 tick'),
    damage: pos,
  }),
  /** A lunge along the aim. Hits (once each) what the player passes through. */
  z.object({
    type: z.literal('dash'),
    distance: pos,
    ticks: ticks.refine((n) => n > 0, 'a dash needs at least 1 tick'),
    iframes: z.boolean(),
    width: pos,
    damage: nonneg,
    knockback: nonneg,
    stagger: ticks,
  }),
  /** A timed super mode. Fractions are bonuses: damage 0.6 = +60%, defense 0.5 = half damage taken. */
  z.object({
    type: z.literal('empower'),
    seconds: pos,
    damage: nonneg,
    defense: fraction,
    crit: fraction,
    staminaFree: z.boolean(),
  }),
]);
export type AbilityEffect = z.infer<typeof AbilityEffectSchema>;

export const AbilitySchema = z
  .object({
    name: z.string(),
    description: z.string(),
    slot: AbilitySlotSchema,
    /** Seconds between uses. Supers ignore it: they spend a full energy bar instead. */
    cooldown: nonneg.default(0),
    /** The player is locked for `ticks`; the effects land on tick `release`. */
    cast: z.object({ ticks: ticks, release: ticks }),
    effects: z.array(AbilityEffectSchema).min(1),
  })
  .refine((a) => a.cast.release < a.cast.ticks, 'cast.release must come before the cast ends')
  .refine((a) => a.slot === 'super' || a.cooldown > 0, 'AoE and class abilities need a cooldown');
export type AbilityDef = z.infer<typeof AbilitySchema>;
export const AbilitiesSchema = z.record(z.string(), AbilitySchema);

export const ClassSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** The class's colour in ability effects and the HUD. */
  color,
  abilities: z.object({ aoe: z.string(), class: z.string(), super: z.string() }),
});
export type ClassDef = z.infer<typeof ClassSchema>;
export const ClassesSchema = z.record(z.string(), ClassSchema);

// ------------------------------------------------------------------ items & crafting

/** Crafting stations placed in the world. Recipes with `station: null` can be crafted anywhere. */
export const STATIONS = { forge: 'Forge', alchemy: 'Alchemy table' } as const;
export const StationSchema = z.enum(['forge', 'alchemy']);
export type StationId = z.infer<typeof StationSchema>;

export const ItemCountSchema = z.object({ item: z.string(), count: z.number().int().min(1) });
export type ItemCount = z.infer<typeof ItemCountSchema>;

const itemBase = {
  name: z.string(),
  description: z.string(),
  /** Frame name in the `items` sprite sheet. */
  icon: z.string(),
  /** Most of this item one inventory slot holds. */
  stack: z.number().int().min(1),
};

/** Stats a buff or ring can change. Values are additive fractions (0.2 = +20%) except maxHp (points). */
export const StatSchema = z.enum(['damage', 'defense', 'staminaRegen', 'maxHp']);
export type StatId = z.infer<typeof StatSchema>;

export const ItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('material'), ...itemBase }),
  z.object({
    kind: z.literal('weapon'),
    ...itemBase,
    weapon: z.object({ damage: pos, staminaCost: nonneg, reach: pos, width: pos, knockback: nonneg }),
    /** Forge upgrades, in order: each adds `damage` and costs souls plus items. */
    upgrades: z
      .array(
        z.object({ damage: pos, souls: z.number().int().nonnegative(), items: z.array(ItemCountSchema) }),
      )
      .default([]),
  }),
  z.object({
    kind: z.literal('armor'),
    ...itemBase,
    armor: z.object({ defense: z.number().min(0).max(0.9) }),
  }),
  z.object({
    kind: z.literal('ring'),
    ...itemBase,
    ring: z.object({ stat: StatSchema, amount: pos }),
  }),
  z.object({
    kind: z.literal('consumable'),
    ...itemBase,
    effect: z.discriminatedUnion('type', [
      z.object({ type: z.literal('heal'), amount: pos }),
      z.object({ type: z.literal('buff'), stat: StatSchema, amount: pos, seconds: pos }),
    ]),
  }),
]);
export type ItemDef = z.infer<typeof ItemSchema>;
export type ItemKind = ItemDef['kind'];
export const ItemsSchema = z.record(z.string(), ItemSchema);

export const RecipeSchema = z.object({
  output: z.object({ item: z.string(), count: z.number().int().min(1).default(1) }),
  inputs: z.array(ItemCountSchema).min(1),
  souls: z.number().int().nonnegative(),
  /** Where it can be crafted; null means anywhere. */
  station: StationSchema.nullable(),
});
export type RecipeDef = z.infer<typeof RecipeSchema>;
export const RecipesSchema = z.record(z.string(), RecipeSchema);

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
  /** Swing timing and rolls. Damage, reach and stamina cost come from the equipped weapon. */
  attack: z.object({
    variance: fraction,
    critChance: fraction,
    critMultiplier: z.number().min(1),
    duration: ticks,
    activeFrom: ticks,
    activeTo: ticks,
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
  /**
   * Loot within `radius` px flies to the player once it has landed. The pull starts at
   * `speed` px/tick and gains `accel` each tick up to `maxSpeed`. Radius 0 turns it off.
   */
  magnet: z.object({ radius: nonneg, speed: pos, accel: nonneg, maxSpeed: pos }),
  /** How many different stacks the player can carry. */
  inventorySlots: z.number().int().min(1),
  /** A new game starts as this class, with this weapon equipped and these items carried. */
  start: z.object({ class: z.string(), weapon: z.string(), items: z.array(ItemCountSchema).default([]) }),
  /** Super energy, 0-100. Full charges the super; sword and ability hits fill it, the super's own hits don't. */
  energy: z.object({ perDamage: nonneg, perKill: nonneg, perSecond: nonneg }),
});
export type PlayerDef = z.infer<typeof PlayerSchema>;

// ------------------------------------------------------------------ loot

/** A pickup that may spawn when something dies or a tile is cut. */
export const DropSchema = z
  .object({
    kind: z.enum(['souls', 'ember', 'item']),
    /** Required for `item` drops: the item id. */
    item: z.string().optional(),
    chance: fraction,
    amount: range,
  })
  .refine(
    (d) => (d.kind === 'item') === (d.item !== undefined),
    'an item drop needs `item`, other drops must not set it',
  );
export type DropDef = z.infer<typeof DropSchema>;

// ------------------------------------------------------------------ enemies

const BrainSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hopper'),
    /** Ticks squashed in place before each hop: the tell that a hop is coming. */
    crouchTicks: ticks,
    hopSpeed: pos,
    hopTicks: ticks,
    hopCooldown: range,
  }),
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
    /** Recovery after each shot: the bow comes down before the archer moves again. */
    looseTicks: ticks,
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
  z.object({ kind: z.literal('station'), station: StationSchema }),
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
