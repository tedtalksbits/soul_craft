# 0009. Menu actions travel through the InputFrame

- Status: accepted
- Date: 2026-10-29

## Context

Milestone 2 adds things the player does from a menu rather than with a button press: equip, unequip, use an item,
set the quick item, craft, upgrade. ADR 0002 keeps the sim deterministic by making the `InputFrame` its only
input. The easy alternative, letting the inventory screen call `equip()` or `craft()` directly, would change sim
state outside a tick. Replays, lockstep co-op and "same inputs, same game" would all quietly break.

## Decision

`InputFrame` gains an optional `actions: PlayerAction[]`, a discriminated union (`equip`, `unequip`, `use`,
`setQuick`, `craft`, `upgrade`). The client queues them (`InputCapture.queueAction`) and they ride on the next
tick's frame. The owning modules apply them in the `control` phase and re-check everything (station in reach,
souls, materials, room), so a stale or forged action fails with an event (`craftFailed`) rather than corrupting
state.

The menu reads sim state through the same pure checks the actions use (`canCraft`, `canUpgrade`, `playerStats`),
so what it shows and what the sim allows cannot drift.

Related decisions made with it:

- **Potions are buffs alongside the flask**, not a replacement for it. The Estus-style flask stays the
  emergency heal, refilled at bonfires. Crafted consumables are timed buffs (damage, defence, stamina regen) or a
  small heal (bandage), and use the same drink state, so using one in combat carries the same risk.
- **Quality is predictable**: gear tiers come from materials (iron sword beats chipped sword), and a weapon is
  improved by forge upgrades (+1, +2, +3) with fixed costs. Random perks or rolled quality are deferred until
  there is loot worth rolling. An upgrade level lives on the `ItemStack` (`level`), so adding perks later is a
  new field, not a new model.
- **The inventory does not pause the game.** It holds movement and combat input (`App.inputHolds`) while the
  world keeps ticking, as in the Souls games.

## Consequences

- Menu actions are replayable and testable headless: tests feed `inputFrame({ actions })`.
- Every new menu verb is a new `PlayerAction` variant plus a handler in its module. The type is a closed union,
  so the compiler finds every place that must handle it.
- The client cannot see the result of an action until the next tick; the screen redraws when the state it shows
  changes, which is within one frame.
