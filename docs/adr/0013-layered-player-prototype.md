# 0013. Layered player appearance prototype

- Status: default art superseded by ADR 0014; retained as comparison artwork
- Date: 2026-11-01

## Context

The original Ashen One bakes a plumed helmet, armor, shield and sword into most poses.
Its sword is omitted during attacks while a separate effect draws the swing. Gear and
loot phase 3 now supplies six weapon types, making one fixed knight inappropriate.
The owner approved a neutral adventurer with cosmetic customization on a shared rig,
starting with one sword animation slice before replacing the entire animation set.

## Decision

`tools/art/adventurer.py` reuses the original voxel rig's camera, IK and four-step
lighting. It generates synchronized 48×48 sheets for clothing, skin, legs, hair,
beard, headwear and the sword in eight directions. Sword geometry uses the posed
hand; front/back layers are split against the body's depth buffer. Layer animation
indices, anchors and framing offsets are identical. Existing player-sheet framing
keeps low or extended poses inside the tile while render offsets preserve their
world position. Grounded poses use one shared drop for every clothing/head layer.
Active sword frames follow the move's hit window. Procedural swings aimed north
render below the entity layer, letting the body occlude their inner weapon line;
south-facing swings render above it. Resource markers remain above the player.

Appearance is a validated ECS component changed through menu `PlayerAction`s and
stored per character. Save version 16 migrates version 15 by adding defaults.
Cosmetics do not affect stats. Appearance and equipped-gear previews share the same
layer-selection function; armor weight selects cloth/leather/plate and headwear.

## Limits and next steps

The layered body covers idle, walking, attacks, charges, rolling, casting, drinking,
resting, hurt and death for every weapon type. It uses the shared animation selector
and cast-release timing; actions never switch to the old knight. A saved toggle
lets the owner compare with the original. The preview uses one body rig, four skin
tones, bald/short/swept hair, five hair colors, facial hair and hide-helmet.

Skin and hair use grayscale material layers. Clothing uses separate weight sheets
and a provisional tier tint; the full palette-lookup filter from the loot plan is
still pending. Weapon meshes are currently one generic sword, not every item base.
Layers can still need pose-specific corrections when extended to other actions.
