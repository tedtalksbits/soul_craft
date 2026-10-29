# Architecture

```
            ┌──────────── content/*.json ─────────────┐   assets/sprites/*.png+json
            │ validated by src/content (zod)          │            │
            ▼                                         │            ▼
  InputFrame ──► Simulation (src/sim) ──► SimEvents ──┼──► client: renderer, audio, UI (src/client)
     ▲            deterministic, headless             │            ▲
     │            snapshot() / restore()              │            │
  InputCapture    │                                   │      dev tools (src/dev): console, overlays,
  (keyboard,      ▼                                   │      editor, hot reload, scenarios
   mouse)     save envelope (src/save) ── IndexedDB ──┘
```

## The simulation is the game

`Simulation` holds everything that matters: an ECS `World`, a seeded `Rng`, the `ChunkWorld` of loaded
tiles and `SimState` (kills, lit bonfires, checkpoint, tile edits, cheats). It advances in fixed 60 Hz ticks
via `step(input)`.

It is **deterministic**: same content + seed + input frames gives the same world, tick for tick
(`tests/sim/determinism.test.ts`). That is what makes snapshots exact, bugs replayable, behavior testable
without a browser and, later, co-op feasible (lockstep or server-authoritative). The rules that preserve
it are lint-enforced (see `CLAUDE.md`).

### Modules and phases

Gameplay is split into `SimModule`s (`src/sim/modules/`). Each contributes systems tagged with a phase and
its own dev commands. Every tick runs the phases in order:

| Phase     | Systems                                                             |
| --------- | ------------------------------------------------------------------- |
| `world`   | chunk streaming, entity spawn/despawn, area tracking                |
| `control` | menu actions (equip, use, craft, upgrade), player state machine     |
| `ai`      | enemy brains                                                        |
| `physics` | movement + tile collision, projectiles                              |
| `combat`  | contact damage, pickups                                             |
| `cleanup` | death timers, i-frame and buff timers; then the ECS flushes deletes |

Cross-module rules live in one place: all damage goes through `combat.applyDamage`, which handles i-frames,
blocking, knockback, hurt states, deaths and loot. All player stats (weapon damage and reach, armor, rings,
buffs) come from `items.playerStats`; nothing reads `player.json` attack numbers directly any more.

### ECS

`src/core/ecs.ts` is deliberately small: numeric entities, components as plain JSON objects keyed by name,
typed queries (`for (const [e, body, health] of ecs.query(Body, Health))`), deferred destruction. Plain data
is the point: a snapshot is just the stores serialized.

### World generation and streaming

`WorldGenerator` builds any 32×32 chunk from `(seed, cx, cy)` alone, so the world is unbounded and seamless:
climate noise → biome; elevation and river noise → lakes, rivers, walkable fords; biome ground and scatter;
one optional handmade prefab per region of 3×3 chunks (the origin region always gets the starting village);
enemy spawn points from the biome's spawn table. Spawn ids are derived from position, so kills are
remembered across unloads and saves.

`ChunkWorld` keeps chunks within 1 of the player loaded (unloading beyond 2) and applies the player's tile
edits, which are stored as overrides in `SimState`. Unloaded space reads as solid.

## Client

`App` owns the current `Simulation` and moves data across the boundary: `InputCapture` → `InputFrame` (key
presses, plus menu actions such as equip or craft queued by the inventory screen; see ADR 0009),
`SimEvent`s → renderer / audio / DOM UI, autosave on rest and every two minutes. `FixedLoop` ticks at 60 Hz
and renders every animation frame.

The renderer (PixiJS 8) draws at 384×216 and scales up with nearest-neighbour filtering. Layers: cached
chunk textures, y-sorted entity sprites (animation chosen from sim state), effects (particles, damage
numbers, sword arc, arrows), a lighting pass (darkness render texture with erased light sprites), then the
HUD. Everything visual derives from sim state or events; nothing feeds back.

## Dev tools

`src/dev` loads lazily in dev builds or with `?dev`: the command console (which shares the
`CommandRegistry` used by scenario URLs and tests), overlays, the content editor, snapshots and hot reload.
See `docs/dev-tools.md`.

## Known limits (deliberate, for now)

- Entity-vs-entity checks are O(n) per player; add a spatial hash when crowds outgrow it.
- No render interpolation between ticks; fine at 60 Hz displays, add if high-refresh judder shows.
- Floating-point determinism holds on one JS engine; cross-engine lockstep would need fixed-point math.
- Content changes apply to newly spawned entities; existing ones keep their stats until respawned.
