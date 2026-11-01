# Ability icon request: variants

## Current full-color icons

Ability icons now use 48×48 frames with full-color steel/blue, spectral violet and ember palettes.
The original 27 frame names and indices are preserved. Menus display icons at 96px; the HUD
uses 24px slots (half native size).
Class emblems are separately hand-authored at 24px with restrained material palettes:
blue steel shield, violet hood and dagger, and a warm ember flame. They are displayed
without tinting. Regenerate with `pnpm art icons` (`scripts/class-icon-art.ts`).

Source: `tools/art/source/abilities.png`, generated with the built-in image tool as an exact
9-column × 3-row atlas. Repack with `pnpm exec tsx scripts/ability-icon-art.ts`.
`pnpm art icons` only regenerates class emblems and cannot overwrite the ability artwork.

Generation prompt: a production atlas of 27 detailed dark-fantasy pixel-art ability icons,
48px logical resolution, nine equal square columns by three rows, no text or gutters,
large readable silhouettes and pale highlights on charcoal backgrounds. Row one contains
the nine base abilities; rows two and three contain the 18 variants in the existing frame order.

The notes below describe the previous grayscale pack and are retained as historical reference.

**Done (2026-10-31).** The pack was generated with PixelLab as described below (`icons_roll3`), and Rally, Knife
Fan, Pyre, Vanish and Ghost Run came from a reroll (`icons_roll4`). The picks are in `PICKS` in `tools/art/icons.py`.
The note is kept as the template for future icon requests: it is self-contained for the art agent, which can't
read this repository.

To add icons later, save the new pack in `assets/sprites/source/`, add one `(id, roll, index)` line per icon to
`PICKS`, and run `pnpm art icons`. A variant without its own frame shows its base's icon.

---

## Note for the art agent

Soul Craft needs 18 new ability icons. Each is another version of one of the game's nine existing abilities,
so it should look like a sibling of that ability's icon.

**Format (same as the nine existing icons):**

- **Size and background:** 16×16 px, transparent background, centered, flat front view, readable at 16 px.
  Bold and simple, with one idea per icon.
- **Colors:** exactly these five, and nothing else:
  - `#141416`: a 1 px outline around the whole glyph.
  - `#4a4a50`, `#8c8c94`, `#c8c8ce`: interior grays.
  - `#f2f2f2`: off-white highlight.
- **Why no color:** the game tints each icon with its class's color by multiplying, so the icons themselves
  have no hue. Keep enough light grays that a tinted icon still reads.
- **How it was made last time:** PixelLab `create_1_direction_object`, size 16 (64 candidates per run), with the
  description "a bold simple game icon glyph, centered, drawn in off-white and grays with a 1 px dark outline,
  flat front view, readable at 16 pixels", the five-color palette above (palette name "tintable grayscale
  glyphs"), and the existing icons as style images.

**Deliverable:** one PNG of 16×16 frames in an 8-column grid, rows filled left to right. Give 3 candidates per
icon, in the order below, so icon _n_ (counting from 0) has its candidates at frames 3n, 3n+1 and 3n+2. That's 54
frames; the last row is partly empty. Don't scale, recolor or anti-alias after generating.

**The icons.** Each row gives the existing icon it should resemble, then what the new one shows.

| #   | New icon     | Sibling of (existing icon)                          | Show                                                                |
| --- | ------------ | --------------------------------------------------- | ------------------------------------------------------------------- |
| 0   | shockwave    | sword driven point-down into cracked ground         | one wide flat ring rippling outward low across the ground, no sword |
| 1   | rally        | sword driven point-down into cracked ground         | sword point-down with a shield shape glowing behind it              |
| 2   | bulwark_rush | round shield bashing forward with speed lines       | a big wide tower shield, short thick speed lines                    |
| 3   | bastion      | a ring of cracks shattering outward from the center | a dome of stone over a small figure                                 |
| 4   | avalanche    | a ring of cracks shattering outward from the center | a heavy shield driving forward through flying rocks                 |
| 5   | twin_charge  | round bomb with a lit fuse                          | two bombs, one small and one large, side by side                    |
| 6   | latch        | round bomb with a lit fuse                          | a bomb with hooks or barbs sticking out of it                       |
| 7   | cutting_step | dagger with a dotted fading trail                   | dagger with a slash arc along its trail                             |
| 8   | false_step   | dagger with a dotted fading trail                   | a hooded silhouette and a dotted hollow copy of it                  |
| 9   | vanish       | dagger with a dotted fading trail                   | a hood with no face, fading into dots                               |
| 10  | ghost_run    | three blades whirling in a circle                   | a running hooded figure dissolving into dots behind                 |
| 11  | knife_fan    | three blades whirling in a circle                   | five throwing knives spread in a fan, points outward                |
| 12  | wildfire     | round clay pot with a flame rising from it          | flames spreading low and wide across the ground                     |
| 13  | hearth       | round clay pot with a flame rising from it          | a small flame cupped above a heart shape                            |
| 14  | cinder_ward  | round clay pot with a flame rising from it          | a shield outline made of flame                                      |
| 15  | backdraft    | concentric rings radiating out from a center point  | one tight, thick ring with a flame at its center                    |
| 16  | meteor       | embers falling from a dark cloud                    | one large burning rock falling at an angle, with a trail            |
| 17  | pyre         | embers falling from a dark cloud                    | a figure standing inside a ring of flames                           |
