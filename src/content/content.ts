/**
 * Validated, cross-referenced game content.
 *
 * `buildContent` takes the raw JSON files (keyed by path relative to
 * /content) and either returns a fully checked `Content` or throws a
 * `ContentError` listing every problem at once. The browser feeds it from
 * Vite's glob import, tests and scripts from the filesystem.
 */
import type { z } from 'zod';
import {
  BiomesSchema,
  EnemiesSchema,
  PlayerSchema,
  PrefabSchema,
  ScenarioSchema,
  TilesSchema,
  WorldSchema,
  type BiomeDef,
  type EnemyDef,
  type PlayerDef,
  type PrefabDef,
  type ScenarioDef,
  type TileDef,
  type WorldDef,
} from './schemas';

/** Raw parsed JSON keyed by path relative to /content, e.g. `prefabs/wayshrine.json`. */
export type ContentFiles = Readonly<Record<string, unknown>>;

export class ContentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid content:\n  - ${problems.join('\n  - ')}`);
  }
}

const SINGLE_FILES = {
  'player.json': PlayerSchema,
  'enemies.json': EnemiesSchema,
  'tiles.json': TilesSchema,
  'biomes.json': BiomesSchema,
  'world.json': WorldSchema,
} as const;

const DIRECTORIES = {
  prefabs: PrefabSchema,
  scenarios: ScenarioSchema,
} as const;

export class Content {
  readonly tileIndex: ReadonlyMap<string, number>;

  constructor(
    readonly files: ContentFiles,
    readonly player: PlayerDef,
    readonly enemies: Readonly<Record<string, EnemyDef>>,
    readonly tiles: readonly TileDef[],
    readonly biomes: Readonly<Record<string, BiomeDef>>,
    readonly world: WorldDef,
    readonly prefabs: Readonly<Record<string, PrefabDef>>,
    readonly scenarios: Readonly<Record<string, ScenarioDef>>,
  ) {
    this.tileIndex = new Map(tiles.map((t, i) => [t.id, i]));
  }

  /** Numeric id used in chunk tile arrays. */
  tileId(key: string): number {
    const id = this.tileIndex.get(key);
    if (id === undefined) throw new Error(`Unknown tile "${key}"`);
    return id;
  }

  tile(id: number): TileDef {
    const def = this.tiles[id];
    if (!def) throw new Error(`Unknown tile id ${id}`);
    return def;
  }

  enemy(archetype: string): EnemyDef {
    const def = this.enemies[archetype];
    if (!def) throw new Error(`Unknown enemy archetype "${archetype}"`);
    return def;
  }
}

export function buildContent(files: ContentFiles): Content {
  const problems: string[] = [];

  const parse = <S extends z.ZodType>(path: string, schema: S): z.infer<S> | undefined => {
    if (!(path in files)) {
      problems.push(`${path}: file is missing`);
      return undefined;
    }
    const result = schema.safeParse(files[path]);
    if (!result.success) {
      for (const issue of result.error.issues) {
        problems.push(`${path}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
      }
      return undefined;
    }
    return result.data;
  };

  const parseDir = <S extends z.ZodType>(dir: string, schema: S): Record<string, z.infer<S>> => {
    const out: Record<string, z.infer<S>> = {};
    for (const path of Object.keys(files).sort()) {
      const m = new RegExp(`^${dir}/([a-z0-9_-]+)\\.json$`).exec(path);
      if (!m?.[1]) continue;
      const value = parse(path, schema);
      if (value !== undefined) out[m[1]] = value;
    }
    return out;
  };

  for (const path of Object.keys(files)) {
    const known =
      path in SINGLE_FILES ||
      Object.keys(DIRECTORIES).some((d) => new RegExp(`^${d}/[a-z0-9_-]+\\.json$`).test(path));
    if (!known) problems.push(`${path}: not a recognised content file (check the name and folder)`);
  }

  const player = parse('player.json', SINGLE_FILES['player.json']);
  const enemies = parse('enemies.json', SINGLE_FILES['enemies.json']);
  const tiles = parse('tiles.json', SINGLE_FILES['tiles.json']);
  const biomes = parse('biomes.json', SINGLE_FILES['biomes.json']);
  const world = parse('world.json', SINGLE_FILES['world.json']);
  const prefabs = parseDir('prefabs', DIRECTORIES.prefabs);
  const scenarios = parseDir('scenarios', DIRECTORIES.scenarios);

  if (!player || !enemies || !tiles || !biomes || !world) throw new ContentError(problems);

  checkReferences({ enemies, tiles, biomes, world, prefabs }, problems);
  if (problems.length > 0) throw new ContentError(problems);

  return new Content(files, player, enemies, tiles, biomes, world, prefabs, scenarios);
}

function checkReferences(
  c: {
    enemies: Record<string, EnemyDef>;
    tiles: TileDef[];
    biomes: Record<string, BiomeDef>;
    world: WorldDef;
    prefabs: Record<string, PrefabDef>;
  },
  problems: string[],
): void {
  const tileIds = new Set<string>();
  for (const t of c.tiles) {
    if (tileIds.has(t.id)) problems.push(`tiles.json: duplicate tile id "${t.id}"`);
    tileIds.add(t.id);
  }
  const tile = (where: string, id: string) => {
    if (!tileIds.has(id)) problems.push(`${where}: unknown tile "${id}"`);
  };
  const enemy = (where: string, id: string) => {
    if (!(id in c.enemies)) problems.push(`${where}: unknown enemy "${id}"`);
  };

  for (const t of c.tiles) if (t.cut?.into !== undefined) tile(`tiles.json: ${t.id}.cut.into`, t.cut.into);

  for (const [id, b] of Object.entries(c.biomes)) {
    for (const [g] of b.ground) tile(`biomes.json: ${id}.ground`, g);
    for (const s of b.scatter) tile(`biomes.json: ${id}.scatter`, s.tile);
    for (const [e] of b.spawns.table) enemy(`biomes.json: ${id}.spawns`, e);
  }

  const w = c.world;
  tile('world.json: terrain.waterTile', w.terrain.waterTile);
  tile('world.json: terrain.shallowTile', w.terrain.shallowTile);
  for (const r of w.biomeRules) {
    if (!(r.biome in c.biomes)) problems.push(`world.json: biomeRules: unknown biome "${r.biome}"`);
  }
  const last = w.biomeRules[w.biomeRules.length - 1];
  if (last && (last.moisture || last.temperature))
    problems.push('world.json: the last biome rule must have no ranges so every location gets a biome');
  if (w.origin.biome !== undefined && !(w.origin.biome in c.biomes))
    problems.push(`world.json: origin.biome: unknown biome "${w.origin.biome}"`);
  if (!(w.origin.prefab in c.prefabs))
    problems.push(`world.json: origin.prefab: unknown prefab "${w.origin.prefab}"`);
  for (const [p] of w.regions.prefabs) {
    if (p !== null && !(p in c.prefabs)) problems.push(`world.json: regions.prefabs: unknown prefab "${p}"`);
  }

  for (const [id, p] of Object.entries(c.prefabs)) {
    for (const [ch, entry] of Object.entries(p.legend)) {
      const where = `prefabs/${id}.json: legend "${ch}"`;
      if (entry.tile) tile(where, entry.tile);
      if (entry.entity?.kind === 'enemy') enemy(where, entry.entity.archetype);
    }
    for (const b of p.biomes ?? [])
      if (!(b in c.biomes)) problems.push(`prefabs/${id}.json: unknown biome "${b}"`);
  }
  const origin = c.prefabs[w.origin.prefab];
  if (origin && !Object.values(origin.legend).some((e) => e.entity?.kind === 'playerSpawn'))
    problems.push(`prefabs/${w.origin.prefab}.json: the origin prefab needs a playerSpawn marker`);
}
