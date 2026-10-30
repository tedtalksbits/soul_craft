/**
 * What the world map knows: which ground the player has seen (fog of war),
 * which places they have found (villages, shrines, camps, wayshrines, stations),
 * and their own pin. The sim records it; the client's map screen only draws it.
 */
import { Body, Player, Station } from '../components';
import { CHUNK, TILE } from '../constants';
import type { SimModule } from '../module';
import type { Simulation } from '../simulation';
import type { LandmarkKind } from '../state';
import { chunkKey } from '../world/generator';

/** Fog of war is kept in cells this many tiles square, 4×4 cells per chunk. */
export const CELL_TILES = 8;
export const CELLS_PER_CHUNK = CHUNK / CELL_TILES;
/** How close (tiles) the player must come to their death spot for its marker to clear. */
const DEATH_CLEAR_TILES = 3;

const DEFAULT_NAMES: Readonly<Record<LandmarkKind, string>> = {
  village: 'Village',
  shrine: 'Shrine',
  camp: 'Camp',
  wayshrine: 'Wayshrine',
  arena: 'Arena',
  forge: 'Forge',
  alchemy: 'Alchemy table',
};

/** Whether the cell holding tile (tx, ty) has been seen. */
export function isExplored(state: Simulation['state'], tx: number, ty: number): boolean {
  const cx = Math.floor(tx / CHUNK);
  const cy = Math.floor(ty / CHUNK);
  const mask = state.explored[chunkKey(cx, cy)] ?? 0;
  const lx = Math.floor((tx - cx * CHUNK) / CELL_TILES);
  const ly = Math.floor((ty - cy * CHUNK) / CELL_TILES);
  return (mask & (1 << (ly * CELLS_PER_CHUNK + lx))) !== 0;
}

/**
 * Marks every cell within the reveal radius of the player as seen, and records any set piece
 * a newly seen cell touches.
 */
function explore(sim: Simulation): void {
  const pb = sim.ecs.get(sim.player, Body);
  if (!pb) return;
  const r = sim.content.player.exploration.revealRadius;
  const ptx = pb.x / TILE;
  const pty = pb.y / TILE;
  const gx0 = Math.floor((ptx - r) / CELL_TILES);
  const gx1 = Math.floor((ptx + r) / CELL_TILES);
  const gy0 = Math.floor((pty - r) / CELL_TILES);
  const gy1 = Math.floor((pty + r) / CELL_TILES);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      // The cell counts once its nearest point is within reach.
      const nx = Math.max(gx * CELL_TILES, Math.min(ptx, (gx + 1) * CELL_TILES));
      const ny = Math.max(gy * CELL_TILES, Math.min(pty, (gy + 1) * CELL_TILES));
      if (Math.hypot(nx - ptx, ny - pty) > r) continue;
      revealCell(sim, gx, gy);
    }
  }
  recordStations(sim, pb);
  // Walking back to where you died clears the marker, like recovering a bloodstain. Not while lying
  // there dead, or it would clear the moment it was set.
  const death = sim.state.lastDeath;
  const alive = sim.ecs.get(sim.player, Player)?.state !== 'dead';
  if (death && alive && Math.hypot(death.x - pb.x, death.y - pb.y) < DEATH_CLEAR_TILES * TILE) {
    sim.state.lastDeath = null;
  }
}

function revealCell(sim: Simulation, gx: number, gy: number): void {
  const cx = Math.floor(gx / CELLS_PER_CHUNK);
  const cy = Math.floor(gy / CELLS_PER_CHUNK);
  const key = chunkKey(cx, cy);
  const bit = 1 << ((gy - cy * CELLS_PER_CHUNK) * CELLS_PER_CHUNK + (gx - cx * CELLS_PER_CHUNK));
  const mask = sim.state.explored[key] ?? 0;
  if (mask & bit) return;
  sim.state.explored[key] = mask | bit;
  // Any marked set piece overlapping this cell is now known.
  const tx0 = gx * CELL_TILES;
  const ty0 = gy * CELL_TILES;
  for (const p of sim.world.gen.placementsTouching(cx, cy)) {
    const marker = p.prefab.marker;
    if (!marker || sim.state.landmarks[p.id]) continue;
    const overlaps =
      p.x0 < tx0 + CELL_TILES && p.x0 + p.w > tx0 && p.y0 < ty0 + CELL_TILES && p.y0 + p.h > ty0;
    if (!overlaps) continue;
    sim.state.landmarks[p.id] = {
      kind: marker,
      name: p.prefab.name ?? DEFAULT_NAMES[marker],
      x: (p.x0 + p.w / 2) * TILE,
      y: (p.y0 + p.h / 2) * TILE,
    };
  }
}

/** Crafting stations within sight go on the map, so the player can find the forge again. */
function recordStations(sim: Simulation, pb: Body): void {
  const reach = sim.content.player.exploration.revealRadius * TILE;
  for (const [, station, body] of sim.ecs.query(Station, Body)) {
    if (Math.hypot(body.x - pb.x, body.y - pb.y) > reach) continue;
    // Stations have no id of their own; their position is unique and stable across loads.
    const id = `station@${Math.round(body.x)},${Math.round(body.y)}`;
    if (sim.state.landmarks[id]) continue;
    sim.state.landmarks[id] = {
      kind: station.station,
      name: DEFAULT_NAMES[station.station],
      x: body.x,
      y: body.y,
    };
  }
}

function processActions(sim: Simulation): void {
  for (const action of sim.input.actions ?? []) {
    if (action.type === 'setPin') sim.state.pin = action.at ? { x: action.at.x, y: action.at.y } : null;
  }
}

export const mappingModule: SimModule = {
  id: 'mapping',
  systems: [
    { phase: 'control', run: processActions },
    { phase: 'cleanup', run: explore },
  ],
};
