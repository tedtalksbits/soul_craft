# 0003. Minimal in-house ECS with plain-data components

- Status: accepted
- Date: 2026-10-28

## Context

We need composition (enemies, pickups, props and later animals and crops share pieces) and one-call
serialization for saves and snapshots. Third-party ECS libraries optimise for typed arrays, which makes
serialization and debugging harder at our entity counts.

## Decision

`src/core/ecs.ts`: numeric entities, components as plain JSON-compatible objects in per-type Maps, typed
variadic queries, deferred destruction. All behaviour is in systems.

## Consequences

- `World.snapshot()` is the save. No component may hold class instances, Sets, Maps or functions.
- Performance is fine for hundreds of entities; revisit storage only with a profile in hand.
