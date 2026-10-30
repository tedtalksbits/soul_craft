/**
 * Persistent world-level state that is not attached to any entity. Plain data,
 * saved verbatim inside snapshots. Records stand in for sets so it stays JSON.
 */
export interface SimState {
  seed: number;
  /** Spawn ids of enemies killed since the last rest. */
  killed: Record<string, true>;
  litBonfires: Record<string, true>;
  /**
   * Every lit bonfire's name and position, kept even when its chunk is unloaded, so the player can
   * travel to it. Filled whenever a lit bonfire is loaded (see the travel module).
   */
  bonfires: Record<string, KnownBonfire>;
  /** Where the player respawns. Null until a bonfire is used (falls back to the world origin). */
  checkpoint: { id: string; x: number; y: number } | null;
  /** chunk key -> tile index within chunk -> tile id. Player changes to the generated world. */
  tileOverrides: Record<string, Record<string, string>>;
  /** "tx,ty" -> swings taken by a cuttable tile that has not broken yet. */
  tileDamage: Record<string, number>;
  /**
   * The world map's fog of war: chunk key -> a 16-bit mask of the chunk's 4×4 cells (8×8 tiles each)
   * the player has seen. Bit `cy * 4 + cx` is the cell at (cx, cy) within the chunk.
   */
  explored: Record<string, number>;
  /** Places the map marks once seen (villages, shrines, camps, wayshrines, stations), by id. */
  landmarks: Record<string, Landmark>;
  /** Where the player last died, for the map. */
  lastDeath: { x: number; y: number } | null;
  /** The player's own map pin (world pixels), or none. */
  pin: { x: number; y: number } | null;
  /** Named areas and biomes the player has entered. */
  discovered: Record<string, true>;
  currentArea: string | null;
  cheats: { god: boolean; noclip: boolean };
}

export type LandmarkKind = 'village' | 'shrine' | 'camp' | 'wayshrine' | 'forge' | 'alchemy';

export interface Landmark {
  kind: LandmarkKind;
  name: string;
  x: number;
  y: number;
}

export interface KnownBonfire {
  name: string;
  x: number;
  y: number;
}

export function initialState(seed: number): SimState {
  return {
    seed,
    killed: {},
    litBonfires: {},
    bonfires: {},
    checkpoint: null,
    tileOverrides: {},
    tileDamage: {},
    explored: {},
    landmarks: {},
    lastDeath: null,
    pin: null,
    discovered: {},
    currentArea: null,
    cheats: { god: false, noclip: false },
  };
}
