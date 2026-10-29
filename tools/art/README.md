# Art source (`tools/art`)

Characters with real art are generated from Python source here rather than hand-edited PNGs, so a pose,
palette or proportion change is a code change that regenerates every frame consistently. Output lands in
`assets/sprites/` in the engine's sheet format (`src/content/sprite-sheet.ts`). Commit the generated
PNG and JSON along with the script change.

```bash
pnpm art:setup          # once: creates tools/art/.venv and installs requirements.txt (needs Python 3.10+)
pnpm art ashen_one      # regenerate assets/sprites/player.png + player.json (about 80 s)
pnpm art hollow         # regenerate assets/sprites/hollow.png + hollow.json (about 80 s)
pnpm art archer         # regenerate assets/sprites/archer.png + archer.json (about 80 s)
pnpm art knight         # regenerate assets/sprites/knight.png + knight.json
pnpm art slime          # regenerate assets/sprites/slime.png + slime.json
pnpm art items          # regenerate assets/sprites/items.png + items.json (seconds)
pnpm art stations       # regenerate assets/sprites/stations.png + stations.json (seconds)
pnpm art ui_kit         # re-cut the DOM UI pieces in assets/ui/ from assets/ui/source/kit.png (seconds)
```

Output is deterministic, so running a tool without changing it produces no diff. `pnpm dev`
hot-reloads the sheet as soon as it is written. The character and animation spec lives in
[`docs/CHARACTER_ART.md`](../../docs/CHARACTER_ART.md).

## Tools

| Tool           | Writes       | Contents                                                                                              |
| -------------- | ------------ | ----------------------------------------------------------------------------------------------------- |
| `ashen_one.py` | `player.*`   | The Ashen One: idle, walk, attack, roll, drink, sit, dead, hurt; 8 directions, 48×48 (sheet 384×864)  |
| `hollow.py`    | `hollow.*`   | The Hollow: idle, walk, windup, attack, hurt, dead; 8 directions, 48×48 (sheet 384×624); `head` pivot |
| `archer.py`    | `archer.*`   | The Archer: the same six animations; `head` plus per-direction `release` on `attack_<dir>`            |
| `knight.py`    | `knight.*`   | The Oathbound Knight: idle, walk, windup, attack (looping charge), stunned, dead; `head` pivot        |
| `slime.py`     | `slime.*`    | The Fungal Slime: undirected idle, hop (lift drawn in, ground shadow), hurt, dead; `head` pivot       |
| `items.py`     | `items.*`    | 16×16 item icons as named `frames`, painted as pixel grids rather than voxels (too small for voxels)  |
| `stations.py`  | `stations.*` | Crafting stations (forge, alchemy) as named 32×48 `frames`, voxel-rendered like the characters        |
| `ui_kit.py`    | `assets/ui/` | 9-slice UI pieces and their states, cut from one PixelLab sheet (`assets/ui/source/kit.png`)          |

## How the Ashen One generator works

A voxel model (`build(pose)`, half-pixel voxels) is ray-cast orthographically from a 32° overhead camera,
lit from the upper left, quantised to 4-step material ramps (`RAMPS`), then given depth-edge lines and a
1 px outline. One model unit is one screen pixel, so the character stands about 36 px tall.

- **Add an animation:** add poses and an entry to `ANIMATIONS` (`name, poses, fps, loop`). Each pose
  becomes a sheet row and `<name>_<direction>` animations are written for all eight directions. Pose
  controls are documented on `build`: leg angles or explicit knee/ankle points, `hip_z`, whole-body `tilt`
  (with `ground` to drop onto the floor), torso `lean`/`twist`, `head_tilt`, `bob_extra`, hand targets with
  two-bone IK (`handR`/`handL`, elbow poles), and `sword`/`shield`/`flask` placement.
- **Timing:** `fps` must fit the gameplay duration in `content/player.json`. In game, one-shot actions
  (attack, roll, hurt, drink, sit, dead) are clocked from the sim state's tick counter, so frames stay in
  step with hit windows.
- **Fitting into the frame:** the ground line leaves only 2–3 px below the feet, and blade tips, trailing feet
  and lying bodies reach past it in some directions. Every animation (`FIT`) is therefore shifted per direction
  by whole pixels so nothing clips. The JSON `offset` is the correction the game adds to the sprite position (the
  opposite of the shift), so the character still stands exactly on its anchor.
- **Determinism:** pattern noise uses integer hashing. Avoid `sin()`-based hashes: they amplify last-bit
  differences between CPUs and numpy builds.
- **Directions:** columns follow `DIRECTIONS` (down, down_right, right, up_right, up, up_left, left,
  down_left). The renderer prefers 8-way keys and falls back to 4-way ones.
- **Pivots:** points the engine attaches effects to, in pixels from the feet anchor (`PIVOTS`). `swing` is
  the sword arc centre.
- **Palette:** edit `RAMPS`; each material is (highlight, base, shadow, deep).

## Conventions for new character tools

- One script per sheet, named after the character, writing `<sheet>.png` and `<sheet>.json`.
- Frames on a fixed grid; feet on the same row in every frame (the `[0.5, 1]` anchor depends on it).
- Hard alpha only (no partial transparency), so sprites stay crisp under nearest-neighbour scaling.
- Keep generators deterministic: seed any randomness (`np.random.default_rng(seed)`).
- When a sheet graduates from placeholder to real art, remove it from `scripts/placeholders/generate.ts`
  so `--force` can never overwrite it.
