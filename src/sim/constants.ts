/** Simulation ticks per second. The sim is always stepped at this fixed rate. */
export const TICK_RATE = 60;
/** World pixels per tile. */
export const TILE = 16;
/** Tiles per chunk edge. */
export const CHUNK = 32;
/** Chunks within this Chebyshev distance of the player are loaded and simulated. */
export const LOAD_RADIUS = 1;
/** Chunks beyond this distance are unloaded (the gap prevents thrashing at borders). */
export const UNLOAD_RADIUS = 2;
