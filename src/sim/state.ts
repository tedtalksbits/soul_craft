/**
 * Persistent world-level state that is not attached to any entity. Plain data,
 * saved verbatim inside snapshots. Records stand in for sets so it stays JSON.
 */
export interface SimState {
  seed: number;
  /** Spawn ids of enemies killed since the last rest. */
  killed: Record<string, true>;
  litBonfires: Record<string, true>;
  /** Where the player respawns. Null until a bonfire is used (falls back to the world origin). */
  checkpoint: { id: string; x: number; y: number } | null;
  /** chunk key -> tile index within chunk -> tile id. Player changes to the generated world. */
  tileOverrides: Record<string, Record<string, string>>;
  /** Named areas and biomes the player has entered. */
  discovered: Record<string, true>;
  currentArea: string | null;
  cheats: { god: boolean; noclip: boolean };
}

export function initialState(seed: number): SimState {
  return {
    seed,
    killed: {},
    litBonfires: {},
    checkpoint: null,
    tileOverrides: {},
    discovered: {},
    currentArea: null,
    cheats: { god: false, noclip: false },
  };
}
