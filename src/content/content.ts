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
  ABILITY_SLOTS,
  TIERS,
  AbilitiesSchema,
  BiomesSchema,
  ClassesSchema,
  RestorationsSchema,
  EnemiesSchema,
  ModifiersSchema,
  NpcsSchema,
  ObjectivesSchema,
  ItemsSchema,
  LootSchema,
  WeaponsSchema,
  PlayerSchema,
  PrefabSchema,
  RecipesSchema,
  ScenarioSchema,
  TilesSchema,
  WorldSchema,
  type AbilityDef,
  type BiomeDef,
  type ClassDef,
  type DropDef,
  type EnemyDef,
  type ItemCount,
  type ItemDef,
  type ItemKind,
  type LootDef,
  type WeaponsDef,
  type ModifierDef,
  type ModifierEffect,
  type ModifiersDef,
  type NpcDef,
  type ObjectiveDef,
  type PlayerDef,
  type PrefabDef,
  type RecipeDef,
  type RestorationDef,
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
  'items.json': ItemsSchema,
  'recipes.json': RecipesSchema,
  'abilities.json': AbilitiesSchema,
  'classes.json': ClassesSchema,
  'restoration.json': RestorationsSchema,
  'npcs.json': NpcsSchema,
  'modifiers.json': ModifiersSchema,
  'objectives.json': ObjectivesSchema,
  'loot.json': LootSchema,
  'weapons.json': WeaponsSchema,
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
    readonly items: Readonly<Record<string, ItemDef>>,
    readonly recipes: Readonly<Record<string, RecipeDef>>,
    readonly abilities: Readonly<Record<string, AbilityDef>>,
    readonly classes: Readonly<Record<string, ClassDef>>,
    readonly restoration: Readonly<Record<string, RestorationDef>>,
    readonly npcs: Readonly<Record<string, NpcDef>>,
    readonly modifiers: ModifiersDef,
    /** In the order they are offered. */
    readonly objectives: Readonly<Record<string, ObjectiveDef>>,
    readonly loot: LootDef,
    readonly weapons: WeaponsDef,
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

  ability(id: string): AbilityDef {
    const def = this.abilities[id];
    if (!def) throw new Error(`Unknown ability "${id}"`);
    return def;
  }

  /** A variant's base ability, else the ability itself: what icons and class colors are keyed by. */
  baseAbility(id: string): string {
    return this.abilities[id]?.variantOf ?? id;
  }

  modifier(id: string): ModifierDef {
    const def = this.modifiers.modifiers[id];
    if (!def) throw new Error(`Unknown modifier "${id}"`);
    return def;
  }

  playerClass(id: string): ClassDef {
    const def = this.classes[id];
    if (!def) throw new Error(`Unknown class "${id}"`);
    return def;
  }

  item(id: string): ItemDef {
    const def = this.items[id];
    if (!def) throw new Error(`Unknown item "${id}"`);
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
    if (!known) problems.push(`${path}: not a recognized content file (check the name and folder)`);
  }

  const player = parse('player.json', SINGLE_FILES['player.json']);
  const enemies = parse('enemies.json', SINGLE_FILES['enemies.json']);
  const tiles = parse('tiles.json', SINGLE_FILES['tiles.json']);
  const biomes = parse('biomes.json', SINGLE_FILES['biomes.json']);
  const world = parse('world.json', SINGLE_FILES['world.json']);
  const items = parse('items.json', SINGLE_FILES['items.json']);
  const recipes = parse('recipes.json', SINGLE_FILES['recipes.json']);
  const abilities = parse('abilities.json', SINGLE_FILES['abilities.json']);
  const classes = parse('classes.json', SINGLE_FILES['classes.json']);
  const restoration = parse('restoration.json', SINGLE_FILES['restoration.json']);
  const npcs = parse('npcs.json', SINGLE_FILES['npcs.json']);
  const modifiers = parse('modifiers.json', SINGLE_FILES['modifiers.json']);
  const objectives = parse('objectives.json', SINGLE_FILES['objectives.json']);
  const loot = parse('loot.json', SINGLE_FILES['loot.json']);
  const weapons = parse('weapons.json', SINGLE_FILES['weapons.json']);
  const prefabs = parseDir('prefabs', DIRECTORIES.prefabs);
  const scenarios = parseDir('scenarios', DIRECTORIES.scenarios);

  if (
    !player ||
    !enemies ||
    !tiles ||
    !biomes ||
    !world ||
    !items ||
    !recipes ||
    !abilities ||
    !classes ||
    !restoration ||
    !npcs ||
    !modifiers ||
    !objectives ||
    !loot ||
    !weapons
  )
    throw new ContentError(problems);

  checkReferences({ enemies, tiles, biomes, world, prefabs }, problems);
  checkItems({ player, enemies, tiles, items, recipes }, problems);
  for (let i = 1; i < player.power.gap.length; i++)
    if (player.power.gap[i]![0] <= player.power.gap[i - 1]![0])
      problems.push('player.json: power.gap: rows must rise by gap');
  checkGear({ player, enemies, biomes, items, loot, abilities, classes }, problems);
  checkWeapons({ weapons, classes, loot }, problems);
  checkClasses({ player, abilities, classes }, problems);
  checkModifiers({ enemies, abilities, classes, modifiers }, problems);
  checkRestoration({ items, prefabs, restoration }, problems);
  checkObjectives({ items, enemies, prefabs, restoration, npcs, objectives }, problems);
  if (problems.length > 0) throw new ContentError(problems);

  return new Content(
    files,
    player,
    enemies,
    tiles,
    biomes,
    world,
    prefabs,
    scenarios,
    items,
    recipes,
    abilities,
    classes,
    restoration,
    npcs,
    modifiers,
    objectives,
    loot,
    weapons,
  );
}

/**
 * Modifiers belong to a real class, a Warden's to a real boss, and their ids never clash with an
 * ability's: learned variants and modifiers share one record on the player.
 */
function checkModifiers(
  c: {
    enemies: Record<string, EnemyDef>;
    abilities: Record<string, AbilityDef>;
    classes: Record<string, ClassDef>;
    modifiers: ModifiersDef;
  },
  problems: string[],
): void {
  for (const [id, def] of Object.entries(c.modifiers.modifiers)) {
    const at = `modifiers.json: modifiers.${id}`;
    if (!(def.class in c.classes)) problems.push(`${at}.class: unknown class "${def.class}"`);
    if (def.boss !== undefined && !c.enemies[def.boss]?.boss)
      problems.push(`${at}.boss: "${def.boss}" is not a boss`);
    if (id in c.abilities) problems.push(`${at}: an ability is already called "${id}"`);
  }
}

/** Objectives name real givers, bosses, projects, enemies and items; prefab NPCs name real people. */
function checkObjectives(
  c: {
    items: Record<string, ItemDef>;
    enemies: Record<string, EnemyDef>;
    prefabs: Record<string, PrefabDef>;
    restoration: Record<string, RestorationDef>;
    npcs: Record<string, NpcDef>;
    objectives: Record<string, ObjectiveDef>;
  },
  problems: string[],
): void {
  for (const [id, o] of Object.entries(c.objectives)) {
    const at = `objectives.json: ${id}`;
    if (!(o.giver in c.npcs)) problems.push(`${at}.giver: unknown npc "${o.giver}"`);
    const goals = o.goal.type === 'all' ? o.goal.steps.map((s) => s.goal) : [o.goal];
    for (const goal of goals) {
      if (goal.type === 'defeat' && !c.enemies[goal.boss]?.boss)
        problems.push(`${at}.goal.boss: "${goal.boss}" is not a boss`);
      if (goal.type === 'restore' && !(goal.project in c.restoration))
        problems.push(`${at}.goal.project: unknown project "${goal.project}"`);
      if (goal.type === 'kill')
        for (const e of Object.keys(goal.enemies))
          if (!(e in c.enemies)) problems.push(`${at}.goal.enemies: unknown enemy "${e}"`);
      if (goal.type === 'gather' && !(goal.item in c.items))
        problems.push(`${at}.goal.item: unknown item "${goal.item}"`);
    }
    for (const r of o.reward)
      if (!(r.item in c.items)) problems.push(`${at}.reward: unknown item "${r.item}"`);
  }
  for (const [pid, prefab] of Object.entries(c.prefabs)) {
    for (const [ch, entry] of Object.entries(prefab.legend)) {
      if (entry.entity?.kind === 'npc' && !(entry.entity.npc in c.npcs))
        problems.push(`prefabs/${pid}.json: legend "${ch}": unknown npc "${entry.entity.npc}"`);
    }
  }
}

/** Project costs name real items, prefab sites name real projects, and upgrade steps name real projects. */
function checkRestoration(
  c: {
    items: Record<string, ItemDef>;
    prefabs: Record<string, PrefabDef>;
    restoration: Record<string, RestorationDef>;
  },
  problems: string[],
): void {
  for (const [id, p] of Object.entries(c.restoration)) {
    for (const cost of p.cost.items) {
      if (!(cost.item in c.items)) problems.push(`restoration.json: ${id}.cost: unknown item "${cost.item}"`);
    }
  }
  for (const [pid, prefab] of Object.entries(c.prefabs)) {
    for (const [ch, entry] of Object.entries(prefab.legend)) {
      if (entry.entity?.kind === 'project' && !(entry.entity.project in c.restoration))
        problems.push(`prefabs/${pid}.json: legend "${ch}": unknown project "${entry.entity.project}"`);
    }
  }
  for (const [id, item] of Object.entries(c.items)) {
    if (item.kind !== 'weapon') continue;
    for (const step of item.upgrades) {
      if (step.requires !== undefined && !(step.requires in c.restoration))
        problems.push(`items.json: ${id}.upgrades: requires unknown project "${step.requires}"`);
    }
  }
}

/** Every class names an existing ability of the right slot for each slot; the start class exists. */
function checkClasses(
  c: { player: PlayerDef; abilities: Record<string, AbilityDef>; classes: Record<string, ClassDef> },
  problems: string[],
): void {
  if (!(c.player.start.class in c.classes))
    problems.push(`player.json: start.class: unknown class "${c.player.start.class}"`);
  for (const [id, cls] of Object.entries(c.classes)) {
    for (const slot of ABILITY_SLOTS) {
      const ability = cls.abilities[slot];
      const def = c.abilities[ability];
      if (!def) problems.push(`classes.json: ${id}.abilities.${slot}: unknown ability "${ability}"`);
      else if (def.slot !== slot)
        problems.push(`classes.json: ${id}.abilities.${slot}: "${ability}" is a ${def.slot} ability`);
      else if (def.variantOf !== undefined)
        problems.push(`classes.json: ${id}.abilities.${slot}: "${ability}" is a variant; name its base`);
    }
  }
  for (const [id, def] of Object.entries(c.abilities)) {
    if (def.variantOf === undefined) continue;
    const base = c.abilities[def.variantOf];
    const at = `abilities.json: ${id}.variantOf`;
    if (!base) problems.push(`${at}: unknown ability "${def.variantOf}"`);
    else if (base.variantOf !== undefined) problems.push(`${at}: "${def.variantOf}" is itself a variant`);
    else if (base.slot !== def.slot) problems.push(`${at}: "${def.variantOf}" is a ${base.slot} ability`);
  }
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
    for (const [pack] of b.spawns.packs) {
      if (Object.keys(pack).length === 0) problems.push(`biomes.json: ${id}.spawns: an empty pack`);
      for (const [e, [min, max]] of Object.entries(pack)) {
        enemy(`biomes.json: ${id}.spawns`, e);
        if (min > max) problems.push(`biomes.json: ${id}.spawns: ${e} count [${min}, ${max}] runs backwards`);
      }
    }
  }

  const w = c.world;
  if (w.rings[0]!.from !== 0) problems.push('world.json: rings: the first ring starts at 0');
  for (const [i, r] of w.rings.entries()) {
    const prev = w.rings[i - 1];
    if (prev && (r.from <= prev.from || r.power < prev.power))
      problems.push(
        `world.json: rings[${i}]: must start further out, at no less Power, than the ring before`,
      );
    if (r.cap < r.power) problems.push(`world.json: rings[${i}]: its cap is below its Power`);
  }
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
  for (const f of w.fixed) {
    if (!(f.prefab in c.prefabs)) problems.push(`world.json: fixed: unknown prefab "${f.prefab}"`);
    if (f.region[0] === 0 && f.region[1] === 0)
      problems.push('world.json: fixed: region 0, 0 holds the origin');
  }
  for (const [id, e] of Object.entries(c.enemies)) {
    if (e.brain.type === 'warden') {
      for (const phase of ['shielded', 'open'] as const) {
        for (const a of e.brain.adds[phase].archetypes) enemy(`enemies.json: ${id}.brain.adds.${phase}`, a);
      }
    }
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

function checkItems(
  c: {
    player: PlayerDef;
    enemies: Record<string, EnemyDef>;
    tiles: TileDef[];
    items: Record<string, ItemDef>;
    recipes: Record<string, RecipeDef>;
  },
  problems: string[],
): void {
  const item = (where: string, id: string, kind?: ItemKind) => {
    const def = c.items[id];
    if (!def) problems.push(`${where}: unknown item "${id}"`);
    else if (kind && def.kind !== kind)
      problems.push(`${where}: "${id}" is a ${def.kind}, expected a ${kind}`);
  };
  const counts = (where: string, list: readonly ItemCount[]) => {
    for (const ic of list) item(where, ic.item);
  };
  const drops = (where: string, list: readonly DropDef[]) => {
    for (const d of list) if (d.item !== undefined) item(where, d.item);
  };

  counts('player.json: start.items', c.player.start.items);
  for (const [id, e] of Object.entries(c.enemies)) drops(`enemies.json: ${id}.drops`, e.drops);
  for (const t of c.tiles) if (t.cut) drops(`tiles.json: ${t.id}.cut.drops`, t.cut.drops);
  for (const [id, def] of Object.entries(c.items)) {
    if (def.kind === 'weapon') for (const u of def.upgrades) counts(`items.json: ${id}.upgrades`, u.items);
    if (
      def.kind !== 'material' &&
      def.kind !== 'consumable' &&
      def.kind !== 'relic' &&
      def.kind !== 'key' &&
      def.stack !== 1
    )
      problems.push(`items.json: ${id}: equipment must have stack 1`);
  }
  for (const [id, r] of Object.entries(c.recipes)) {
    item(`recipes.json: ${id}.output`, r.output.item);
    counts(`recipes.json: ${id}.inputs`, r.inputs);
  }
}

/**
 * Gear holds together: every slot can roll a full set of perks for the best tier, class perks and
 * effects name real classes and abilities, Legendary bases fit their slot, enemies name real drop
 * tables, and a new game starts with exactly one weapon.
 */
function checkGear(
  c: {
    player: PlayerDef;
    enemies: Record<string, EnemyDef>;
    biomes: Record<string, BiomeDef>;
    items: Record<string, ItemDef>;
    loot: LootDef;
    abilities: Record<string, AbilityDef>;
    classes: Record<string, ClassDef>;
  },
  problems: string[],
): void {
  const { loot } = c;
  // An effect that names an ability (a burning streak's look) must name a real one.
  const effect = (where: string, fx: ModifierEffect) => {
    if (fx.type === 'streakBurst' && !(fx.ability in c.abilities))
      problems.push(`${where}: unknown ability "${fx.ability}"`);
  };
  for (const [id, perk] of Object.entries(loot.perks)) {
    if (perk.class !== undefined && !(perk.class in c.classes))
      problems.push(`loot.json: perks.${id}: unknown class "${perk.class}"`);
    if (perk.effect) effect(`loot.json: perks.${id}`, perk.effect);
    if (!perk.text.includes('{v}') && !perk.effect && !perk.fixed)
      problems.push(`loot.json: perks.${id}: a stat perk's text needs {v} (unless it is fixed)`);
  }
  const mostPerks = Math.max(...TIERS.map((t) => loot.tiers[t].perks));
  for (const slot of ['weapon', 'helmet', 'chest', 'legs', 'ring'] as const) {
    const pool = Object.values(loot.perks).filter((p) => p.slots.includes(slot) && !p.drawback).length;
    if (pool < mostPerks)
      problems.push(`loot.json: perks: only ${pool} can roll on a ${slot}, but a tier rolls ${mostPerks}`);
    const droppable = Object.values(c.items).some(
      (d) =>
        (d.kind === 'weapon' || d.kind === 'armor' || d.kind === 'ring') &&
        gearSlotOf(d) === slot &&
        d.drop > 0,
    );
    if (!droppable) problems.push(`items.json: no ${slot} can drop (every one has "drop": 0)`);
  }
  for (const [id, def] of Object.entries(c.items)) {
    if (def.kind !== 'weapon' && def.kind !== 'armor' && def.kind !== 'ring') continue;
    for (const roll of def.innate)
      if (!(roll.perk in loot.perks)) problems.push(`items.json: ${id}.innate: unknown perk "${roll.perk}"`);
    if (def.kind === 'ring' && def.innate.length === 0)
      problems.push(`items.json: ${id}: a ring needs an innate perk`);
    if (def.power) effect(`items.json: ${id}.power`, def.power.effect);
    // A power's text is shown as written; only perk texts fill in {v}.
    if (def.power?.text.includes('{v}'))
      problems.push(`items.json: ${id}.power.text: write the number out; {v} is only filled in for perks`);
  }
  const { smithy } = loot;
  const known = (where: string, item: string) => {
    if (!(item in c.items)) problems.push(`loot.json: ${where}: unknown item "${item}"`);
  };
  for (const [kind, list] of Object.entries(smithy.salvage.materials))
    for (const item of list) known(`smithy.salvage.materials.${kind}`, item);
  known('smithy.salvage.mark', smithy.salvage.mark);
  for (const c2 of smithy.temper.items) known('smithy.temper.items', c2.item);
  for (const c2 of smithy.cleanse.items) known('smithy.cleanse.items', c2.item);
  for (const [id, def] of Object.entries(c.items))
    if (def.kind === 'armor')
      for (const u of def.upgrades) for (const c2 of u.items) known(`(items.json) ${id}.upgrades`, c2.item);
  known('wardens.mark', loot.wardens.mark);
  known('wardens.sigil', loot.wardens.sigil);
  for (const m of loot.wardens.materials) known('wardens.materials', m.item);
  for (const [id, e] of Object.entries(c.enemies)) {
    const warden = e.boss?.warden;
    if (!warden) continue;
    for (const item of [warden.signature, warden.alternate.item]) {
      const def = c.items[item];
      if (!def || !gearSlotOf(def)) problems.push(`enemies.json: ${id}.boss.warden: "${item}" is not gear`);
    }
  }
  for (const [id, e] of Object.entries(c.enemies)) {
    if (e.gear && !(e.gear.table in loot.tables))
      problems.push(`enemies.json: ${id}.gear: unknown table "${e.gear.table}"`);
    const sure = e.sureGear;
    if (sure && !Object.values(c.items).some((d) => gearSlotOf(d) === sure.slot && 'drop' in d && d.drop > 0))
      problems.push(`enemies.json: ${id}.sureGear: no gear drops for the ${sure.slot} slot`);
  }

  const slots = new Set<string>();
  for (const id of c.player.start.gear) {
    const def = c.items[id];
    const slot = def ? gearSlotOf(def) : null;
    if (!def) problems.push(`player.json: start.gear: unknown item "${id}"`);
    else if (!slot) problems.push(`player.json: start.gear: "${id}" is a ${def.kind}, not gear`);
    else if (slot !== 'ring' && slots.has(slot))
      problems.push(`player.json: start.gear: two items for the ${slot}`);
    if (slot) slots.add(slot);
  }
  if (!slots.has('weapon')) problems.push('player.json: start.gear: needs a weapon');
}

/** Which gear slot an item goes in, or null for anything that is not gear. */
export function gearSlotOf(def: ItemDef): 'weapon' | 'helmet' | 'chest' | 'legs' | 'ring' | null {
  switch (def.kind) {
    case 'weapon':
      return 'weapon';
    case 'armor':
      return def.armor.slot;
    case 'ring':
      return 'ring';
    default:
      return null;
  }
}

/** Weapon types name real classes for their affinity, and type perks roll only on weapons. */
function checkWeapons(
  c: { weapons: WeaponsDef; classes: Record<string, ClassDef>; loot: LootDef },
  problems: string[],
): void {
  for (const [id, type] of Object.entries(c.weapons.types))
    for (const cls of type.affinity)
      if (!(cls in c.classes)) problems.push(`weapons.json: types.${id}.affinity: unknown class "${cls}"`);
  for (const [id, perk] of Object.entries(c.loot.perks))
    if (perk.weaponTypes && (perk.slots.length !== 1 || perk.slots[0] !== 'weapon'))
      problems.push(`loot.json: perks.${id}: a perk for weapon types rolls only on weapons`);
}
