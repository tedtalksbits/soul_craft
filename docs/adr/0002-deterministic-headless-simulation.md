# 0002. Deterministic, headless simulation behind an input/event boundary

- Status: accepted
- Date: 2026-10-28

## Context

We want exact snapshots for debugging, gameplay tests without a browser, and the option of co-op later.

## Decision

All game rules live in `src/sim`, stepped at a fixed 60 Hz. Input enters only as `InputFrame`s; output
leaves only as `SimEvent`s and readable state. The sim uses only its seeded `Rng` and position hashing; no
wall-clock time, no `Math.random`, no DOM or Pixi. ESLint enforces this.

## Consequences

- Determinism is tested (`tests/sim/determinism.test.ts`), and behaviour tests are fast and headless.
- Presentation (particles, shake, damage numbers) is free to use non-deterministic randomness.
- Hitstop is sim state, so presses during a freeze are carried over rather than lost.
- Cross-engine float determinism is not guaranteed; lockstep co-op would need fixed-point math or a
  server-authoritative model.
