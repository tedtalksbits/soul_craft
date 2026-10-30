# Soul Craft

A top-down Soulslike action RPG where you fight with elemental class powers, forge your gear from what you
gather, and explore a world that is different every time the flame wakes. Built from the _Embers of the
Spire_ prototype.

**Where it stands:** Milestones 1 and 2 are done (the engine and combat; items, equipment and crafting), and
Milestone 3's foundation is in: three classes with abilities, settings and key rebinding. Next up is
finishing Milestone 3, then bosses. The full plan, what's done and the open decisions are in
[`docs/roadmap.md`](docs/roadmap.md).

## Getting started

Requires Node 22+ and pnpm 10.

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173 and start a new game in a slot.

Pick a class on the new-game screen; you can change it while resting at a bonfire. The default keys are below.
Every key except Esc and the dev console can be rebound in Settings (Esc, then Settings), and the pause
screen lists your current keys.

| Action                         | Keys                                    |
| ------------------------------ | --------------------------------------- |
| Move                           | WASD / arrows                           |
| Attack                         | J / Space / left-click (aims at cursor) |
| Roll (i-frames)                | Shift / K                               |
| AoE ability / class ability    | F / C (aim at the cursor)               |
| Super (when its bar is full)   | V                                       |
| Drink flask                    | R / H                                   |
| Quick item (potion, bandage)   | Q                                       |
| Use (bonfire, sign, forge)     | E / Enter                               |
| Inventory, crafting, abilities | Tab / I                                 |
| World map                      | M                                       |
| Pause and settings             | Esc                                     |
| Dev console (dev builds)       | ` (backquote)                           |

Standing still while facing an arrow blocks it with your shield. Shield knights block every sword blow
until they charge: dodge the charge into a wall and punish, or break their guard with an ability.

## Working on it

- [`docs/roadmap.md`](docs/roadmap.md): vision, milestones, open decisions, who makes what
- [`CLAUDE.md`](CLAUDE.md): rules and conventions (for humans and agents alike)
- [`docs/architecture.md`](docs/architecture.md): how the pieces fit together
- [`docs/content-pipeline.md`](docs/content-pipeline.md): editing content and art
- [`docs/dev-tools.md`](docs/dev-tools.md): console commands, overlays, scenarios, snapshots
- [`docs/saves.md`](docs/saves.md): save format and migrations
- [`docs/CHARACTER_ART.md`](docs/CHARACTER_ART.md): the art spec and every art delivery's report
- [`docs/adr/`](docs/adr/): architecture decision records

`pnpm check` runs typecheck, lint, format check and tests. A pre-commit hook runs lint-staged and the
typecheck (`pnpm exec simple-git-hooks` installs it).
