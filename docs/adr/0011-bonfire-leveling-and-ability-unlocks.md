# 0011. Souls buy levels at bonfires; abilities are awakened by relics

- Status: accepted
- Date: 2026-10-29

## Context

After Milestone 3's foundation, souls only paid for crafting and forge upgrades, so there was little long-term
progression, and every class had all three abilities from the first second. Both had to be settled before
bosses (Milestone 4): boss difficulty depends on how strong players can get, and bosses need rewards worth
fighting for.

## Decision

- **Leveling.** Resting at a bonfire, the player spends souls on a level in one of four attributes:
  **Vigor** (max health), **Endurance** (max stamina), **Might** (sword damage) and **Attunement** (ability
  damage and super charge rate). Each level costs more than the last: `round(base * growth^(level - 1))`.
  All numbers are content (`player.json → leveling`). Losing souls on death now costs something real.
- **Ability unlocks.** A new game knows only its AoE. The class ability and the super are **awakened by
  relics**, a new item kind that is taken on pickup (never carried):
  - the **Oath Ember** (class ability) drops from the first Forsaken Shrine guardian knight;
  - the **Sovereign Ember** (super) drops from the second, **as a stand-in**: Milestone 4 moves it to the first
    boss, which is a content change.
  - A relic only drops while its slot is the next to awaken, so each drops once, in order.
    Unlocks are per player, not per class: changing class keeps what you have awakened.
- **Old saves** (v4 and earlier) keep every ability they had and start leveling at level 1.

## Consequences

- Save format v5 (the `attributes` component and `abilities.unlocked`).
- The bonfire menu gains "Level up", a screen that, like the inventory, holds input but not the game.
- Locked abilities are shown dimmed in the HUD, on the class cards and in the Abilities tab, with what awakens
  them (each relic's `source` text), so players know there is more to earn and where.
- Relics use stand-in item icons until the art is made.
