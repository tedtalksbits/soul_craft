# Art source (`tools/art`)

Characters with real art are generated from Python source here rather than hand-edited PNGs, so a pose,
palette or proportion change is a code change that regenerates every frame consistently. Output lands in
`assets/sprites/` in the engine's sheet format (`src/content/sprite-sheet.ts`). Commit the generated
PNG and JSON along with the script change.

```bash
pnpm art:setup          # once: creates tools/art/.venv and installs requirements.txt (needs Python 3.10+)
pnpm art ashen_one      # regenerate assets/sprites/player.png + player.json
```

Output is deterministic, so running a tool without changing it produces no diff. `pnpm dev`
hot-reloads the sheet as soon as it is written.

## Tools

| Tool           | Writes     | Contents                                                |
| -------------- | ---------- | ------------------------------------------------------- |
| `ashen_one.py` | `player.*` | The Ashen One: idle + 4-frame walk, 8 directions, 48×48 |

## How the Ashen One generator works

A voxel model (`build(pose)`, half-pixel voxels) is ray-cast orthographically from a 32° overhead camera,
lit from the upper left, quantised to 4-step material ramps (`RAMPS`), then given depth-edge lines and a
1 px outline. One model unit is one screen pixel, so the character stands about 36 px tall.

- **Add an animation:** add poses and an entry to `ANIMATIONS` (`name, poses, fps, loop`). Each pose
  becomes a sheet row and `<name>_<direction>` animations are written for all eight directions. Pose
  parameters are documented on `build`. New poses (attack, roll, hurt…) may need new parameters, such as
  arm angles or a whole-body tilt.
- **Directions:** columns follow `DIRS` (down, down_right, right, up_right, up, up_left, left, down_left).
  The renderer prefers 8-way keys and falls back to 4-way ones.
- **Pivots:** points the engine attaches effects to, in pixels from the feet anchor. `swing` (the sword
  arc centre) is computed from the model's sword hand, so it follows proportion changes.
- **Palette:** edit `RAMPS`; each material is (highlight, base, shadow, deep).

## Conventions for new character tools

- One script per sheet, named after the character, writing `<sheet>.png` and `<sheet>.json`.
- Frames on a fixed grid; feet on the same row in every frame (the `[0.5, 1]` anchor depends on it).
- Hard alpha only (no partial transparency), so sprites stay crisp under nearest-neighbour scaling.
- Keep generators deterministic: seed any randomness (`np.random.default_rng(seed)`).
- When a sheet graduates from placeholder to real art, remove it from `scripts/placeholders/generate.ts`
  so `--force` can never overwrite it.
