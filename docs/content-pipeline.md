# Content and asset pipeline

Everything a designer tunes lives in data, validated on load and hot-reloaded while the game runs.

## Content (`/content`)

| File                  | What it defines                                                      |
| --------------------- | -------------------------------------------------------------------- |
| `player.json`         | Player stats: health, stamina, attack, roll, flask, death            |
| `enemies.json`        | Enemy archetypes: stats, drops and a `brain` with its own parameters |
| `tiles.json`          | Tile types: sprite frames, solidity, cutting, light, map colour      |
| `biomes.json`         | Ground, scatter rules, darkness, ambient particles, spawn tables     |
| `world.json`          | Terrain noise, biome rules, origin and region prefab placement       |
| `prefabs/<id>.json`   | Handmade set pieces as ASCII rows plus a legend                      |
| `scenarios/<id>.json` | Dev boot presets: a seed and console commands                        |

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
trees and fungal trees (3), dead trees and giant mushrooms (2, no drops). Rocks, walls, graves and water are
not cuttable.

Movement assistance for the player lives in `player.json`: `cornerSlide` is how many pixels the player is
nudged around a corner it clips while walking straight (0 turns it off). Enemies get none, so a knight's
charge still slams into corners.

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

A space keeps the generated terrain. Entity kinds: `bonfire`, `sign`, `enemy`, `torch`, `playerSpawn`
(origin prefab only). To add a prefab to the world, add it to `world.json → regions.prefabs` with a weight.

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
`pnpm assets:placeholders --force knight`). Replace any PNG with real art whenever you like, keeping the
grid and JSON in step.
