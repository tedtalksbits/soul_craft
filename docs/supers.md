# Supers: design proposal

**Status: decided (2026-11-02). The three roaming supers are built (ADR 0013); the burst and defensive variants are next.** From the playtest: "Bladestorm is underwhelming, I don't feel
powerful, and it doesn't work with a bow. In Destiny the super has its own weapon for its duration. There are
different kinds of supers (roaming, defensive, DPS): the fantasy is there, it lacks implementation."

## Why the supers feel flat

- **Bladestorm** is a stat buff on whatever you hold (+60% damage, +30% crit, no stamina for 10 s). Nothing new
  appears and nothing plays differently, and with a bow you are still an archer.
- **Earthshatter** is a blast plus 10 s of 50% defense: a burst with a lingering buff, no new moves.
- **Cinder Storm** is an aimed blast plus a burning zone. The Ashcaller has no super you play through.

## What the research says

Destiny's roaming supers, Warframe's exalted weapons and God of War Ragnarök's Spartan Rage all solve this the same
way: **for the duration you get a dedicated weapon with its own moveset and its own damage**, whatever you had
equipped. Ragnarök's three forms map almost one to one onto Destiny's categories:

| Kind                  | What it is                                             | Destiny examples                        |
| --------------------- | ------------------------------------------------------ | --------------------------------------- |
| **Roaming**           | A new weapon or stance for 10 to 15 s; you fight in it | Arc Staff, Spectral Blades, Stormtrance |
| **Burst**             | One huge hit, cast safely                              | Nova Bomb, Thundercrash, Blade Barrage  |
| **Defensive/support** | A zone that protects or empowers you (and allies)      | Ward of Dawn, Well of Radiance          |

What sells the power, in every game looked at: a **new silhouette and moveset**; being **unstoppable** (hyper
armor plus damage resistance, never full invulnerability in a Souls-like); **ordinary enemies launched or
staggered on every hit**; an **activation moment** (a freeze, a short slow-motion, a camera punch, a color shift,
an audio sting); and an **ending with a payoff** (a final slam, a vanish, a nova) instead of a fade. Bungie's
recent balancing kept roaming supers strong through uptime and damage resistance, not raw damage, so they don't
race the burst supers.

Rules of thumb for us (starting numbers):

- **Roaming:** 2.5 to 3 × a light attack's damage per second, 10 to 12 s plus 1 s per kill (capped), 30 to 50%
  damage resistance, hyper armor, no stamina. Works with any equipped weapon.
- **Burst:** 15 to 20 × a light hit in one go, invulnerable while casting, never more than about a third of a
  boss's health.
- **Bosses:** super damage × 0.6 on bosses for roaming supers; super hits don't charge super energy.
- **Readability:** super effects draw under enemy telegraphs; a draining timer on the super icon, flashing in the
  last 2 s.

## The recommended set

Each class gets one roaming super (the new default) plus two alternatives, using the variant system that exists.

| Class         | Roaming (default)                                                                                                                                                                                                              | Burst                                                                                  | Defensive / support                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Vanguard**  | **Earthshatter:** a stone maul rises from the ground. Two wide sweeps, a leaping slam with a shockwave, a shoulder charge. 12 s, 50% resistance, a little slower. Ends in a final slam.                                        | **Avalanche:** the invulnerable charge ends in a crater (about 220 at today's numbers) | **Bastion:** a dome for 10 s: 40% resistance and +25% damage inside, and it stops enemy arrows                     |
| **Stalker**   | **Bladestorm:** twin shade blades. Three fast slashes that each snap a short lunge to the nearest foe, a phase-cut dash through a line, a blink strike. 10 s, 35% resistance, +40% speed, foes outlined. Ends in a 2 s vanish. | **Knife Fan:** rise, untouchable, and throw nine knives that home toward the target    | **Ghost Run:** kept as it is, the escape and opener                                                                |
| **Ashcaller** | **Cinder Storm:** your hands become the weapon. Rapid fire bolts, a held exploding cinder ball, a flame-step blink that leaves burning ground. 12 s, 30% resistance. Ends in a fire nova.                                      | **Meteor:** kept, with an invulnerable cast and a bigger impact moment                 | **Pyre:** plant a bonfire for 10 s: heals 3% of your health a second and +25% damage inside; foes at the edge burn |

The activation kit for all of them: an 8-tick freeze, then 0.3 s at about a third speed, a 6 px shake, the class
color washing over the screen, and its own sound.

## What it takes

**Content only:** the new ability entries and numbers, the super movesets, the descriptions, retuning Avalanche,
Knife Fan and Meteor.

**Code:**

1. **The super weapon:** a new ability effect (`wield`) and a table of super movesets shaped like weapon types,
   with damage from ability power. While one is wielded it replaces the equipped weapon's moves, so a bow-wielding
   Stalker gets blades. A save version bump.
2. **New move options:** a snap-lunge to the nearest foe, a shockwave on any move, a dash that leaves a zone.
3. **Timer rules:** extend on kill, effects that fire when it ends, a warning 2 s before.
4. **Zone additions:** a damage buff and healing inside, and blocking projectiles.
5. **Homing knives**, an **invulnerable cast**, and the **boss multiplier**.
6. **Client feel:** the freeze and slow-motion, the camera punch and color wash, the draining timer, super weapon
   art (the player sheet comes from the `tools/art` generator, so its script changes).

Suggested order: the super weapon framework with Bladestorm first (it is the one the playtest called out, and it
proves the framework with the bow case), then Earthshatter and Cinder Storm, then the burst and defensive
variants.

## Built so far (2026-11-02)

- **The framework:** the `wield` effect, `weapons.json → supers`, the `seek` move option, damage resistance, no
  flinching, extra time per kill, a boss damage share, no super energy during a super, and a finale. The HUD's super
  slot drains while it lasts and blinks in the last 2 s; casting it stops the world for a beat, then runs slow for
  0.3 s, with a shake, a burst in the class color and its own sound.
- **Bladestorm** puts the **shade blades** in hand: three fast slashes (2 × a light hit each, the third a thrust)
  that snap to a foe within 56 px and 35° of the aim, a held phase cut that lunges through a line (5 ×), and a blink
  strike out of a roll. 10 s, +1 s a kill (up to +6 s), 35% less damage taken, 40% faster, free stamina, 0.6 of its
  damage on bosses, and a 2 s vanish when it ends. It works the same with a bow in hand.
- **Earthshatter** puts the **stone maul** in hand (it counts as a hammer, so it crushes staggered foes and its
  full-charge leaping slam sends out a 56 px shockwave): two wide sweeps (3 × a light hit, the second all around),
  the slam (6 ×), and a shoulder charge through foes. It opens with a 64 px ring, lasts 12 s (+1 s a kill, up to
  +5 s), takes half the damage, and ends in an 80 px slam.
- **Cinder Storm** puts the **cinder stave** in hand: fire bolts (1.5 × each, one every 10 ticks), a held cinder
  ball that bursts 40 px around where it lands (6 ×), and a ring of fire out of a roll. Its fire needs no Embers.
  It opens with a small ring, lasts 12 s (+1 s a kill, up to +5 s), takes 30% less damage, moves 10% faster, and
  ends in a 72 px nova.
- **The look in hand** borrows the weapon layers: the daggers tinted shade violet, the hammer in ochre stone, the
  staff burning orange. The doc first described the Ashcaller's as "hands become the weapon"; a stave reads better
  as a weapon on the character. Dedicated art can come later from the `tools/art` player generator.

## Decisions (2026-11-02)

1. **The roaming super is every class's default:** Earthshatter, Bladestorm and Cinder Storm become the roaming
   supers; the bursts and defensive supers are their variants.
2. **The super weapon shows on the character:** a stone maul, twin shade blades and the caster's burning hands,
   drawn in the `tools/art` player generator.
3. **Earthshatter keeps its name.**

Research notes and sources are summarized here; the details (Destiny's super history, Warframe, God of War,
Diablo IV, Hades) came from a research pass on 2026-11-02 that could not reach Bungie's own site, so Destiny
specifics are from press coverage and recall.
