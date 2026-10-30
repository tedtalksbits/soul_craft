# 0012. Restoration projects sink wood and stone; bosses are content with an arena rule

- Status: accepted
- Date: 2026-10-29

## Context

Milestone 4 brings bosses, and the restoration thread (the roadmap) says each boss guards a Kindling that brings
part of Ashen Village back. Wood and stone also needed a long-term use: ashwood only fed a few recipes, and rocks
could not be broken at all. Both had to stay authored steps, never free-form building, and data-driven like
everything else.

## Decision

- **Restoration projects** live in `content/restoration.json`: a name, a description, a cost (items and souls),
  a tier (`small` or `major`), the ruin and rebuilt sprite frames, what the site says once rebuilt, and a list of
  **effects** from a small closed set: `maxFlasks`, `inventorySlots`, `safeRadius`, `light`, `forgeSteps`. A
  prefab places a site with `{ "kind": "project", "project": "<id>" }`. Rebuilding is a `rebuild` player action
  (ADR 0009), allowed only standing at the site, and recorded in `SimState.restored`.
- **Effects are read where they apply**, not copied into components: pack capacity (`inventoryCapacity`), enemy
  spawning near the village (`villageWardTiles`), forge steps (a weapon upgrade step may name a project in
  `requires`) and the client's lighting. The one exception is `maxFlasks`, which adds a charge to
  `Player.maxFlasks` once, because the flask count is already player state.
- **Major projects need a Kindling**, a new `key` item kind (carried, never used directly), dropped by a boss. The
  first is the smithy, opened by the Ashen Warden's Kindling: it unlocks the final forge steps of every weapon.
- **Rocks break with the sword** into stone (four swings), through the existing cuttable-tile system. A crafted
  pickaxe and axe come later.
- **A boss is an enemy archetype** with a `boss` block (`title`, `arenaTiles`) and a brain like any other. Its
  arena is the square `arenaTiles` around its spawn point: walking fully inside starts the fight
  (`SimState.bossFight`), and while it lasts the player, the boss and its adds are held inside (the fog gate is a
  rule, not a tile, so no wall has to appear and vanish in the saved world). The fight ends when the boss dies or
  the player does; death resets it like any enemy. A killed boss is recorded in `SimState.bossesDefeated` and
  never respawns, rest or not.
- **The Ashen Warden** (`warden` brain): a telegraphed slam when close, a charge when far, each followed by a
  window to punish. At each `shieldAt` fraction of its health a blow stops at the threshold and a shield goes up
  (immune to everything); it falls back to the arena's center and calls adds until the player stands on every
  brazier in the arena, which breaks the shield and staggers it. Its arena is the first **fixed placement**
  (`world.json → fixed`): a set piece every world has in the same region, north of the village.
- **Relic order is dropped** (amends ADR 0011). The Sovereign Ember moves from the second shrine knight to the
  Warden, as ADR 0011 planned. With two different sources, and a boss that falls once, a relic now drops whenever
  its slot is still locked, in any order; otherwise a player who beat the Warden before any knight would lose the
  super for good.

## Consequences

- Save format v8: `restored`, `bossesDefeated` and `bossFight` on `SimState`.
- New projects and their rewards are content, as long as they reuse the five effect types. Farming, fishing and
  pets (Milestone 5) will each need a new effect type, in code.
- More bosses are content plus, usually, a new brain. A boss whose mechanics are not the Warden's (shield,
  braziers, adds) would grow the brain schema or the bosses module.
- The fog gate holds bodies inside a square, so arenas are square rooms. A boss placed in an irregular room would
  need a different rule.
- Until the art agent delivers, the Warden wears the knight's sheet (drawn larger and ash-tinted), and project
  sites use a placeholder `village` sheet.
