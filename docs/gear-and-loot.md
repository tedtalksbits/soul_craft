# Gear, loot and the hunt: design proposal

**Status: draft 2 (2026-10-31). The owner settled its eight open choices (section 12); nothing is built yet.**
This turns the owner's playtest notes into a full design, backed by research into what players of earlier games
loved and hated. As each phase is built, it moves into `docs/roadmap.md` and an ADR. The design aims high on purpose: it is easier to dial back
something too strong than to rescue something dull.

The shift in one line: **gear stops being crafted and starts being hunted.** Weapons and armor drop from enemies
and Wardens with random tiers and perks. Crafting shrinks to alchemy, tools and work at the smithy. That changes
pillar 3 from "Gather and craft" to **"Hunt and forge": foes drop your gear, and the forge, the alchemist and the
village turn what you gather into power.**

---

## 1. What the research says (the short version)

Each lesson below drives one or more rules in this proposal. The sources are listed at the end.

| #   | Lesson                                                                                                                                                               | Comes from                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | **Fewer, better drops** is the most repeated fix in the genre. Too few also fails.                                                                                   | D3 Loot 2.0, D4 "Loot Reborn", Grim Dawn 1.1.7; PoE 2 and No Rest for the Wicked drop buffs |
| 2   | **Souls-likes that added Diablo-style loot were punished for clutter**, and their boss rewards stopped feeling special.                                              | Nioh 2, Wo Long; Remnant as the counterexample ("every item a legendary")                   |
| 3   | **A perk that does nothing for your item or class is the most hated outcome.**                                                                                       | Anthem inscriptions, Wolcen jewelry, D3 vanilla, D4 random affixes on uniques               |
| 4   | **Affix bloat is noise.** D4 cut legendaries from 4 affixes to 3 and players cheered. Conditional micro-affixes ("+X% vs. slowed enemies") read as filler.           | D4 Season 4                                                                                 |
| 5   | **Narrow roll ranges** give steady progress. Wide ranges cause long droughts.                                                                                        | D3 Loot 2.0                                                                                 |
| 6   | **Signature items have a fixed identity with rolled numbers.** Randomizing what a unique _does_ destroys it.                                                         | D2 uniques, D4's 2026 random-affix uniques                                                  |
| 7   | **Determinism is a safety net, not a replacement for drops.** Full crafting killed "any drop could matter."                                                          | Destiny 2 crafting rollback                                                                 |
| 8   | **Every weapon type needs its own verb.** Numbers alone collapse into "best numbers win."                                                                            | Death's Door (Umbrella vs. Hammer), Hades, Nioh stances                                     |
| 9   | **Finite ammo is disliked almost everywhere.** Stamina as ammo puts ranged play inside the Souls budget.                                                             | Elden Ring arrows, Hades Rail reloads, Enter the Gungeon, Monster Hunter bow                |
| 10  | **Heavy weapons are loved for stagger and hyper armor**, not for raw damage.                                                                                         | Elden Ring great hammers, Hades II axe                                                      |
| 11  | **Failure chances, downgrades and durability are hated.** Visible budgets are fine.                                                                                  | Last Epoch fracture removal, D4 masterworking, MH Qurious crafting, DS2 durability          |
| 12  | **Gate the reward, never the fight.** Paying materials to start a boss fight was D4's worst grind, and it was fixed by making the fight free and the chest the cost. | D4 Seasons 2–8                                                                              |
| 13  | **Bad-luck protection must be visible and end in a hard guarantee.** A token backstop is trusted most.                                                               | Destiny raid exotics, WoW Cartel Chips, Lost Ark Artisan's Energy                           |
| 14  | **Players want boss refights.** It is Elden Ring's most requested feature, and DS2's Bonfire Ascetic is the closest prior art.                                       | Elden Ring, DS2, Hollow Knight Godhome, Remnant alternate kills                             |
| 15  | **A power number is liked as a progress read and hated as a gate.** It must never disagree with real strength.                                                       | Destiny Edge of Fate, Division 2, Lost Ark, D4 item power                                   |
| 16  | **Offline games should pause.** Elden Ring's hidden pause got headlines.                                                                                             | Elden Ring, Souls forums                                                                    |
| 17  | **"Kill 10 rats" is hated for having no motive, not for the killing.**                                                                                               | Valheim's first goal, MMO quest design                                                      |

---

## 2. The bonfire (bug fixes, no design dependencies)

1. **Opening any menu pauses the game: bonfire, inventory, equipment, system.** The sim stops ticking, so nothing
   can see you, reach you or hit you. This is the owner's call and matches lesson 16.
2. **You can't rest with enemies chasing you.** Rest is refused with "Enemies nearby" while anything is aggroed on
   you, so a bonfire can't be used as an escape button. Lighting a bonfire still works.
3. **Changing gear in combat:** the equipment screen opens and pauses, but equipping is disabled within 3 s of
   taking or dealing damage ("Can't change gear in combat"). Viewing still works. Flasks stay on the quick slot.
4. **Respawns become random and stay away from the bonfire.**
   - Each rest rolls new positions from a seed drawn from `sim.rng`, so the same rest always gives the same result.
   - Each enemy respawns at a random walkable tile inside its own chunk.
   - Nothing respawns within 10 tiles of the bonfire you rested at, and nothing spawns on screen.
   - Placed elites and bosses keep their authored spots.
5. **Farming stays allowed but can't break progression.** DS2's despawn limit made players angry, so there is none.
   Instead:
   - Souls from enemies far below the player's level band fall off.
   - Loot tiers are capped by the area (section 6).

**Old saves:** `SAVE_VERSION` bumps with no migration. Loading an older save shows "This save is from an older
version of the game and can't be loaded. Start a new game." with a New Game button.

---

## 3. Slots and the equipment screen

**Six slots:**

- **Left column:** Weapon, Ring, Ring.
- **Right column:** Helmet, Chest, Legs.

The shield slot is gone. The game already has two ring slots, so the owner's 3 + 3 layout fits without new
code. The Vanguard keeps a shield as part of their ability art (Shield Charge, Bulwark Rush), not as gear.

```
                         E Q U I P M E N T
   WEAPON                    POWER 248                    ARMOR
 ┌──────────────────────┐                     ┌──────────────────────┐
 │ Ashen Longsword      │      (character      │ Sentinel Hood        │
 │ Sword  31 ATK   RARE │     sprite showing   │ 12 ARMOR       RARE  │
 ├──────────────────────┤     the gear worn)   ├──────────────────────┤
 │ Ember Signet         │                     │ Ironbound Plate      │
 │ +3 Might       NOBLE │                     │ 27 ARMOR      NOBLE  │
 ├──────────────────────┤                     ├──────────────────────┤
 │ Ring of Breath       │                     │ Wanderer's Greaves   │
 │ +18% regen  STANDARD │                     │ 15 ARMOR       RARE  │
 └──────────────────────┘                     └──────────────────────┘
        ATTACK 31   ·   ARMOR 54 (47% less damage)   ·   HP 164   ·   STAMINA 118
        VIGOR 12   ENDURANCE 9   MIGHT 14   ATTUNEMENT 6
```

- **Clicking an equipped item opens its details** (stats, perks, upgrade level). Unequipping is a button inside
  the details panel, never a bare click. That fixes the owner's complaint that clicking was the only way to see
  stats, and that it took the item off.
- **Comparing.** Selecting any bag item shows it side by side with the item equipped in that slot. The top row shows
  the real changes: "Power +12 ▲", "Attack +3 ▲", "Damage taken −4% ▲", "HP −8 ▼". The game works these out by
  trying the item on a copy of the player in the sim, so they include soft caps and the armor curve. Perk lines
  gained show in green, perks lost in red. This is the default, not a hidden option (D4 lesson). The triangles
  mean color is never the only cue.
- **Character stats** show the four existing attributes plus the numbers they produce. Strength and Agility are
  not added: Vigor, Endurance, Might and Attunement already cover them.

---

## 4. Stats, armor and Power

### Attributes (kept, with soft caps)

Leveling keeps its four attributes. Gains soften past two breakpoints (all in `player.json`):

| Attribute  | Levels 1–20 | 21–40 | 41+ |
| ---------- | ----------- | ----- | --- |
| Vigor      | +8 HP       | +5    | +2  |
| Endurance  | +6 stamina  | +4    | +1  |
| Might      | +5% damage  | +3%   | +1% |
| Attunement | +5% ability | +3%   | +1% |

The level-up screen shows the breakpoints ("+2, softened"). Players dig breakpoints out of wikis when a game hides
them. Gear can add attribute points: helmets and rings roll +1 to +3, Legendaries up to +5. Points from gear count
toward the soft caps, so stacking one attribute has diminishing returns.

### Armor: one number, one curve

- **Armor total:** Armor = helmet + chest + legs (+ flat armor from perks).
- **Damage taken:** hit × K ÷ (K + Armor), with **K = 60**. Each percentage-reduction perk then multiplies on top,
  Elden Ring style. Reduction is capped at **75%**, and every hit does at least 1 damage.
- **Why this curve:** it is the League of Legends shape. Every armor point is worth the same +1.67% effective HP,
  so comparisons stay honest, while percentage reduction naturally slows down and never reaches 100%.
- **Why not Path of Exile's formula:** its reduction depends on hit size, so trash enemies become harmless and
  bosses stay unchanged. That is backwards for a Souls-like.

| Armor | Damage reduction | Typical loadout           |
| ----: | ---------------: | ------------------------- |
|    13 |              18% | Full Common, first area   |
|    30 |              33% |                           |
|    60 |              50% |                           |
|    86 |              59% | Full Legendary, late game |
|   180 |     75% (capped) | Only with dedicated perks |

The screen always shows the percentage next to the number ("Armor 54, 47% less damage"), with a "capped" marker at
the cap. D4 players kept stacking armor past its cap because nothing told them it had stopped helping.

### Power: a true number, never a gate

**Power = round(100 × √(Offense × Defense)).**

- **Offense:** weapon damage per stamina, after Might, crits and perks, relative to the starting loadout.
- **Defense:** effective HP, which is maximum HP × (1 + Armor ÷ K) after percentage perks, relative to the start.
- A new character is **Power 100**.

The geometric mean rewards balance and can never disagree with how strong you actually are. That disagreement is
how D4's item power and Anthem's gear score misled players. Power is a progress read on the equipment screen and
in comparisons. **Nothing in the game is gated on it, and it never resets.**

---

## 5. Weapon types

Weapons are not tied to a class: any class can use any type. Each class has an affinity with two types, a bonus
of about 10–15%, so off-affinity picks still work (lesson from Children of Morta, Hades and Elden Ring). Every type
follows the same input rules, so learning one teaches the rest:

- **Tap:** light attack. A short chain whose last hit, the finisher, differs.
- **Hold:** charged attack, with a payoff at full charge.
- **Attack right after a roll:** a dash-strike unique to the type. It is the cheapest source of feel in Hades.
- **Hyper armor:** only on hammer swings and full charges.
- **Hitstop:** set per type, from about 1 tick for daggers to 9 for a full-charge hammer. Hitstop is what makes heavy
  hits feel heavy.

Super energy already fills per point of damage, not per hit, so fast weapons won't dominate super uptime. Death's
Door's daggers did exactly that, so the rule stays.

Numbers are relative to today's sword (Chipped Sword: 12 damage, 14 stamina, reach 16, width 18):

| Type            |               Damage |  Stamina |  Reach | Width | Speed | Stagger | Signature rule                                                                                                                                                                  | Weakness                                        | Affinity           |
| --------------- | -------------------: | -------: | -----: | ----: | ----: | ------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------ |
| **Sword**       |                  1.0 |      1.0 |    1.0 |   1.0 |   1.0 |     1.0 | **Flow:** a light hit within 12 ticks of rolling through an attack crits and refunds the roll's stamina.                                                                        | Never the best at anything                      | All                |
| **Spear**       |                  0.9 |      0.9 |    1.6 |  0.45 |   1.0 |     0.8 | **Tipper:** the outer third of reach does +40% with extra knockback. Up close the haft shoves enemies out to tip range. +30% against enemies mid-attack.                        | Narrow; weak up close; sweep is costly          | Vanguard           |
| **Hammer**      |                  1.8 |      1.7 |   1.05 |   1.3 |   0.6 |     3.0 | **Break:** fills Warden stagger 3× faster. Hyper armor through the swing. A full-charge slam lands a shockwave even if it misses. Slamming a staggered foe crits ("crush").     | Long recovery; no roll-cancel before impact     | Vanguard           |
| **Daggers**     |                 0.45 |      0.4 |    0.7 |   0.8 |   2.0 |     0.3 | **Flank:** hits from behind crit for +50%. Hits stack Bleed; 5 stacks burst and briefly stagger.                                                                                | Stay inside enemy reach; no knockback           | Stalker            |
| **Bow**         |                  0.5 | per shot | screen |     – |   1.0 |     0.2 | **Pin:** arrows lodge in enemies (up to 5). A **Perfect Shot** (release in a 6-tick window at full draw) does +60%, pierces, staggers, and rips out every pin for bonus damage. | Slowed while drawing; lowest damage per stamina | Stalker, Ashcaller |
| **Ember staff** | 0.6 melee / 1.4 bolt |      1.0 |    1.3 |   1.4 |   1.0 |     0.8 | **Strike to cast:** each melee hit stores an Ember (up to 4). The charged attack fires a fireball that spends one.                                                              | Has to stay close to reload                     | Ashcaller          |

**Chains, charges and dash-strikes:**

| Type        | Light chain               | Charged attack                          | Dash-strike         |
| ----------- | ------------------------- | --------------------------------------- | ------------------- |
| Sword       | 3 hits, thrust finisher   | Lunging thrust, 1.5× reach (gap closer) | Forward slash       |
| Spear       | 2 thrusts                 | 360° sweep (answers being surrounded)   | Long running thrust |
| Hammer      | 2 overheads, long wind-up | Ground slam with shockwave              | Hop slam            |
| Daggers     | 5 fast hits               | Dash-lunge through the target           | Spinning ring cut   |
| Bow         | Quick shot (tap)          | Draw: moving at 40%, stamina draining   | Backflip shot       |
| Ember staff | 3 wide bonks              | Fireball (a weak spark with 0 Embers)   | Sweeping bonk       |

**The bow uses no arrows.** Stamina is its ammo, and drawing drains it (the Monster Hunter bow). Finite ammo is
either hoarded or ignored, and players dislike it everywhere it has appeared. Four things stop kiting together:
the slow draw, near-zero knockback, Pin making burst damage need several hits in a row, and Wardens that already
charge across the arena. If kiting still wins in playtests, the fix is a Warden move that punishes distance (a
pull or a nova), not a damage nerf.

**Class affinities, for example:**

- **Vanguard:** with a hammer, hyper armor lasts through Shield Charge's recovery. With a spear, Shield Charge ends in a free tipper thrust.
- **Stalker:** with daggers, Vanish and False Step make the next hit a Flank crit. With a bow, a Latch target is pinned automatically.
- **Ashcaller:** with the staff, abilities grant Embers. With a bow, pins ignite.

**Build order:** sword (the rework of today's weapon), spear and hammer first, since they are mostly data plus their
signature rules. Then daggers, then bow and staff, since those need projectiles and new verbs. A scythe or whip
waits until a playtest shows a play style nobody covers. That is how Supergiant added the Twin Fists.

---

## 6. Loot: tiers, perks and drops

### Tiers

The owner's names, colors and perk counts, adjusted only for Legendary:

| Tier      | Color  | Rolled perks | Fixed perks                               | Base-stat multiplier | Perk strength |
| --------- | ------ | -----------: | ----------------------------------------- | -------------------: | ------------: |
| Common    | White  |            0 | –                                         |                ×1.00 |             – |
| Standard  | Green  |            1 | –                                         |                ×1.15 |         ×1.00 |
| Rare      | Blue   |            2 | –                                         |                ×1.30 |         ×1.10 |
| Noble     | Purple |            3 | –                                         |                ×1.50 |         ×1.20 |
| Legendary | Gold   |            3 | 2: a legendary power and its partner perk |                ×1.75 |         ×1.30 |

**Legendary keeps five perks, but two are fixed.** Five random lines make a Legendary "a Rare with more rows" and
almost guarantee at least one dud (D3 vanilla, Borderlands 3). Two fixed lines give it an identity, and three
rolled lines make each copy worth checking.

**Common has no perks.** Starting gear is Common, as the owner asked, and it gives a clean baseline that makes the
first green feel like an event.

### Item level comes from the place, rarity from luck

Each biome sets the item level of what drops there:

| Biome          | Item level |
| -------------- | ---------: |
| Meadow         |          1 |
| Fungal wilds   |          2 |
| Ashen hills    |          3 |
| Pale graveyard |          4 |
| Sunken ruins   |          5 |

- Base stats grow about 25% per item level.
- Rarity mostly controls how many perks an item has, and only lightly how strong each one is. A well-rolled Rare
  from the hills can beat a weak Legendary from the meadow, which is the healthy dynamic in Last Epoch.
- Refought Wardens drop at the player's current item-level band, so farming an early Warden stays worthwhile.

### Rolls

- **Perk values roll within ±15%.** Narrow ranges give steady progress instead of D3-style droughts.
- **Greater perks.** On Noble and Legendary items, about 1 perk in 20 rolls as a **Greater** perk at 1.5× strength.
  It is marked with a star and has its own chime. No content is ever balanced around them. D4's Greater Affixes and
  Last Epoch's tier 7 affixes play this role, and players screenshot them.
- **Blighted items** (rare, about 4% of Rare and better drops). One drawback perk (for example "−10% max HP") plus
  every other perk at 1.4×. The smithy can cleanse the drawback for a price, or you keep the gamble. It suits the
  game's tone and the blight in its fiction, and comes from No Rest for the Wicked's plagued items.
- **Every item carries its own roll seed**, drawn from `sim.rng` when it drops. Rerolls advance only that item's
  seed, so reloading a save gives the same reroll instead of letting players fish for results. Monster Hunter
  Wilds' seeded rerolls became a save-scumming chore.
- **No two perks from the same family on one item** (no doubled "+damage").

### Perk pools

Every perk does a clear thing or changes a named ability. **No conditional micro-perks.** Pools are defined per
slot and weapon type, and the content validator rejects any perk that can't work on the item it rolls on (the
Anthem and Wolcen failures). Pure stat perks are kept to about a third of each pool.

| Pool             | Example perks                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Every weapon** | +damage % · crit chance · crit damage · −attack stamina % · +stagger · heal on kill · souls on kill %                                                                                                                              |
| **Sword**        | Finisher thrust pierces (+30%) · lunge has i-frames · a full chain refunds 25% stamina · hits extend an enemy's stagger · Flow crits fill the super · +25% on enemies mid-attack                                                   |
| **Spear**        | Tipper hits pierce to a second foe · thrown spear that can be pulled back, dragging the target · the sweep pushes everything out to tip range · +1 thrust in the chain · Shield Charge can be held while thrusting                 |
| **Hammer**       | Full-charge slam leaves a fire or shock ring · Momentum: each hit within 2 s cuts wind-up 15% (×3) · crushing a staggered foe refunds stamina · hyper armor covers the charge too · the dash-strike staggers small foes around you |
| **Daggers**      | The lunge ends behind the target · Bleed bursts restore stamina · every 5th hit is free · crits from hiding apply full Bleed · bleeding foes take +10% from everything                                                             |
| **Bow**          | Wider Perfect window · tapping with a foe up close kicks it away · the charged shot splits in 3 · pins burn or bleed · shots while rolling cost no extra stamina                                                                   |
| **Ember staff**  | A full-Ember shot explodes · abilities also grant Embers · bonks knock back · fireballs pierce · +5% ability fire damage per Ember held                                                                                            |
| **Helmet**       | +1 to +3 to an attribute · −class ability cooldown % · +ability damage % · +super energy gain %                                                                                                                                    |
| **Chest**        | +armor · +max HP · overshield after resting · once every 12 s, a hit that would stagger you doesn't                                                                                                                                |
| **Legs**         | +roll distance · +2 i-frame ticks on rolls · −roll stamina % · +move speed · +stamina regen                                                                                                                                        |
| **Ring**         | +1 to +3 to an attribute · +flask healing % · +1 flask charge (Noble+) · +souls gained % · **class perks** (below)                                                                                                                 |
| **Class perks**  | Built from the class modifier effects that already exist (kill, hurt, cooldown, cast shield, ambush): "Shield Charge leaves you shielded", "kills in your fire cool Fire Pot", "blows out of hiding +25%"                          |

**Smart loot:** about 85% of class perks that roll are for the class you're playing. Weapon types roll freely,
because any class can use any weapon. With three classes and no trading, off-class perks would just be junk (D3
Loot 2.0).

### Legendary powers

Each Legendary base has one hand-made power that changes a verb, the way Hades aspects do, plus a fixed partner
perk. For example:

| Item                                  | Power                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| **Cinderbrand** (sword)               | The finisher thrust throws a small fire pot where it lands.                         |
| **Oathspear** (spear)                 | Tipper hits mark a foe. Shield Charge into a marked foe staggers it outright.       |
| **Gravebell** (hammer)                | A full-charge slam rings a bell that pulls nearby foes in before the shockwave.     |
| **Twinfang** (daggers)                | Vanish lasts until you have struck twice.                                           |
| **Pale Wind** (bow)                   | A Perfect Shot refunds your next roll's stamina.                                    |
| **Hearthwood** (staff)                | Embers heal you a little when spent.                                                |
| **Crown of the Unforgotten** (helmet) | Your super charges while you stand still.                                           |
| **Ring of the Last Ember** (ring)     | Once per rest, a killing blow leaves you at 1 HP instead and fully refills stamina. |

### Drop rates (starting values, all in content JSON)

| Source                   | Chance of gear                 | Common / Standard / Rare / Noble / Legendary |
| ------------------------ | ------------------------------ | -------------------------------------------- |
| Fodder (slime)           | 3%                             | 58 / 27 / 11 / 3.5 / 0.5                     |
| Regular (hollow, archer) | 8%                             | 58 / 27 / 11 / 3.5 / 0.5                     |
| Elite (knight)           | 100%, and it visibly wields it | 0 / 55 / 32 / 11 / 2                         |
| Warden chest             | Always (section 8)             | Rare or better                               |

- **Elites carry their drop.** A knight holding a glowing blue spear drops that blue spear. It's a readable promise
  in a pixel game, and Grim Dawn's named-monster drops show how well it works.
- **Global pity.** Each drop of Rare or lower adds to a hidden counter. After 40 such drops in a row, the next one
  is guaranteed Noble or better (the D3 two-hour pity, scaled to shorter sessions).
- **Never more than 2 items from one kill.** The 24-slot bag makes volume matter more than any filter.

### Drop feel

- **Ground labels** in the tier color.
- **A light beam** for Noble and Legendary, plus a pip on the minimap.
- **A chime** for Rare and above, a heavier bell for Legendary, and a separate star sound for a Greater perk. The
  D3 legendary "clang" was the reward moment.
- **Each tier has its own icon border shape**, so players who can't tell the colors apart can still read the tier.
- **Nothing that isn't loot ever reuses a tier's beam or sound.** D3 removed the legendary beam from Rift keys
  because it lied.

### Clutter

- **A "worse" marker.** Items that would lower your Power in their slot get a "↓" badge.
- **Auto-salvage.** A toggle for Common, on by default after the first area, and an optional one for Standard.
- **Mark as junk, then "Salvage all junk"** at a bonfire or the smithy.
- **Locking.** One press locks an item. Bulk salvage never touches locked, Noble or Legendary items without a
  separate confirmation. A D4 patch made "Salvage all" include legendaries, and players lost gear.

---

## 7. Crafting shrinks, and every material keeps a job

Forge recipes for weapons, armor and rings go away: Iron Sword, Bone Cleaver, Padded Jacket, Iron Mail, Ring of
Vigor and Ring of Breath become loot. **The rule: every material has at least two uses, nothing can fail, and
salvage never pays souls,** so there's no item-to-souls loop to farm.

| Sink                                                     | What it does                                                                                                                                                                             | Cost                                                                                                           | Why players accept it                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Salvage** (smithy)                                     | Breaks gear into materials. Weapons give iron and bone, armor gives stone and bone, Legendaries also give a Warden Mark.                                                                 | Free. Yields: Common 1 · Standard 2 · Rare 3+1 · Noble 4+2+1 · Legendary 6+3+Mark                              | Junk becomes progress (Last Epoch's fix)                                               |
| **Temper: reroll one perk** (smithy)                     | Pick one perk to reroll. Then choose between the old perk and **two** new ones. After the first temper, only that perk can be rerolled on that item. Legendary fixed perks never reroll. | 40 souls + 2 bone shard, × tier (Rare 1, Noble 2, Legendary 3). +50% per temper on the same item, capped at 4× | No failure, a capped price, and the full pool is shown. Drops still matter (D3 Mystic) |
| **Upgrade** (forge, then smithy)                         | Today's upgrade steps, now for armor too (stone + bone shard). The restored smithy unlocks the later steps.                                                                              | Today's costs                                                                                                  | Souls tempering, kept                                                                  |
| **Infuse**                                               | Moves an old item's upgrade level onto a new item, so a better drop never resets your investment.                                                                                        | 25% of the materials originally spent                                                                          | Players refuse new drops when switching wipes their upgrades                           |
| **Cleanse**                                              | Removes a Blighted item's drawback.                                                                                                                                                      | 200 souls + 3 glowspore                                                                                        | Optional gamble                                                                        |
| **Coatings** (alchemy)                                   | Temporary weapon oils: fire, bleed, +damage to Wardens. Last 90 s.                                                                                                                       | 2 glowspore + 1 slime gel, or fungal cap + bone shard                                                          | Optional and consumable (Souls resins)                                                 |
| **Tools** (craft)                                        | The axe and pickaxe from "Later" in the roadmap, in tiers: faster gathering, more yield, needed for richer nodes.                                                                        | Ashwood, stone, iron                                                                                           | A progression step, not a tax                                                          |
| **Warden Sigils** (forge)                                | Raises a refight's Heat (section 8).                                                                                                                                                     | 150 souls + 3 bone shard + 2 iron scrap                                                                        | Optional, and pays back more                                                           |
| **Ranked village projects**                              | Each project gets ranks II and III (Well II: +1 flask; Storehouse II: +8 slots), plus cosmetic projects such as statues, banners and gardens.                                            | 2.5× and 6× the rank I souls, plus materials; rank III also needs a Warden Mark                                | Visible, permanent, and fits the story                                                 |
| **The Ember Gambler** (a villager restored by a project) | Sells an unidentified item for a slot you choose.                                                                                                                                        | 250 souls, scaled by level band: Standard 68%, Rare 25%, Noble 6%, Legendary 1%                                | Soaks up late souls and lets players aim at a slot (D3 Kadala)                         |
| **Respec**                                               | Resets your attributes.                                                                                                                                                                  | The souls for one level at your current level                                                                  | Cheap enough to experiment                                                             |

**Not doing:** durability or repair (the DS2 lesson), failure or downgrade chances, materials that only one recipe
uses (Destiny deleted those), reroll costs with no cap, and salvage that yields souls.

**What happens to each material:**

| Material                         | Uses after the change                                    |
| -------------------------------- | -------------------------------------------------------- |
| Ashwood, Stone                   | Projects, tools, armor upgrades                          |
| Iron Scrap                       | Weapon upgrades, tools, Sigils, the Lamp Posts           |
| Bone Shard                       | Upgrades, tempering, Sigils, coatings, Stoneskin Draught |
| Fungal Cap, Glowspore, Slime Gel | Alchemy, coatings, cleansing                             |

---

## 8. Wardens: chests, signature items and refights

### First kill (the story)

Everything the first kill gives today stays: the souls, the Kindling, the relic, the extra modifier slot, and
**the Warden's modifier, unlocked on the spot** (Warden's Resolve, Shade or Pyre). The story reward never depends on
luck. On top of that, the first chest is a normal chest (below), with a Noble guaranteed among its items.

### Signature items

Each Warden has one named Legendary. The Ashen Warden's is **The Warden's Aegis**, a chest plate since the shield
slot is gone.

- **Its power is its own, separate from the Warden's modifier,** so the item still matters to a player who has
  the modifier. For example, the Aegis: "after a roll, the next blow that lands on you is blocked by a ring of
  embers that bursts outward". That means one hand-made power per Warden.
- **Its other perks roll, so farming copies chases a better roll** around the fixed power.
- **Every chest, the first included, has a chance at it**, with pity and Marks (below).
- **An alternate kill (optional, a Remnant-style secret).** Each Warden has one hidden condition, for example
  slamming the Ashen Warden into the braziers three times. Meeting it swaps the signature drop for a second named
  item, a sidegrade with its own power.

### Refights

Lesson 12 says gate the reward, never the fight. And the owner wants **a chest every time**.

- **Rekindle.** After the first kill, the arena bonfire offers "Rekindle the Warden". The fight is free and the
  chest always appears.
- **The repeat chest** (the first chest is the same, plus the guaranteed Noble):
  - About 35% of the first kill's souls.
  - A bundle of materials.
  - One Warden Mark.
  - Two items: Rare 60%, Noble 32%, Legendary 8%.
  - A roll for the signature item.
- **Pity on the signature item.** It starts at 12% and rises 6% with each chest that misses. It's guaranteed on the
  8th chest, so a copy takes about 3.5 chests on average. Pity is stored per Warden and shown on the chest as
  "the embers stir…".
- **The token backstop.** 6 Warden Marks buy a copy outright at the Warden's shrine (Destiny's Spoils of Conquest
  and WoW's Cartel Chips). Salvaging Legendaries also gives Marks, so all loot feeds the backstop.
- **Heat (optional).** Spending a Warden Sigil when you Rekindle raises the Heat from 1 to 3.
  - Each step: +35% Warden HP and +20% damage. Heat 3 adds one new attack pattern.
  - Each step also adds +4% signature chance, moves 6 points of tier weight toward Noble and Legendary, and from
    Heat 2 on gives +1 Mark.
  - Heat 3 opens only after you clear Heat 2.
  - Heat never rises on its own (the complaint about the DS2 Ascetic). Hollow Knight's Attuned, Ascended and Radiant
    tiers work this way.
- **The goal:** one refight with its walk should pay about 1.2× the souls per minute of the best enemy route, so
  bosses become the favorite farm without making the rest pointless.

---

## 9. The first objective: teach the loop

The owner's example (kill 5 and 3 of two kinds, gather 20 fungal caps) is the right content. Research says to give
it a motive and a named target so it doesn't read as "kill 10 rats". Maren's first task, before the oath:

> **"The Road Camp."** Hollows have dragged the village's last tools to a camp by the old road, and Maren can't
> brew a bandage without fungal caps.

- **Steps, shown together:**
  1. Clear the camp: 5 hollows and 3 slimes.
  2. Defeat **Grub, the camp's boss**, a named hollow with one clearly telegraphed heavy attack. It teaches the roll.
  3. Gather 20 fungal caps.
- **Grub always drops a Standard helmet,** which brings up "New gear: open Equipment". That teaches the equipment
  screen, comparison and Power going up.
- **Turn-in:**
  - Maren teaches alchemy on the spot: the caps become your first Field Bandages.
  - She points you to the bonfire, where your first rest respawns the camp. That teaches the respawn loop without
    any text.
- **Length:** 5–10 minutes, with no text popups during fights. Dying on the camp is fine: your souls wait a few steps
  away. This step needs two new objective goal types, `kill` (counts by enemy kind) and `gather`.

---

## 10. Seeing your gear on the character

Players notice the weapon first, then the chest, then the helmet. Legs and rings barely show at top-down scale.
The player sheet is built by a script (ADR 0008), so each variant costs code, not hand drawing:

1. **Weapon:** a separate overlay layer for each weapon type, with front and back drawing order for each
   direction, plus a swing arc effect per type. The body animation stays shared (light attack, heavy attack, draw).
2. **Chest:** three weights (cloth, leather, plate) baked into the body by the generator.
3. **Helmet:** four head shapes (none, hood, cap, full helm), plus a toggle to hide it.
4. **Legs:** color only.
5. **Rings:** invisible, except a faint ember shimmer for a Legendary.

**Tier color comes from a palette lookup filter** with one ramp per tier: soot-gray, green ember, blue flame,
violet soulfire, gold. Five tiers × three weights costs no new art. Every layer shares the body's frame layout
(the LPC rule), so the client stacks sprites on one animation clock.

New art to make: 6 weapon layers, 3 chest weights and 3 helmet shapes. That's 12 generated layer sets, item icons
for each base, and the beams.

---

## 11. Build order

| Phase                    | Delivers                                                                                                                                                                        | Depends on             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **0. Bonfire and saves** | Pausing menus, no resting while aggroed, random respawns away from the bonfire, and the old-save message                                                                        | Nothing; can start now |
| **1. Gear foundation**   | Six slots, item instances (base, tier, item level, perks, seed), the armor curve, Power, the new equipment screen with comparison, enemy drops, and removing forge gear recipes | 0 (save bump)          |
| **2. Perks**             | Perk pools and validation, effects shared with class modifiers, Greater perks, smart loot, Legendary powers, Blighted items                                                     | 1                      |
| **3. Weapon types**      | Combat rework (chains, charges, dash-strikes, hitstop per type, hyper armor), then sword, spear and hammer; then daggers; then bow and staff                                    | 1                      |
| **4. Economy**           | Salvage, temper, upgrade and infuse, cleanse, coatings, tools, ranked projects, the Gambler, respec                                                                             | 2                      |
| **5. Wardens**           | Chests, signature items, Rekindle, pity, Marks, Heat, alternate kills                                                                                                           | 2, 4                   |
| **6. Onboarding**        | The Road Camp objective, `kill` and `gather` goal types, and Grub                                                                                                               | 1                      |
| **7. Art**               | Weapon and armor layers, item icons, beams and chimes                                                                                                                           | 3 for weapons          |

**Phase 4, the smithy, as built (2026-11-01).** Choices made while building it:

- **Where the work happens.** The village forge (there from the start) salvages, upgrades and infuses. Tempering
  and cleansing are the smith's craft, so they wait for the smithy to be rebuilt (a new `smithWork` restoration
  effect), which gives that project a payoff beyond the last upgrade steps. Salvage also works at a bonfire, as
  section 6 asks for junk.
- **Salvage yields** follow section 7's table: weapons give iron scrap, bone shard and glowspore; armor stone, bone
  shard and glowspore; rings bone shard, glowspore and slime gel, by tier (Common 1; Standard 2; Rare 3 + 1; Noble
  4 + 2 + 1; Legendary 6 + 3 and a Warden Mark). The Warden Mark is a new material, ready for phase 5.
- **Bulk salvage never touches Noble or Legendary pieces**, even marked junk: they go one at a time, and the
  details panel asks twice. Locked pieces are never salvaged at all.
- **Auto-salvage** covers Common and Standard and starts off; turning it on by default after the first area waits
  for the onboarding work in phase 6.
- **Tempering** follows the design: pick a perk, pay, then keep it or take one of two new ones; after the first
  temper only that perk can be rerolled. Offers come from the item's own seed, advanced each time, so reloading a
  save gives the same offers. Standard counts as tier factor 1, like Rare.
- **Infusing** costs a quarter of the materials and souls the old piece's upgrades took, rounded up.
- **Respec** gives every spent point back as free points (the level stays) for the souls of one level.

**Phase 3, the Ember staff, as built (2026-11-01).** Choices made while building it:

- **Strike to cast:** every staff hit stores an Ember (up to 4, shown as coals over the player's head). The
  charged attack is a fireball that spends one, at 2.3x the staff's melee damage (the table's 1.4 against 0.6);
  with no Embers it is a spark at 30%. Fireballs reuse the bow's shot code.
- **The Ashcaller's affinity** works as section 5 says: with a staff, every ability stores an Ember. Anyone else
  gets that from a perk.
- **Perks:** a fireball loosed with all four Embers bursts, abilities store Embers, bonks knock back harder,
  fireballs pierce (Rare and up), and each Ember held adds ability damage.
- **The bow's "pins burn"** came in with the staff's fire: each pin scorches its foe once a second.
- **Hearthwood:** every Ember spent heals 6 HP.
- **A power's text is shown as written**; validation now rejects a `{v}` in one, after I left one in Hearthwood's.

**Phase 3, the bow, as built (2026-11-01).** Choices made while building it:

- **Shots are moves.** A move with a `shot` fires an arrow on its first active tick instead of swinging, so the
  bow uses the same tap, hold and roll inputs as everything else: a quick shot, a draw, and a backflip shot (a
  move whose lunge steps backward).
- **Stamina is the only ammo**, as decided: each shot costs stamina, and a drawn bow burns more every tick (the
  Monster Hunter bow). With an empty bar the arrow goes on its own. Drawing slows the walk like any charge.
- **Pin and Perfect Shot:** arrows lodge in a foe (up to 5, for 6 s). Let go of a full draw within 6 ticks and it
  is a Perfect Shot: +60%, piercing, a stagger, and every pin ripped out for half the shot's damage each. The draw
  glint flashes white in the window. A raised shield still stops any arrow.
- **Perks:** a longer Perfect window, more damage from ripped pins, a split charged shot (Rare and up), a quick
  shot that kicks away a foe up close, and free shots out of a roll. "Pins burn or bleed" waits for the staff's
  fire.
- **Pale Wind:** a Perfect Shot makes your next roll free.
- **Not yet:** the Stalker's "a Latch target is pinned automatically" and the Ashcaller's "pins ignite" (section 5's
  affinity examples); the bow's 12% affinity bonus for both classes is in.

**Phase 3, twin daggers, as built (2026-11-01).** Choices made while building them:

- **Flank** reads which way a foe faces: from more than a quarter turn behind, a hit crits for +50%. For the
  Stalker, a hit out of Vanish or while a False Step decoy is out counts as a Flank wherever they stand (the class
  affinity in section 5).
- **Bleed** adds a stack per hit, lasting 3 s from the last; five burst for 1.5x the weapon's damage, unblockable,
  and a half-second stagger.
- **The charged lunge goes through foes** (a new `through` move flag): it ignores the stop-short rule and leaves the
  player untouchable until it has passed, so it ends behind the target, ready to Flank. That covered the design's
  "lunge ends behind the target" perk, so a "Flank crits deal more" perk took its place.
- **Perks:** Flank damage, Bleed bursts restore stamina, bleeding foes take more from everything, every fifth swing
  is free, and (Rare and up) a crit out of hiding bursts a full Bleed.
- **Twinfang:** Vanish lasts through two strikes, and both are ambushes.

**Phase 3, first half, as built (2026-11-01).** The combat rework plus sword, spear and hammer. Choices made
while building it:

- **Tap and hold share one button without delay.** A press starts the light attack at once; if the button is
  still held when the swing would land, it turns into a charge instead. Let go within `minCharge` ticks and the
  light swing carries on as if it had never paused.
- **Moves are data** in `content/weapons.json`, multiplying the weapon's own numbers. The Bone Cleaver is now a
  hammer; the Ashwood Spear and Stone Maul are new bases.
- **Lunges stop short of a foe in front**, so a move's step forward never walks the player into contact damage.
- **Flow also covers the dash-strike**, not only a light hit. With a dash window of 10 ticks and a Flow window of
  12, a light-hit-only Flow had a two-tick opening; the dash-strike out of the roll is the natural counter.
- **The sword's affinity is every class**, as the table says; the spear and hammer favor the Vanguard.
- **Break has no Warden stagger meter to fill yet**, so the hammer's rule is crushes (a hit on a staggered foe
  crits), hyper armor on every swing, stagger on hit and the full-charge shockwave.
- **Legendaries:** Oathspear (tipper hits mark a foe; the next ability hit on it staggers it outright, for any
  class) and Gravebell (a full-charge slam pulls nearby foes in before the shockwave).
- **Animation:** moves reuse the existing body poses (the swing, the charge-cast and slam-cast poses, and a
  raised pose while charging) and draw their own arc: a slash, a thrust line, a full sweep or a slam ring. Real
  per-type weapon layers are phase 7.
- **No save change:** the move state lives in a component that is added on the first attack.

**Phase 2 as built (2026-11-01).** Choices made while building it:

- **Effect perks reuse the class modifier effects** (`activeEffects` merges worn modifiers and gear), and seven
  new effect types were added for gear: `restShield`, `poise`, `lastEmber`, `stillEnergy`, `lowHealthShield`,
  `dodgeRefund` and `streakBurst`. Modifiers can use them too. An effect perk's numbers scale with tier strength
  and the roll, not item level, so a cooldown cut never runs away.
- **Class perks roll on rings only:** three per class, built from that class's modifier effects. Smart loot keeps
  class perks' share of the pool and gives 85% of it to the class being played; a class perk for another class
  shows dimmed and does nothing.
- **Legendaries:** one per slot for now: Cinderbrand (every third hit in a row sets the ground alight), Crown of
  the Unforgotten (the super charges while you stand still), Pyreheart Cuirass (a 40 overshield below a third of
  your health, every 30 s), Ashwalker Greaves (rolling through a blow refunds the roll) and Ring of the Last Ember.
  They borrow the iron bases' icons until phase 7. The spear, hammer, dagger, bow and staff Legendaries in
  section 6 wait on phase 3, since their powers change verbs those weapons bring.
- **Weapon-type pools wait on phase 3** for the same reason. Phase 2's weapon perks are the "every weapon" pool.
- **A rolled perk never repeats a perk the base already carries**, so a Legendary's partner perk is never doubled.
- **No save change:** Greater and Blighted are optional fields, and perk timers live in a component that is added
  the first time it is needed, so version 15 saves still load.

**Phase 1 as built (2026-11-01).** Everything in the phase 1 row, plus soft-capped attributes. Choices made while
building it:

- **Perks start as stat perks only:** 17 in `loot.json` (damage, crits, stamina, souls, the four attributes, Armor,
  HP, roll cost, move speed, healing and ability damage), spread so every slot can roll three. Behavior perks,
  class perks, Greater and Blighted rolls are phase 2. Until then a Legendary rolls its three random perks and
  has no fixed power yet.
- **Bases:** two per armor slot, a light one with an innate perk (Ashen Hood: +5% ability damage; Padded Jacket:
  +10 HP; Wanderer's Wraps: rolls cost 8% less) and an iron one with more Armor. The Iron Sword and Bone Cleaver
  drop; the Chipped Sword never does. Rings are now Ring of Vigor (+15 HP) and Ring of Breath (+20% stamina regen),
  lowered from +20 and +30% since they also roll perks.
- **Drops** pick the slot first (each slot equally likely), then the base, then the perks, all from the item's
  seed. The tier and the seed come from the sim's RNG, and pity counts there.
- **Drop feel, for now:** gear on the ground glows in its tier color and pulses harder the better it is; Rare,
  Noble and Legendary drops each chime differently. Ground labels, beams, minimap pips and elites visibly holding
  their drop wait for phase 7 (art); clutter tools (salvage, junk, locking) wait for phase 4.
- **The equipment screen** puts the details under the pack, so the panel fits a small window.

---

## 12. Decisions (2026-10-31)

Where draft 1 changed or added to the owner's notes, the owner chose:

1. **Legendary = 2 fixed + 3 rolled** instead of 5 random, and Common has no perks.
2. **The bow uses stamina only,** no arrows.
3. **Six weapon types:** sword, spear, hammer, bow, twin daggers and Ember staff.
4. **Every chest has a chance at the signature item, the first kill included,** with pity (sure by the 8th chest)
   and 6 Marks as a backstop. Draft 1 proposed guaranteeing it on the first kill.
5. **Refights are free and always drop a chest.** Sigils are optional and only raise the Heat.
6. **The Warden's modifier stays a first-kill unlock.** The signature item gets its own power. The Ember Codex
   from draft 1 is dropped; it can come back as a way to keep Legendary powers if gear lock-in becomes a problem.
7. **Two ring slots,** so the screen is 3 + 3.
8. **Attributes stay the existing four** (Vigor, Endurance, Might, Attunement), with soft caps.

---

## Sources

**Loot and perks**

- D3 Loot 2.0 and the GDC 2015 postmortem: https://gdcvault.com/play/1021776/Against-the-Burning-Hells-Diablo ,
  https://game-wisdom.com/critical/loot-2-0-and-diablos-fourth-revival , https://di.diablowiki.net/Smart_loot
- D4 Season 4 "Loot Reborn": https://www.gamespot.com/articles/diablo-4-season-4-loot-overhaul-is-going-over-very-well-with-fans/1100-6523491/ ,
  https://mein-mmo.de/en/diablo-4-season-4-patch-notes-show-what-gets-better-less-loot-but-stronger,1121161/2
- Grim Dawn 1.1.7.0: https://forums.crateentertainment.com/t/grim-dawn-version-1-1-7-0/100418
- PoE 2 loot buffs: https://pcgamer.com/games/rpg/path-of-exile-2-devs-respond-to-the-cries-of-the-loot-starved-masses-buffing-drops-and-promising-more-fixes-in-upcoming-patches
- Nioh 2 clutter: https://www.avclub.com/nioh-2-s-inventory-system-is-hot-glutted-garbage-1842298694
- Remnant: https://www.pcgamer.com/remnant-from-the-ashes-is-rethinking-the-way-loot-works-in-shooters
- Anthem inscriptions: https://kotaku.com/bioware-announces-some-fixes-for-anthem-s-broken-loot-s-1832967389
- Wolcen: https://www.pcgamer.com/wolcen-lords-of-mayhem-review
- Destiny crafting rollback: https://thegamepost.com/bungie-weapon-crafting-destiny-2-episode-heresy-seasonal-weapons/
- Destiny gear tiers: https://www.pcgamer.com/games/fps/destiny-2-gear-tiers/
- Last Epoch: https://primagames.com/tips/legendary-potential-in-last-epoch-explained ,
  https://forum.lastepoch.com/t/introducing-tier-6-and-7-item-affixes/22279
- Kanai's Cube: https://www.gamespot.com/articles/this-new-diablo-3-item-lets-you-reforge-legendarie/1100-6429260/
- No Rest for the Wicked: https://www.sportskeeda.com/mmo/no-rest-for-the-wicked-weapon-rarity-explained
- D3 Rift key beam: https://games.softpedia.com/blog/Next-Diablo-3-Patch-Removes-Legendary-Beam-from-Greater-Rift-Keys-458391.shtml

**Weapons**

- Death's Door weapons: https://eip.gg/deaths-door/guides/weapons-and-where-to-find-them/
- Death's Door developer interview: https://www.nme.com/features/gaming-features/acid-nerve-developers-david-fenn-and-mark-foster-on-making-deaths-door-3203321
- Hades: https://hades.wiki.fextralife.com/Infernal+Arms
- Hades II: https://hades2.wiki.fextralife.com/Nocturnal+Arms
- Hyper Light Drifter: https://gamedeveloper.com/design/how-i-hyper-light-drifter-i-balances-difficulty-with-fairness
- Enter the Gungeon on ammo: https://www.gamedeveloper.com/design/building-i-enter-the-gungeon-i-s-dungeon-climbing-spin-off-i-exit-the-gungeon-i-
- Monster Hunter bow: https://game.capcom.com/manual/MH_Gen/en/page-123.html
- Elden Ring hyper armor: https://eldenring.wiki.gg/wiki/Hyperarmor
- Elden Ring arrows: https://steamcommunity.com/app/1245620/discussions/0/3177859358967755318
- Hitstop: https://sourcegaming.info/2015/11/11/thoughts-on-hitstop-sakurais-famitsu-column-vol-490-1/
- Children of Morta: https://www.gamedeveloper.com/design/the-design-challenges-of-quot-children-of-morta-quot-
- Nioh stances: https://critpoints.net/2017/03/09/what-makes-niohs-ki-burst-fun/

**Economy and bosses**

- Last Epoch crafting rework: https://forum.lastepoch.com/t/crafting-changes-coming-to-eternal-legends-update-0-8-4/45597
- D4 masterworking: https://wowhead.com/fr/news/masterworking-can-no-longer-fail-in-diablo-4-season-4-339193
- MH Qurious crafting: https://automaton-media.com/en/news/20220817-15005/
- D3 Mystic: https://diablowiki.net/Mystic
- DS2 durability: https://www.gamespot.com/articles/new-dark-souls-ii-patch-finally-fixes-year-old-dur/1100-6426819/
- Destiny materials removed: https://www.thegamer.com/destiny-2-is-overhauling-its-in-game-economy-and-doing-away-with-planetary-materials/
- D4 boss changes: https://www.wowhead.com/diablo-4/news/uber-uniques-have-about-a-2-drop-rate-community-research-335734 ,
  https://www.icy-veins.com/d4/news/diablo-4-season-8-overhauls-lair-bosses-whats-changing-and-why-it-matters/
- WoW Cartel Chips: https://warcraft.wiki.gg/wiki/Puzzling_Cartel_Chip
- Lost Ark honing: https://maxroll.gg/lost-ark/resources/gear-honing-system
- DS2 Bonfire Ascetic: https://darksouls2.wiki.gg/wiki/Bonfire_Ascetic
- Elden Ring refights: https://www.gfinityesports.com/article/why-is-elden-rings-most-requested-feature-still-missing-3-years-later
- Remnant alternate kills: https://segmentnext.com/remnant-2-boss-alt-kills/
- Elden Ring smithing stones: https://gamesradar.com/games/action-rpg/elden-ring-shadow-of-the-erdtree-makes-one-change-to-weapon-upgrading-thats-so-good-i-want-fromsoftware-to-patch-it-into-the-base-game-immediately

**Resting, stats, art and UI**

- Elden Ring pause: https://www.pcgamer.com/theres-an-easy-way-to-pause-elden-ring-without-mods
- Hollow Knight benches: https://hollowknight.wiki/w/Bench_(Hollow_Knight)
- Hyper Light Drifter health kits: https://steamcommunity.com/app/257850/discussions/0/365163686048321145
- League of Legends armor: https://wiki.leagueoflegends.com/en-us/Armor
- D4 armor cap: https://www.wowhead.com/diablo-4/news/armor-redesigned-for-diablo-4-season-4-easy-to-reach-cap-339158
- Destiny's power grind: https://pcgamer.com/games/fps/this-was-the-wrong-path-for-destiny-after-4-months-of-dwindling-players-and-community-outrage-bungie-admits-that-the-edge-of-fates-bold-new-vision-for-destiny-2-was-a-mistake
- D4 comparison tooltips: https://www.denofgeek.com/games/diablo-4-best-hidden-setting-compare-gear
- Stardew sprites: https://stardewvalleywiki.com/Modding:Farmer_sprite
- LPC sprites: https://github.com/LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator
- Top-down animation: https://www.slynyrd.com/blog/2025/3/24/pixelblog-55-top-down-character-animation
- Valheim's first goal: https://gamesradar.com/valheim-tips-beginners-guide
- "Kill 10 rats": https://www.engadget.com/2014-01-01-mmo-mechanics-kill-10-rats-can-be-fun.html
- D4 salvage mishap: https://www.gamespot.com/articles/diablo-4-community-warns-that-latest-patch-changed-how-item-salvaging-works/1100-6523489/
