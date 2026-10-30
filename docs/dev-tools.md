# Dev tools

Available in `pnpm dev`, or any build with `?dev` in the URL. Lazily loaded, so they are not in the
player's bundle.

## Keys

| Key | Action                                          |
| --- | ----------------------------------------------- |
| `   | Console (Tab completes, ↑↓ history, Esc closes) |
| F1  | Hitboxes (bodies, sword box)                    |
| F2  | AI state labels                                 |
| F3  | Chunk and area borders                          |
| F4  | Stats (fps, tick, seed, position, biome)        |
| F5  | Solid tiles                                     |
| F6  | Pause simulation                                |
| F7  | Step one tick                                   |
| F8  | Quick snapshot                                  |
| F9  | Restore quick snapshot                          |
| F10 | Content editor                                  |

Drag a snapshot or save `.json` onto the window to load it.

## Commands

Run `help` for the live list or `help <command>` for usage. Highlights:

| Command                                                                  | Does                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------- |
| `god [on/off]`, `noclip`                                                 | Invulnerability, walk through walls                 |
| `heal`, `give souls 500`, `give flasks 2`, `give maxhp 300`              | Player resources                                    |
| `item <id> [count]`, `inv`, `equip <id>`                                 | Give items, list the pack, equip from it            |
| `class [id]`, `charge`                                                   | Show or change class anywhere; ready every ability  |
| `level <attribute> [n]`, `unlock <class / super / all>`                  | Free levels; awaken ability slots                   |
| `craft <recipe>`, `upgrade`                                              | Craft or upgrade the weapon, ignoring station range |
| `kill`                                                                   | Die (tests death and respawn)                       |
| `tp <x> <y>`, `home`, `where`                                            | Teleport by tile, return to bonfire, print location |
| `spawn <enemy> [count] [dist]`                                           | Spawn a ring of enemies                             |
| `clear`                                                                  | Remove all enemies                                  |
| `rest`                                                                   | Rest at the nearest loaded bonfire                  |
| `regen`, `seed`                                                          | Regenerate loaded chunks, print seed                |
| `newgame [seed]`, `scenario <id>`                                        | Scratch world, or a scenario preset                 |
| `save [slot]`, `load <slot>`, `title`                                    | Save management                                     |
| `snap save/load/list/delete [name]`, `snap export [name]`, `snap import` | Snapshots                                           |
| `timescale <x>`, `pause`, `step [n]`                                     | Time control                                        |
| `overlay [name] [on/off]`, `edit [file]`, `mute`, `cls`                  | Tools                                               |

Commands chain with `;`: `clear; god on; spawn knight 2 80`.

### Adding a command

Simulation-level commands belong to their module (`commands` on the `SimModule`) and receive `{ sim }`.
Client-level ones go in `src/dev/dev-tools.ts` and receive `{ sim, app, dev }`. Arguments are typed and
validated by the registry (`src/core/commands.ts`); throw `CommandError` for user-facing failures.

## URL parameters

| Parameter            | Effect                                                      |
| -------------------- | ----------------------------------------------------------- |
| `?scenario=<id>`     | Start `content/scenarios/<id>.json`                         |
| `?new` / `?seed=<n>` | Start a scratch world                                       |
| `?slot=<1-3>`        | Continue a save slot                                        |
| `?cmd=<script>`      | Run commands after boot, e.g. `?new&cmd=god;give souls 999` |
| `?overlay=a,b`       | Turn on overlays (`hitboxes,ai,chunks,solids,stats`)        |

Scenarios are the way to reach any situation without playing to it. Add one by dropping a JSON file in
`content/scenarios/`. Scratch games (scenarios, `newgame`, snapshots) don't autosave to a slot unless you
`save <slot>`.

## Snapshots vs. saves

Both use the same envelope (`docs/saves.md`). Saves live in slots and are what players see; snapshots are
named dev captures stored separately. Exported files load as either.
