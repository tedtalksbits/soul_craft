# Architecture decision records

One file per significant decision: context, decision, consequences. Never rewrite an accepted ADR; supersede
it with a new one and link both ways. Template: copy `0000-template.md`.

| ADR                                               | Decision                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| [0001](0001-typescript-pixi-vite.md)              | TypeScript + PixiJS + Vite, web first                             |
| [0002](0002-deterministic-headless-simulation.md) | Deterministic, headless simulation behind an input/event boundary |
| [0003](0003-minimal-ecs-plain-data.md)            | Minimal in-house ECS with plain-data components                   |
| [0004](0004-data-driven-content.md)               | Data-driven content validated with zod, hot-reloaded              |
| [0005](0005-seeded-chunk-world.md)                | Seeded, chunk-streamed world with handmade prefabs                |
| [0006](0006-full-snapshot-saves.md)               | Saves are versioned full snapshots with migrations and a backup   |
| [0007](0007-command-registry-dev-tools.md)        | One command registry for console, scenarios and tests             |
| [0008](0008-character-art-from-source.md)         | Character art is generated from source scripts in tools/art       |
| [0009](0009-player-actions-through-input.md)      | Menu actions (equip, craft...) travel through the InputFrame      |
