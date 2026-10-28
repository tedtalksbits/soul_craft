# 0004. Data-driven content validated with zod, hot-reloaded

- Status: accepted
- Date: 2026-10-28

## Context

Designers (and agents) should tune stats, enemies, biomes and set pieces without code changes, and see
results without restarting the game.

## Decision

Content is JSON under `/content`, one zod schema per file kind, TypeScript types inferred from the schemas.
`buildContent` validates everything plus cross-file references and reports all problems at once. In dev, a
Vite plugin pushes file changes to the running game, which swaps content only if it validates. The in-game
editor writes files back through the dev server.

## Consequences

- No magic numbers in systems; adding a tunable means a schema field.
- Bad edits never crash the running game.
- Hot-reloaded stats apply to newly spawned entities.
