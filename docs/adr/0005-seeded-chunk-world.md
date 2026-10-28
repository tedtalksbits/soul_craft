# 0005. Seeded, chunk-streamed world with handmade prefabs

- Status: accepted
- Date: 2026-10-28

## Context

The world should be large, different per save, and still contain authored places (towns, shrines, arenas).

## Decision

Any 32×32 chunk is a pure function of (seed, content, coordinates): noise-driven biomes and water, scatter,
and at most one weighted prefab per 3×3-chunk region (the origin always holds the start village). Chunks
within radius 1 of the player are loaded, unloaded past 2. Player changes are stored as tile overrides;
kills by position-derived spawn id.

## Consequences

- Saves store deltas, not terrain. The world is unbounded and seams are free.
- Prefabs are confined to their region and may not overlap the origin's safe radius.
- Connectivity is encouraged (fords, a dry start area) but not proven. Revisit with path checks if players
  get stuck.
