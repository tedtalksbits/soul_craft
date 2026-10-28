# Soul Craft: agent and contributor guide

A top-down Souls-like action RPG (TypeScript, PixiJS, Vite). Read `docs/architecture.md` before changing
anything structural. Decisions and their reasons live in `docs/adr/`.

## Commands

```bash
pnpm dev                    # game + dev tools at http://localhost:5173
pnpm check                  # typecheck + lint + format check + tests. Must pass before you finish.
pnpm test                   # vitest, headless (no browser)
pnpm content:validate       # schema + cross-reference check of /content
pnpm content:format         # canonical JSON layout (what the in-game editor writes)
pnpm assets:placeholders    # (re)generate missing placeholder sprite sheets; --force overwrites
```

## Layers and the rules that keep them honest

| Layer         | Path                                        | May import               | Never                                             |
| ------------- | ------------------------------------------- | ------------------------ | ------------------------------------------------- |
| core          | `src/core`                                  | nothing project-specific | DOM, Pixi, `Math.random`, `Date.now`              |
| content       | `src/content`                               | core, zod                | DOM, Pixi                                         |
| sim           | `src/sim`                                   | core, content            | DOM, Pixi, client, dev, wall-clock, `Math.random` |
| save (format) | `src/save/format.ts`, `save-manager.ts`     | sim, core                | DOM                                               |
| client        | `src/client`, `src/save/indexeddb-store.ts` | everything above         | game rules                                        |
| dev           | `src/dev`                                   | everything               | shipping in the default bundle (lazy-loaded)      |

ESLint enforces the "never" column for the pure layers. Do not disable those rules; fix the design.

## How to add things

- **A gameplay feature** → a new `SimModule` in `src/sim/modules/` (systems + dev commands), registered once in
  `src/sim/modules/index.ts`. Emit `SimEvent`s for anything the player should see or hear; the client reacts.
- **A component** → `src/sim/components.ts`. Plain JSON data only (no classes, Sets, Maps, functions).
  Changing an existing component's shape is a save-format change: bump `SAVE_VERSION` and add a migration.
- **Tunable numbers** → content JSON with a zod schema in `src/content/schemas.ts`, never a magic constant in
  a system. Cross-file references are checked in `src/content/content.ts`.
- **An enemy** → `content/enemies.json` (reuse a brain) or a new brain in `src/sim/modules/brains.ts`
  plus its schema variant.
- **Art** → `assets/sprites/<name>.png` + `<name>.json` (format: `src/content/sprite-sheet.ts`).
- **A dev command** → the owning module's `commands` (sim-level) or `src/dev/dev-tools.ts` (client-level).

## Conventions

- Randomness in the sim goes through `sim.rng` (or position hashing in world gen). Presentation code may use
  `Math.random`.
- The sim never calls the client. The client never mutates sim state except through `InputFrame`s, dev
  commands and `setContent`.
- Tests for sim behaviour are headless: build a `Simulation`, feed `InputFrame`s, assert on state and events
  (`tests/helpers.ts`). Every bug fix gets a test that fails without it.
- Comments explain _why_. Keep files focused; prefer a new module over growing an unrelated one.
- Strict TypeScript, no `any`, no non-essential `as` casts. `pnpm check` clean is the bar for "done".
