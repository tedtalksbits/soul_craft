# 0014. Pixel Fantasy Body 1 as the player art foundation

- Status: accepted; first playable slice
- Date: 2026-11-01
- Supersedes ADR 0013's default artwork; retains its appearance and equipment architecture

## Decision

Use the owner's Pixel Fantasy Character Generator V0.05 artwork with our existing
renderer and simulation. Support Body 1 only. The supplied sheet includes eight-direction
walking and running: cardinal walks occupy columns 0-2, diagonal walks 3-5, with run
equivalents in columns 6-11. It is not limited to four directions.

`tools/art/pixel_fantasy.py` reads selected local source sheets without executing or
shipping the generator. Its source manifest records hashes. It imports the drawn
palettes into tintable skin/hair and recolored cloth/leather/plate parts, preserving
the original outlines. The body, rear hair, clothing, front/overlap hair, facial hair,
headwear and weapon layers are independently composed. The selected body is fixed;
equipment and cosmetic choices never select a second body.

Native 48x96 cells are placed on 96x96 canvases, making room for adapted horizontal
poses. Pixi draws them at half scale to fit the existing world. UI previews use the
same layer selection. Swing pivots are specified in rendered world pixels. Aim and
simulation hitboxes remain unrestricted; every movement direction has corresponding art.

The existing saved `prototype` toggle selects Pixel Fantasy when enabled and the
previous voxel adventurer when disabled. No save shape or game rules change.

## First-slice limitations

The supplied movement and raised-arm frames are reused. Attacks combine supplied
body poses with a sword anchored to the drawn fist in each source frame; rolling, resting, hurt and death transform
all registered layers together. These are provisional adaptations, not finished
bespoke combat animations. One generic sword is supported visually; other weapon
meshes remain to be authored. Cloth/leather/plate use selected supplied tops,
one shared trousers/boots combination, and provisional custom headwear. Individual
item appearances and additional cosmetics remain future work.

North-facing weapon pixels render behind the body, with the existing swing effect
occlusion preserved. South-facing weapon pixels render above it. This prevents a
blade from painting across the back when attacking away from the camera.

Weapon grips are detected from exposed hand pixels using the full-sleeve source
reference. Profile walk frames move the hand substantially, so directional constants
are insufficient. A hidden far fist uses a point inside the body silhouette.
