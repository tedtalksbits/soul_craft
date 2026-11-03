# 0013. Roaming supers put a super weapon in the player's hands

- Status: accepted
- Date: 2026-11-02
- Extends: [0010](0010-classes-and-data-driven-abilities.md)

## Context

The playtest called Bladestorm underwhelming: it was an `empower` effect (more damage, more crits, free stamina
for 10 s) on whatever the player held. Nothing new appeared, the moves didn't change, and with a bow it wasn't a
blade at all. The research in `docs/supers.md` found Destiny, Warframe and God of War all solve this the same way:
the super gives you a dedicated weapon with its own moveset for its duration. The owner chose roaming supers as
every class's default, with the super weapon shown on the character.

## Decision

- **A new ability effect, `wield`,** names a super weapon and how long it lasts, its damage resistance, speed,
  time gained per kill (capped), its damage share on bosses, and a finale (a vanish and/or a blast).
- **Super weapons are content:** `weapons.json → supers`, each a weapon type's moves and rules plus its own base
  numbers, the weapon type it counts as (`as`), and its look in hand (a weapon layer of the player sheet, tinted).
- **While wielded, the super weapon replaces the held one everywhere the weapon type is asked for** (`weaponType`):
  its chain, charged move, dash attack and signature, whatever the player holds. Its damage comes from its base
  numbers times ability power (Attunement), not the held weapon's perks or Might, and it costs no stamina.
- **The resistance, speed and free stamina ride on an `Empowered`** lasting as long, and a `Wielding` component
  (new, so no save change) holds the weapon, the time left and the kill bonus.
- **Fairness rules:** the player never flinches while wielding; its blows on a boss do a share (0.6 for
  Bladestorm); nothing done during a super charges the next one.
- **A new move option, `seek`,** snaps a move toward the nearest foe within its distance and 35° of the aim.

## Consequences

- A new roaming super is a `wield` entry plus a super weapon in content; only new kinds of moves need code.
- The bow case works by construction: the player's equipped weapon is simply not consulted while wielding.
- Super weapons borrow existing weapon layers for their look (the shade blades are the daggers layer, tinted
  violet). Dedicated art, if wanted, is a change to the `tools/art` player generator.
- Earthshatter and Cinder Storm still use their old effects until their super weapons are built.
