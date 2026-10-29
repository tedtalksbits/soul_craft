# Content and asset pipeline

Everything a designer tunes lives in data, validated on load and hot-reloaded while the game runs.

## Content (`/content`)

| File                  | What it defines                                                                    |
| --------------------- | ---------------------------------------------------------------------------------- |
| `player.json`         | Player stats: health, stamina, attack timing, roll, flask, pack size, starting kit |
| `items.json`          | Items: materials, weapons, armour, rings, consumables                              |
| `recipes.json`        | Crafting recipes: output, inputs, soul cost, station                               |
| `classes.json`        | Classes: name, colour, and their AoE, class and super abilities                    |
| `abilities.json`      | Abilities: slot, cooldown, cast timing and a list of effects                       |
| `enemies.json`        | Enemy archetypes: stats, drops and a `brain` with its own parameters               |
| `tiles.json`          | Tile types: sprite frames, solidity, cutting, light, map colour                    |
| `biomes.json`         | Ground, scatter rules, darkness, ambient particles, spawn tables                   |
| `world.json`          | Terrain noise, biome rules, origin and region prefab placement                     |
| `prefabs/<id>.json`   | Handmade set pieces as ASCII rows plus a legend                                    |
| `scenarios/<id>.json` | Dev boot presets: a seed and console commands                                      |

Schemas: `src/content/schemas.ts`. Cross-references (biome → tile, prefab → enemy and so on) are checked in
`src/content/content.ts`. One bad file reports every problem with its path, and the running game keeps its
last good content.

Ways to edit:

1. **Any text editor**, with `pnpm dev` running: save and the game reloads that file in place (toast:
   "Reloaded content/…"). Errors print in the console (`).
2. **In-game editor** (F10, or `edit enemies.json`): changes apply live as soon as the whole content set
   validates; **Save** writes the file through the dev server.
3. `pnpm content:validate` from the CLI or CI.

Hot-reloaded stats apply to things spawned afterwards. Rest at a bonfire (or run `rest`) to respawn enemies
with new values. World and tile edits regenerate the loaded chunks immediately.

Files are kept in the canonical layout that the editor writes (`pnpm content:format`), so editor saves only
diff what changed. Note that JSON objects list numeric-looking keys first (e.g. prefab legend `"2"`).

### Cuttable tiles

A tile with `cut` can be broken by the player's sword: `{ "hits": 3 }` takes three swings (one hit per swing,
however many tiles the swing covers), `into` is what it becomes (default: the local biome's first ground
tile, so a dead tree leaves ash in the hills and pale earth in the graveyard), and `drops` lists pickups.
Partial damage is remembered per tile and saved. Currently: tall grass and tall moss (1 hit, small drops),
trees and fungal trees (3), dead trees and giant mushrooms (2). Trees and mushrooms drop crafting materials
(ashwood, fungal caps, glowspores), never souls. Rocks, walls, graves and water are not cuttable.

Movement assistance for the player lives in `player.json`: `cornerSlide` is how many pixels the player is
nudged around a corner it clips while walking straight (0 turns it off). Enemies get none, so a knight's
charge still slams into corners.

The loot magnet is `player.json → magnet`: landed drops within `radius` px fly to the player, starting at
`speed` px/tick and gaining `accel` per tick up to `maxSpeed`. Once caught, a drop keeps coming. Items the pack has
no room for are not pulled. `radius: 0` turns it off.

### Items and recipes

Every item has `kind`, `name`, `description`, `icon` (a frame name in `assets/sprites/items.json`) and
`stack` (equipment must be 1). By kind:

- `material`: nothing else; used by recipes and upgrades.
- `weapon`: `weapon { damage, staminaCost, reach, width, knockback }` and `upgrades`, the forge steps in order,
  each `{ damage, souls, items }`. The player's swing uses the equipped weapon; unarmed is weak on purpose.
- `armor`: `armor { defense }`, the fraction of incoming damage absorbed (capped at 0.9 with buffs).
- `ring`: `ring { stat, amount }`. Two ring slots.
- `consumable`: `effect` is `{ type: "heal", amount }` or `{ type: "buff", stat, amount, seconds }`.
  Drinking one takes the flask's drink time. A second buff on the same stat refreshes the first.

Stats are `damage`, `defense`, `staminaRegen` (fractions: 0.2 = +20%) and `maxHp` (points).

A recipe is `{ output { item, count }, inputs [{ item, count }], souls, station }`, where `station` is
`"forge"`, `"alchemy"` or `null` (craftable anywhere). Stations are prefab entities; the player must stand
within twice the interact range. Enemy and tile `drops` can be `{ "kind": "item", "item": "iron_scrap", ... }`.
Every item id named anywhere is cross-checked on load.

### Classes and abilities

A class (`classes.json`) names one ability per slot: `aoe` (F), `class` (C) and `super` (V), plus a `color`
used by the ability effects and HUD. Players pick a class on the new-game screen and can change it from the
bonfire menu while resting. `player.json → start.class` is the default for games started without that screen
(scenarios, `?new`, tests).

An ability (`abilities.json`) has a `slot`, a `cooldown` in seconds (AoE and class; supers spend a full energy
bar instead), a `cast` (`ticks` the player is locked, effects land on tick `release`), and `effects`, applied in
order:

- `blast`: hits everything within `radius`, at `self` or the cursor (`at: "aim"`, capped at `range`), after
  an optional `fuse` in ticks. `damage`, `knockback`, and `stagger` (ticks the enemy is stopped, guard down).
- `zone`: burning ground, at `self` or the cursor. Starts after `delay`, hurts every `interval` ticks for
  `duration` ticks.
- `dash`: carries the player `distance` px over `ticks`, optionally with i-frames, hitting what it passes
  (`width`, `damage`, `knockback`, `stagger`).
- `empower`: a super mode for `seconds`: `damage` and `crit` bonuses, `defense` (0.5 = half damage taken),
  `staminaFree` swings.

Ability hits go through shields. Super energy is `player.json → energy`: `perDamage` dealt, `perKill` and
`perSecond`. The super's own hits don't charge it. Every class must name an existing ability of the right slot.

### Prefabs

```json
{
  "name": "Forsaken Shrine", // optional: named area (title on first visit)
  "darkness": 0.7, // optional: overrides biome darkness inside
  "biomes": ["pale_graveyard"], // optional: where region placement may put it
  "legend": {
    "#": { "tile": "wall" },
    "K": { "tile": "stone_floor", "entity": { "kind": "enemy", "archetype": "knight" } }
  },
  "rows": ["#####", "#.K.#", "#####"]
}
```

A space keeps the generated terrain. Entity kinds: `bonfire`, `sign`, `enemy`, `torch`, `station`
(`{ "kind": "station", "station": "forge" }`), `playerSpawn` (origin prefab only). To add a prefab to the world, add it to `world.json → regions.prefabs` with a weight.

## Sprites (`/assets/sprites`)

Each sheet is a PNG on a fixed grid plus a JSON sidecar (`src/content/sprite-sheet.ts`):

```json
{
  "image": "hollow.png",
  "frameWidth": 16,
  "frameHeight": 24,
  "anchor": [0.5, 1],
  "frames": { "still_name": 3 },
  "animations": { "walk_down": { "frames": [4, 5, 6, 7], "fps": 8, "loop": true } }
}
```

Frames are numbered left to right, top to bottom. Edit PNGs in any pixel editor (Aseprite, Piskel,
LibreSprite…). Saving hot-reloads the sheet.

**Animation names the renderer looks for**, most specific first: `<pose>_<dir8>`, `<pose>_<dir>`,
`<pose>`, then the same for `walk` and `idle`. `<dir>` is `down`, `up`, `left` or `right`; `<dir8>` adds
`down_right`, `up_right`, `up_left` and `down_left`. Diagonals are optional and are chosen from the direction
of travel, held while standing still. A missing pose falls back to walk/idle frames rather than failing.

**Pivots** (optional) name points relative to the anchor, in pixels, that effects attach to.
An animation may also carry an **offset** (pixels, x right, y down) added to the sprite position; generators
set it when they shift a pose to fit the frame, so the body still lands where it should.
`swing` places the player's sword arc; without one it sits 9 px above the feet.
Animations may also carry their own `pivots`, overriding the sheet-level ones for that animation (the
archer's per-direction `release` on `attack_<dir>`). In use: `swing` (player sword arc), `head` (enemy health
bar, 4 px above), `release` (arrow flight height).

- Player poses: `idle`, `walk`, `attack`, `roll`, `hurt`, `drink`, `sit`, `dead`
- Enemy poses: `idle`, `walk`, `windup` (telegraph), `attack`, `hurt`, `stunned`, `hop`
- Props: `bonfire_lit`, `bonfire_unlit`, `torch`, `sign`, `souls`, `ember`
- Tiles: named frames referenced from `tiles.json`. `overlay: true` tiles are transparent and drawn over the
  local biome's ground.

### Generated character art

Characters with real art are generated from Python source in `tools/art/` (see its README):
`pnpm art:setup` once, then e.g. `pnpm art ashen_one` to rebuild `player.png` + `player.json`. Edit the
script, not the PNG.

### Placeholders

`pnpm assets:placeholders` draws programmatic placeholder sheets (`scripts/placeholders/`). It **never
overwrites existing files** unless you pass `--force` (optionally limited to names:
`pnpm assets:placeholders --force props`). What is still placeholder: tiles, props (bonfire, sign,
torch, souls, ember) and the font. Replace any PNG with real art whenever you like, keeping the
grid and JSON in step.
