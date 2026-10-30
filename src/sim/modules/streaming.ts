/**
 * Chunk streaming: keeps the chunks around the player loaded, spawns their
 * entities (enemies, bonfires, signs, torches) on load and removes them on
 * unload. Also tracks which named area the player is in.
 */
import type { StationId } from '../../content/schemas';
import { Body, Bonfire, Brazier, Enemy, Project, Sign, Spawned, Sprite, Station, Torch } from '../components';
import { CHUNK, LOAD_RADIUS, TILE, UNLOAD_RADIUS } from '../constants';
import type { SimCommand, SimModule } from '../module';
import type { Simulation } from '../simulation';
import { chunkOf, type Chunk } from '../world/chunk-world';
import type { SpawnPoint } from '../world/generator';
import { spawnEnemy } from './enemies';
import { villageWardTiles } from './restored-effects';

const PROPS_SHEET = 'props';
const STATIONS_SHEET = 'stations';
const VILLAGE_SHEET = 'village';
const ARENA_SHEET = 'arena';
/** Station footprints, matched to their art (forge 27 px wide, alchemy table 24 px). */
const STATION_BODY: Readonly<Record<StationId, { w: number; h: number }>> = {
  forge: { w: 24, h: 10 },
  alchemy: { w: 22, h: 8 },
};

export function updateStreaming(sim: Simulation): void {
  const { ecs, world } = sim;
  const pb = ecs.need(sim.player, Body);
  const pcx = chunkOf(pb.x);
  const pcy = chunkOf(pb.y);

  for (let dy = -LOAD_RADIUS; dy <= LOAD_RADIUS; dy++) {
    for (let dx = -LOAD_RADIUS; dx <= LOAD_RADIUS; dx++) {
      const before = world.isLoaded(`${pcx + dx},${pcy + dy}`);
      const chunk = world.load(pcx + dx, pcy + dy);
      if (!before) spawnChunk(sim, chunk);
    }
  }
  for (const chunk of [...world.loaded]) {
    if (Math.max(Math.abs(chunk.cx - pcx), Math.abs(chunk.cy - pcy)) > UNLOAD_RADIUS) {
      for (const [e, s] of ecs.query(Spawned)) if (s.chunk === chunk.key) ecs.destroy(e);
      world.unload(chunk.key);
    }
  }
  trackArea(sim, pb);
}

function trackArea(sim: Simulation, pb: Body): void {
  const area = sim.world.areaAt(pb.x, pb.y);
  const name =
    area?.name ??
    sim.content.biomes[sim.world.gen.biomeAt(Math.floor(pb.x / TILE), Math.floor(pb.y / TILE))]?.name;
  if (!name || name === sim.state.currentArea) return;
  const firstVisit = !sim.state.discovered[name];
  sim.state.discovered[name] = true;
  sim.state.currentArea = name;
  sim.events.emit({ type: 'areaEntered', name, firstVisit });
}

function spawnChunk(sim: Simulation, chunk: Chunk): void {
  for (const sp of chunk.spawns) spawnPoint(sim, chunk.key, sp);
}

function spawnPoint(sim: Simulation, chunk: string, sp: SpawnPoint): void {
  const { ecs } = sim;
  const spawned = { chunk, spawnId: sp.id };
  const ent = sp.entity;
  switch (ent.kind) {
    case 'enemy':
      if (sim.state.killed[sp.id] || sim.state.bossesDefeated[ent.archetype] || inVillageWard(sim, sp))
        return;
      spawnEnemy(sim, ent.archetype, sp.x, sp.y, spawned);
      return;
    case 'bonfire': {
      const e = ecs.create();
      ecs.add(e, Body, { x: sp.x, y: sp.y, w: 12, h: 8 });
      ecs.add(e, Bonfire, { id: sp.id, name: ent.name });
      ecs.add(e, Spawned, spawned);
      ecs.add(e, Sprite, { sheet: PROPS_SHEET });
      return;
    }
    case 'sign': {
      const e = ecs.create();
      ecs.add(e, Body, { x: sp.x, y: sp.y, w: 10, h: 6 });
      ecs.add(e, Sign, { lines: [...ent.lines] });
      ecs.add(e, Spawned, spawned);
      ecs.add(e, Sprite, { sheet: PROPS_SHEET });
      return;
    }
    case 'torch': {
      const e = ecs.create();
      ecs.add(e, Body, { x: sp.x, y: sp.y, w: 4, h: 4 });
      ecs.add(e, Torch, {});
      ecs.add(e, Spawned, spawned);
      ecs.add(e, Sprite, { sheet: PROPS_SHEET });
      return;
    }
    case 'station': {
      const e = ecs.create();
      ecs.add(e, Body, { x: sp.x, y: sp.y, ...STATION_BODY[ent.station] });
      ecs.add(e, Station, { station: ent.station });
      ecs.add(e, Spawned, spawned);
      ecs.add(e, Sprite, { sheet: STATIONS_SHEET });
      return;
    }
    case 'project': {
      const e = ecs.create();
      ecs.add(e, Body, { x: sp.x, y: sp.y, w: 16, h: 10 });
      ecs.add(e, Project, { project: ent.project });
      ecs.add(e, Spawned, spawned);
      ecs.add(e, Sprite, { sheet: VILLAGE_SHEET });
      return;
    }
    case 'brazier': {
      const e = ecs.create();
      ecs.add(e, Body, { x: sp.x, y: sp.y, w: 10, h: 6 });
      ecs.add(e, Brazier, { lit: false });
      ecs.add(e, Spawned, spawned);
      ecs.add(e, Sprite, { sheet: ARENA_SHEET });
      return;
    }
    case 'playerSpawn':
      return;
  }
}

/** Whether a rebuilt palisade keeps enemies from rising at this spawn point. */
function inVillageWard(sim: Simulation, sp: SpawnPoint): boolean {
  const radius = villageWardTiles(sim);
  return radius > 0 && Math.hypot(sp.x, sp.y) < radius * TILE;
}

/** Souls-style reset: every enemy returns, including ones killed since the last rest. */
export function resetEnemies(sim: Simulation): void {
  const { ecs } = sim;
  sim.state.killed = {};
  for (const [e] of ecs.query(Enemy)) ecs.destroy(e);
  for (const chunk of sim.world.loaded) {
    for (const sp of chunk.spawns) if (sp.entity.kind === 'enemy') spawnPoint(sim, chunk.key, sp);
  }
}

const commands: SimCommand[] = [
  {
    name: 'where',
    description: 'Print position, chunk, biome and area.',
    run: ({ sim }) => {
      const pb = sim.ecs.need(sim.player, Body);
      const tx = Math.floor(pb.x / TILE);
      const ty = Math.floor(pb.y / TILE);
      return [
        `tile ${tx}, ${ty}  (px ${pb.x.toFixed(1)}, ${pb.y.toFixed(1)})`,
        `chunk ${Math.floor(tx / CHUNK)}, ${Math.floor(ty / CHUNK)}`,
        `biome ${sim.world.gen.biomeAt(tx, ty)}  area ${sim.state.currentArea ?? '-'}`,
        `seed ${sim.state.seed}  tick ${sim.tick}`,
      ].join('\n');
    },
  },
  {
    name: 'seed',
    description: 'Print the world seed.',
    run: ({ sim }) => String(sim.state.seed),
  },
  {
    name: 'regen',
    description: 'Unload and regenerate every chunk (respawns their entities).',
    run: ({ sim }) => {
      for (const [e] of sim.ecs.query(Spawned)) sim.ecs.destroy(e);
      for (const key of sim.world.loadedKeys) sim.world.unload(key);
      sim.ecs.flush();
      updateStreaming(sim);
      return `regenerated ${sim.world.loadedKeys.length} chunks`;
    },
  },
];

export const streamingModule: SimModule = {
  id: 'streaming',
  systems: [{ phase: 'world', run: updateStreaming }],
  commands,
};
