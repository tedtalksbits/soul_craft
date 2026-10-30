# Saves

## Format

```ts
{
  format: 'soul-craft-save',
  version: 1,                       // SAVE_VERSION in src/save/format.ts
  meta: { slot, savedAt, playTicks, location, souls, seed },   // for the slot list
  snapshot: SimSnapshot             // the complete simulation state
}
```

A save is a full snapshot, so loading resumes exactly where you were. Death still sends the player to their
last bonfire; that is game logic, not a load. The world itself is not stored: it is regenerated from
the seed, plus `tileOverrides` for anything the player changed.

## When it saves

- On every bonfire rest
- Every two minutes of play
- On "Save & quit" and when the tab is hidden
- Never while the player is dead

## Storage and safety

`SaveManager` writes through a `KeyValueStore` (IndexedDB in the browser; swap in a filesystem store for
desktop). Before each write the previous save is copied to `save:<slot>:backup`; if the primary fails to
parse or validate, the backup loads and the player is told.

## Changing the format

Anything that changes what's inside a snapshot (a component's fields, `SimState`, chunk keys) is a format
change:

1. Bump `SAVE_VERSION`.
2. Add `MIGRATIONS[oldVersion] = (save) => upgradedSave` in `src/save/format.ts`. Migrations are pure,
   never edited once shipped, and run in sequence.
3. Add a test that migrates a fixture of the old version (`tests/save/save.test.ts` shows the pattern).

Migrations so far:

| From | To  | Change                                                                                                                |
| ---- | --- | --------------------------------------------------------------------------------------------------------------------- |
| 1    | 2   | `SimState.tileDamage` added (multi-hit trees and mushrooms)                                                           |
| 2    | 3   | Items: the player gains `inventory`, `equipment` (the Chipped Sword), `buffs` and `Player.using`; pickups gain `item` |
| 3    | 4   | Classes: the player gains `abilities` (class Vanguard, abilities ready, no super energy)                              |
| 4    | 5   | Leveling and unlocks: the player gains `attributes` (all 0) and `abilities.unlocked` (both true, so nothing is lost)  |
| 5    | 6   | Bonfire travel: `SimState.bonfires`, the registry of lit bonfires (starts empty, fills as lit bonfires load)          |
| 6    | 7   | World map: `SimState.explored` (fog of war), `landmarks`, `lastDeath` and `pin` (all start empty)                     |
| 7    | 8   | Restoration and bosses: `SimState.restored`, `bossesDefeated` (both empty) and `bossFight` (none)                     |

Adding a new optional component needs no migration: old saves simply don't have it. Content changes need
none either: restore drops entities whose archetype no longer exists, and tile overrides referring to
removed tiles fall back to generated terrain.
