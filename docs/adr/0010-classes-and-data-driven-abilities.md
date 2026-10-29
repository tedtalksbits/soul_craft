# 0010. Classes, and abilities built from a few effect primitives

- Status: accepted
- Date: 2026-10-29

## Context

Milestone 3 adds Destiny-style abilities: an AoE, a class ability and a super, per class, with three classes to
start (Vanguard, Stalker, Ashcaller). There will be many more abilities than classes, and most are variations on a
few ideas: hit an area now, hit an area after a fuse, burn an area for a while, lunge, power up for a while. Writing
each one as code would make tuning slow and every new ability a code change.

We also had to decide how the abilities sit next to the systems already there: potions (60 s self buffs), the
flask, the knight's shield, and saves.

## Decision

- **Classes and abilities are content.** `content/classes.json` names a class's three abilities;
  `content/abilities.json` defines each as a cast (lock time, release tick) plus a list of effects. There are four
  effect types: `blast`, `zone`, `dash` and `empower`. A new ability is a JSON entry; a new effect type is code.
- **Resources:** the AoE and class abilities have cooldowns. The super spends a full energy bar (0–100), filled
  by sword and ability hits, kills and a slow trickle. The super's own hits don't fill it.
- **Costs are paid at the release tick,** so a cast interrupted by a hit costs nothing.
- **No self-buff class ability.** The user asked for a buff/debuff slot only if it didn't step on potions; it
  would have. Class abilities are utility (a charge, a blink, a repel), and the only self-buff is the super's
  short, expensive mode.
- **Abilities answer the shield.** Ability hits are unblockable, and a stagger (from blasts and dashes) drops
  any enemy's guard. The knight is beaten by abilities or by baiting its charge.
- **Class changes happen at bonfires** (a `setClass` PlayerAction, only valid while resting). Resting and
  respawning ready the cooldowns; super energy is kept.
- **Keys:** F (AoE, aimed at the cursor), C (class), V (super).

## Consequences

- Balance is a content edit with hot reload, and the content validator checks that every class names an ability
  of the right slot.
- Save format v4 adds the player's `abilities` component (migration: every old save becomes a Vanguard).
- The player has no cast animations yet: casts borrow the swing, dashes the roll. Cast poses and ability icons
  are art requests.
- The loadout screen (class choice at a bonfire) waits for the UI kit; until then the `class` dev command and the
  `setClass` action are the way in.
