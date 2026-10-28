# Soul Craft

A top-down Souls-like action RPG with crafting, set in a seeded, endlessly generated world. Built from the
_Embers of the Spire_ prototype.

**Milestone 1 (this codebase):** the engine foundation and a combat vertical slice: chunk-streamed
procedural world, the prototype's combat (sword, roll, stamina, flasks, bonfires, slimes / hollows /
archers / shield knights), enemy health bars with damage numbers, save slots, a content pipeline and dev
tools.

## Getting started

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 and start a new game in a slot.

| Action              | Keys                                    |
| ------------------- | --------------------------------------- |
| Move                | WASD / arrows                           |
| Attack              | J / Space / left-click (aims at cursor) |
| Roll (i-frames)     | Shift / K                               |
| Drink flask         | R / H                                   |
| Use (bonfire, sign) | E / Enter                               |
| Pause               | Esc                                     |
| Dev console         | ` (backquote)                           |

Standing still while facing an arrow blocks it with your shield. Shield knights block everything until
they charge; dodge the charge into a wall, then punish.

## Working on it

- [`CLAUDE.md`](CLAUDE.md): rules and conventions (for humans and agents alike)
- [`docs/architecture.md`](docs/architecture.md): how the pieces fit together
- [`docs/content-pipeline.md`](docs/content-pipeline.md): editing content and art
- [`docs/dev-tools.md`](docs/dev-tools.md): console commands, overlays, scenarios, snapshots
- [`docs/saves.md`](docs/saves.md): save format and migrations
- [`docs/adr/`](docs/adr/): architecture decision records

`pnpm check` runs typecheck, lint, format check and tests. A pre-commit hook runs lint-staged and the
typecheck (`pnpm exec simple-git-hooks` installs it).
