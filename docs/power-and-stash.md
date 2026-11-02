# Power, the stash and the character screen: design proposal

**Status: decided (2026-11-02). The owner took the recommended answer to all six questions (section 9). Phases 1
to 3 are built.** This builds on `docs/gear-and-loot.md` (the gear rework, phases 0–7, all built) and turns
the owner's next six notes into a design:

1. More enemies.
2. A cleaner equipment screen, Destiny 2 style: hover a slot, see every piece for it sorted by Power.
3. Dismantling gear.
4. Bringing an old favorite up to the Power of newer drops.
5. Power from 0 to 1000, with drops based on the best gear you own, not just what you wear.
6. A bag for crafting things and a vault for equipment.

The shift in one line: **Power becomes a level printed on every item, and the character screen is built around it.**
Today Power is a computed strength number (Power 100 at the start) and each item's level comes from the biome it
dropped in (1 to 5). Under this proposal, every piece of gear carries its own Power from 10 to 1000, your Power is
the average of what you wear, and drops come in a little above the best you own.

---

## 1. What the research says

Research covered Destiny 2, Diablo 4, Last Epoch, Elden Ring, Monster Hunter and No Rest for the Wicked (sources at
the end). What shapes this design:

- **Destiny 2 is a finished design with a known post-mortem.** Its last content update shipped in June 2026. Bungie
  called its 2025 power-and-tier rework "the wrong path": grinding a number "will never be a substitute for earning
  a trophy," and low tiers felt like "throwaway tiers" to climb through. It then cancelled the planned Power resets
  within months. Copy the parts that lasted, not the 2025 experiment.
- **Drops based on your best gear, not your worn gear,** lasted from 2017 to the end. Drop Power came from the best
  item per slot across all characters and the vault. It ends the "wear junk to farm" trick, and players learn one
  rule: keep your highest piece in each slot.
- **Every change to infusion made it cheaper.** It ended at a flat 1 Enhancement Core and 5,000 Glimmer, at any
  Power. The one time Bungie capped old gear ("sunsetting," 2020) caused the worst backlash in this whole area and
  was undone in 2021. Never retire a favorite.
- **The slot flyout is the part of Destiny's screen everyone praises,** and the parts everyone hates are what an
  outside app (DIM) had to fix: vault items never show in the flyout, dismantling is one item at a time, and there
  is no junk tag, bulk dismantle or "equip my best." We get those for free in a single-player game.
- **Materials are counts, not slots.** Diablo 4 moved materials and gems out of the bag in October 2023, and Destiny
  always showed them as counters. Gear needs a decision per piece; a stack of iron doesn't.
- **Bulk salvage needs safe defaults.** Diablo 4's Season 4 changed "Salvage All" to include high rarities, and
  players lost items. Ours never touches locked, worn or Noble-and-better items unless the player opts in.
- **Density sets the reward rate.** Diablo 4 raised monster counts about 50% in its endgame (August 2023) because
  rewards felt thin. But high density turns enemies into a crowd, and Souls-likes depend on each foe being a
  readable threat. The answer for us is **small packs** (2 to 4) and a few denser optional camps, not hordes.

---

## 2. Power from 10 to 1000

### Power is a level on each item

- Every piece of gear has a **Power** from 10 to 1000, shown on its tile and card.
- **Tier is separate from Power.** Power is the level; tier (Common to Legendary) is how many perks and how strong.
  A Rare at 400 and a Legendary at 400 count the same toward your Power. This is Destiny's rule, and it keeps tiers
  meaning "a better piece," not "a higher number."
- **Your Power** is the average of the six pieces you wear (weapon, helmet, chest, legs, two rings), rounded down.
  An empty slot counts as 0, so wearing something always beats wearing nothing.
- **Starting gear is Power 10.** A new character wears four pieces at 10 and no rings, so its Power is 6 until
  the first rings drop: empty slots count.
- **The old computed Power goes away.** It was honest, but a number nobody can raise directly doesn't work as a
  goal. Comparisons keep showing the real stat changes (attack, damage taken, HP), so nothing is lost.

### What Power does in a fight

Destiny's model: **Power is checked against the enemy's Power**, and the gap changes damage. Item numbers (a sword's
12 attack, a chest's 9 armor) stay small and readable, because Power never multiplies them directly.

- **Your weapon's Power sets how hard you hit, and your armor's Power sets how hard you're hit.** The weapon is
  checked on its own; for defense, the average of helmet, chest and legs. Rings count only toward your displayed
  Power and drops. This is the one place we break from Destiny, which uses the character average for both. A
  sword left at 102 while you fight Power 200 enemies feels weak immediately, and that is exactly the problem the
  owner wants infusion to solve.
- **Under-leveled hurts, over-leveled helps only a little.** A Souls-like should never let a number replace
  skill.

| Your Power vs. theirs | Damage you deal | Damage you take |
| --------------------: | --------------: | --------------: |
|                  +100 |            +10% |            −10% |
|                   +50 |             +5% |             −5% |
|                     0 |               – |               – |
|                   −50 |            −20% |            +25% |
|                  −100 |            −40% |            +50% |
|         −150 or lower |   −60% (capped) |  +100% (capped) |

All of these are content numbers (`player.json → power`). The HUD shows the gap when it matters: a small red skull
beside an enemy's health bar when it is 50 or more above you, so being under-leveled is never a mystery.

### Where enemies get their Power: distance from the village

Biomes are climate patches today, so the ruins (item level 5) can sit next to the village. That works against a
level curve. **Proposal: enemy Power comes from how far you are from the village, in rings.** The further from the
fire, the stronger the forgetting, which fits the story. Biomes keep their looks and enemy mix.

| Ring | Distance from the village (tiles) | Enemy Power | Drop cap |
| ---: | --------------------------------: | ----------: | -------: |
|    0 |                           0 – 100 |          10 |      150 |
|    1 |                         100 – 250 |         120 |      300 |
|    2 |                         250 – 450 |         280 |      450 |
|    3 |                         450 – 700 |         430 |      600 |
|    4 |                        700 – 1000 |         580 |      750 |
|    5 |                            1000 + |         730 |      900 |

- **Within a ring, enemy Power rises smoothly with distance**, so there are no hard walls. The table gives the value
  at each ring's inner edge.
- **The map shows the rings** as faint contour lines, labeled with their Power, once you have been there.
- **Bosses have their own Power:** Grub 40, the Ashen Warden 160. A Warden refight at Heat N adds 100 × (N − 1),
  so Heat 3 is Power 360. Its chest can drop up to its Power plus 100 (460 at Heat 3); later Wardens, further out,
  carry the climb toward 1000.

### Drops: a little above the best you own

**Max Power** is the average of your best item per slot across **everything you own**: what you wear, carry and
keep in the stash (counting your two best rings). Drops are based on it:

| Source                 | Drop Power                           | Can pass the ring's drop cap? |
| ---------------------- | ------------------------------------ | ----------------------------- |
| Wild enemy             | Max Power + 0 to 4                   | No                            |
| Elite (knight) or camp | Max Power + 3 to 8                   | No                            |
| Camp boss (Grub)       | Max Power + 6 to 10                  | No                            |
| Warden chest           | Max Power + 10 to 15                 | Yes, up to its Power + 100    |
| The Ember Gambler      | Max Power + 0 to 4, your chosen slot | No                            |

- **Every drop is at least the ring's floor** (the enemy Power of that ring), so walking into a harder ring pays at
  once: your first kill out there catches you up.
- **No soft cap, powerful cap or pinnacle cap,** and no resets. Bungie needed three caps because Destiny runs on
  weekly limits. We have one rule: **a ring's drop cap stops wild drops, and the next ring (or a Warden) is how you
  climb past it.**
- **About the pace:** with roughly one gear drop every few minutes and six slots, a ring takes a few hours to cap
  out. Every number here is content, so it's easy to tune after playtests.
- This replaces the biome `itemLevel` (1 to 5). The Gambler and refight bands use Max Power instead.

---

## 3. Raising an old favorite: infusion

**Infuse:** pick the item you want to keep, then feed it a higher-Power item **of the same slot** (any weapon feeds
any weapon). The kept item rises to the fed item's Power and keeps everything else: tier, perks, upgrades,
tempering. The fed item is destroyed.

- **Cost: flat and cheap.** 1 bone shard and 50 souls, at any Power. Destiny spent nine years cutting this cost
  down. We start where it ended.
- **Where: at any bonfire,** from the item's inspect view.
- **Preview first:** the screen shows "Ashen Longsword 102 → 214" and names the item that will be destroyed, with a
  hold-to-confirm if that item is Noble or better.
- **It replaces today's Infuse,** which moved upgrade levels from an old item onto a new one. That existed because
  switching to a better drop wiped your forge investment. Now you raise the favorite instead of switching, so the
  investment stays put.
- **Never sunset, never cap** an item below the game's maximum.
- **Forge upgrades stay** as the trophy path (Elden Ring's +levels): they add attack or armor, independent of
  Power, and infusion carries them along.

---

## 4. Dismantling

- **Anywhere, from any item card:** hold the dismantle key (0.6 s) to break it into materials. Today salvage only
  works at the forge or a bonfire, which is why it feels missing.
- **One key marks junk** (X, or the gamepad's left face button), and one key locks. A locked item can't be
  dismantled or infused away.
- **"Dismantle all junk"** sits at the bottom of the bag and stash, with a preview of what you'll get ("23 items →
  41 iron, 12 bone shard"). It never touches locked or worn items, or anything Noble or better, unless you tick
  "include Noble" for that one run.
- **Auto-junk, one simple rule** instead of a loot-filter language: mark as junk anything Common or Standard that is
  below your Max Power in its slot. Off by default, offered once you reach ring 1. Today's auto-salvage toggles
  become this.
- **Yields** stay as `gear-and-loot.md` section 7 sets them (tier-based materials, a Warden Mark from Legendaries).
- **Infusion fuel is the other reason to keep junk:** a junk item above your favorite's Power shows an "infuse"
  marker instead of the junk mark.

---

## 5. The bag, the pockets and the stash

Three places, each for one kind of thing:

| Where         | Holds                                                     | Size                          | Reached                  |
| ------------- | --------------------------------------------------------- | ----------------------------- | ------------------------ |
| **Pockets**   | Gear you carry: 9 spare pieces per slot type              | 9 × 5 (rings share one)       | Always                   |
| **Bag**       | Consumables (flasks, bandages, coatings, pots)            | 12 stacks                     | Always                   |
| **Materials** | Wood, stone, iron, bone, caps, spores, gel, Marks, Sigils | Counts, no cap                | Always (its own tab)     |
| **Stash**     | Gear (and spare consumables)                              | 200, +100 per Storehouse rank | At a bonfire (see below) |

- **Materials are counters, never slots.** Nobody needs to decide about a stack of iron.
- **Nine spare pieces per slot** is Destiny's number and keeps each flyout to one short row.
- **Full pockets never lose loot:** a piece that doesn't fit goes straight to the stash with a "sent to stash"
  toast. No postmaster, no deleting the oldest.
- **The stash opens at the village bonfire at first.** The Storehouse project changes: rank I opens the stash at
  every bonfire, and ranks II and III add space. (Today it adds bag slots, which no longer exist.)
- **Stash items show in the slot flyouts** everywhere, dimmed with a stash mark, so you always see everything you
  own. Equipping one away from a bonfire that reaches the stash is blocked with a clear reason.
- **Max Power counts the stash,** so storing your best piece never lowers your drops.

---

## 6. The character screen

The current screen shows the slots, a full stat sheet, the 40-slot pack and a details panel all at once. The new
one shows less and puts the rest one press away.

```
  INVENTORY · BAG · MATERIALS · STASH · CRAFTING · ABILITIES                    2,289 souls

                               POWER 214   (max 221 · Equip best)

   WEAPON  ┌────┐                                                  ┌────┐  HELMET
   Ashen   │ 🗡 │ 214                                         218  │ ⛑ │  Sentinel
   Longsw. └────┘ ┃▸ 231▲ 214 190 188 102 ┃            (character   └────┘  Hood
                                                     wearing the
   RING    ┌────┐                                     gear)        ┌────┐  CHEST
           │ ◯ │ 220                                         209  │ ▣ │
           └────┘                                                  └────┘
   RING    ┌────┐                                                  ┌────┐  LEGS
           │ ◯ │ 201                                         222  │ ▥ │
           └────┘                                                  └────┘

        ATTACK 31 · ARMOR 54 (47% less damage) · HP 164 · STAMINA 118          [Details]
```

- **Each slot tile:** icon, tier border, Power. Nothing else.
- **Hover or select a slot to open its flyout:** a row of everything for that slot, highest Power first. Pockets
  first, then stash pieces (dimmed, with a stash mark). Each tile shows its Power, a ▲ if it would raise your
  Power, and a lock or junk mark. Clicking a tile equips it.
- **Hovering a tile shows a short card:**
  - name, tier and type, Power;
  - the two headline changes against what you wear ("Attack +3 ▲", "Damage taken −4% ▲");
  - its perks, one short line each, with the Legendary power first;
  - key hints: Equip, Inspect, Lock, Junk, hold to Dismantle.
- **Inspect** (right-click, or a gamepad button) opens the full view: every stat, full perk text, upgrade level,
  and the forge actions (Infuse, Upgrade, Temper, Cleanse) that are available where you stand.
- **"Equip best"** puts on the highest-Power piece in every slot (DIM's most-used button). It skips stash pieces
  you can't reach and says so.
- **The stat line is short:** attack, armor with its percentage, HP, stamina. Attributes and the rest move to the
  Details panel and the level screen.
- **Gamepad:** the d-pad moves between slots, the confirm button opens the flyout, and the bumpers switch tabs. The
  screen works fully without a mouse.

**What goes:** the always-visible stat sheet, the mixed 40-slot pack grid on the main tab, and the details panel
that waited for a click ("Select an item or a piece of your gear").

---

## 7. More enemies

Today each 32 × 32-tile chunk gets about two enemies (2 to 3 by biome), each alone. That is roughly one enemy per
screen, and every fight is one foe.

- **Packs instead of loners.** A spawn point becomes a pack: a leader plus 1 to 3 others within 3 tiles. Hollows
  come in twos and threes, slimes in clusters of 3 or 4, an archer behind two Hollows. Knights stay alone.
- **About 2.5 × the enemies:** 2 to 3 packs per chunk, so about 5 to 7 enemies, up from 2.2. Each biome sets its
  pack count and pack makeup in `biomes.json`.
- **Denser optional places:** the Hollow Camp prefab shows up twice as often, and a new **Ash Nest** prefab (a pit
  of slimes and Hollows around a small chest) gives a place to farm.
- **Loot per kill goes down as kills go up:** gear chance per kill drops about 40% (wild Hollow 8% → 5%), so gear
  per minute rises by about half instead of tripling. Materials per kill stay the same, so crafting speeds up.
- **The village stays calm:** the safe radius and the palisade ward are unchanged.
- **Packs bring their own tuning work:** enemies that hit in turn instead of all at once (a pack shares one "attack
  token" for melee, so two Hollows don't lunge on the same tick), which Souls games and Hades both rely on. This
  is what keeps a pack of three fair.

---

**Phase 1 as built (2026-11-02):**

- **Pack tables per biome:** `biomes.json → spawns.packs` is a weighted list of packs, each naming how many of
  each archetype rise together ([min, max]). The first named is the leader; the rest rise within
  `world.packs.spread` (3) tiles of it, wherever there is open ground in the chunk. Meadow packs are mostly two or
  three Hollows, the fungal wilds have slime clusters of three or four, and the hills pair an archer with two
  Hollows. Knights still come alone (with one Hollow in the ruins). Packs per chunk are 2.2 to 2.5, about 6
  enemies per chunk, up from 2.2.
- **The attack token:** a Hollow or knight only starts a wind-up while fewer than `world.packs.attackers` (1)
  others are winding up or striking. One waiting its turn holds its ground facing the player instead of crowding
  in. Archers, slimes and bosses don't take tokens: arrows and hops are their own dodge tests, and a boss fight is
  built around its own rhythm.
- **The Ash Nest** replaces the proposed chest with an elite, because the game has no chest to open yet: an **Ash
  Mother** (a big gray slime, 140 HP, slow heavy hops) sits in a pit of six slimes and three Hollows and always
  drops a piece from the elite table, plus gel and glowspore. It rolls in the fungal wilds, meadow and graveyard,
  and shows on the map as a camp.
- **Fewer gear drops per kill:** Hollow and archer 8% → 5%, slime 3% → 2%. Elites stay at 100%.

## 8. Build order

| Phase | What                                                                                         | Needs |
| ----: | -------------------------------------------------------------------------------------------- | ----- |
|     1 | **More enemies:** packs, the attack token, the Ash Nest, drop rates retuned                  | –     |
|     2 | **Power:** Power on every item, rings, enemy Power, the damage gap, Max Power drops          | –     |
|     3 | **Pockets, bag, materials, stash:** the new storage, the Storehouse change, a save migration | 2     |
|     4 | **The character screen:** flyouts, short cards, inspect, Equip best, gamepad                 | 2, 3  |
|     5 | **Dismantle and infuse:** anywhere dismantle, junk, lock, bulk, auto-junk, the new Infuse    | 3, 4  |

Phase 1 is independent and could start right away. Old saves are dead, as before, so phase 2 starts every save
over at Power 10.

---

**Phase 2 as built (2026-11-02):**

- **Power replaces item levels.** Every piece carries `power` instead of `ilvl` (save version 16; older saves are
  refused). Base numbers and perk values no longer grow with level: only the tier scales them. The biome
  `itemLevel` and `loot.itemLevelGrowth` are gone, and the old computed Power (100 × √(offense × defense)) with
  them. The equipment screen shows Power, Max Power, and each worn piece's Power; the full new screen is phase 4.
- **Ring 0 starts at Power 10,** the starting Power, so a new character is even with the first foes; the table
  above shows the built values. The Warden is 160 (not 200) and Grub 40, so a player capped at ring 0's 150 meets
  the Warden only a little under.
- **A Warden's chest caps at its Power plus 100,** not 1000: with no cap, refighting the first Warden at Heat 1
  would carry a player to 1000. Heat (+100 Power a step) and later Wardens raise it.
- **Adds a boss calls share its Power,** not their ring's.
- **The gap** is `player.json → power.gap` as in the table above, blended between rows; it scales every blow on a
  foe (abilities too) by the weapon's Power, and every foe's blow, touch or shot, by the armor's.
- **Under-leveled warning:** a small red skull over any foe 50 or more above the player's Power
  (`power.warnAt`).
- **The map** draws each ring's edge as a faint dashed circle with its Power once the player has seen land past
  it.
- **The Gambler** prices by Max Power (the base, plus as much again per 100) and sells just above it. A Warden's
  signature bought with Marks comes at Max Power.
- **Dev commands:** `power` prints Power, Max Power, weapon and armor Power, and the enemy Power and drop cap where
  you stand; `setpower 300` sets everything worn to 300, for playtesting a ring; `gear <tier> [id] [power]` rolls
  at Max Power by default.

**Phase 3 as built (2026-11-02):**

- **One inventory, a limit per kind of thing** (`modules/storage.ts`): carried items stay in the player's
  `Inventory`, but each kind counts against its own limit, from `player.json → storage`: 9 spare pieces per gear
  slot (the two ring slots share one pocket), 12 stacks of consumables in the bag, and no limit at all on
  materials, key items, relics and tools. The old 24-slot pack and `inventorySlots` are gone.
- **The stash** (`SimState.stash`, 200 pieces) holds gear and spare consumables. It opens while resting at the
  village bonfire, or at any bonfire once the Storehouse is rebuilt. The Inventory screen has a **Stash** tab that
  shows its contents anywhere and takes from it where it opens, and every carried piece or consumable has a
  **Stash** button (greyed out, with the reason, elsewhere).
- **Full pockets never lose loot:** a piece that doesn't fit its pocket goes straight to the stash from anywhere,
  with a "sent to the stash" toast. Only when the stash is full too does it stay on the ground. The loot magnet
  still pulls gear while the stash has room.
- **The Storehouse** now gives the stash: rank I opens it at every bonfire, ranks II and III add 100 places each
  (rank II still brings the Gambler). Its old pack slots are gone with the pack.
- **Max Power counts the stash.**
- **No save change was needed:** the stash is an optional field, so phase 2 saves load with an empty one.
- **The pack column** is split into Gear (with a per-pocket count line, "Weapons 3/9 · Helmets 0/9 …"), Bag and
  Materials. Equipping straight from the stash waits for the phase 4 flyouts: for now, take a piece out first.

## 9. Decisions (2026-11-02)

The owner took the recommended answer to each question:

1. **Enemy Power comes from distance rings** around the village.
2. **The weapon's Power sets the blows dealt and the armor's the blows taken.**
3. **Rings count only toward Power and drops.**
4. **The stash opens at the village bonfire first,** and at every bonfire once the Storehouse is rebuilt.
5. **About 2.5 × the enemies** (built in phase 1).
6. **Infusion is a flat cost:** 1 bone shard and 50 souls.

The questions as they were asked:

1. **Enemy Power from distance rings** (section 2)? The alternative is keeping it per biome, which means the ruins
   can be next to the village at Power 700.
2. **Weapon Power for offense and armor Power for defense,** or Destiny's single character average for both?
3. **Rings count only toward Power and drops,** not in combat. Or should they count for defense, as a fourth armor
   piece?
4. **Where the stash opens:** the village bonfire first and every bonfire after the Storehouse (proposed), or every
   bonfire from the start?
5. **Pack size and density:** is about 2.5 × today's enemies the right first step, or do you want more?
6. **Infusion cost:** flat 1 bone shard and 50 souls, or should it scale gently with the Power jump?

---

## Sources

- Destiny 2's final update and Bungie's Edge of Fate verdict: [Kyber's Corner](https://kyberscorner.com/destiny-2-monument-of-triumph/),
  [The Game Post](https://thegamepost.com/bungie-edge-of-fate-was-the-wrong-path-destiny-2-power-tier-grind/)
- Power caps and drops from max Power: [Destinypedia, Power](https://www.destinypedia.com/Power),
  [DualShockers (Mark Noseworthy)](https://www.dualshockers.com/destiny-2-highest-light-gear-engrams-mark-noseworthy/),
  [Shattered Vault](https://shatteredvault.com/kb/power-levelling/)
- Edge of Fate changes and their reversal: [Dexerto](https://www.dexerto.com/destiny/destiny-2-the-edge-of-fate-patch-notes-utterly-revamp-the-looter-shooters-endgame-3225855/),
  [Sportskeeda](https://www.sportskeeda.com/mmo/bungie-removes-seasonal-power-resets-introduces-catch-up-mechanics-destiny-2-addressing-player-feedback)
- Infusion costs: [Destinypedia, Upgrade Module](https://www.destinypedia.com/Upgrade_Module),
  [Sportskeeda, update 9.1.5.2](https://www.sportskeeda.com/mmo/destiny-2-update-9-1-5-2-full-patch-notes-unstable-cores-removed-ability-buffs-and-more);
  sunsetting: [GFinity](https://www.gfinityesports.com/article/destiny-2-legendary-weapon-power-cap-infusion-limit-ps4-xbox-pc)
- What DIM adds: [DIM wiki](https://github.com/DestinyItemManager/DIM/wiki) (tags, item search, compare);
  vault sizes: [Destinypedia, Vault](https://www.destinypedia.com/Vault)
- Diablo 4 salvage and the Season 4 surprise: [Dexerto](https://www.dexerto.com/diablo/diablo-4-salvage-all-items-change-loot-reborn-2725179),
  [GameSpot](https://www.gamespot.com/articles/diablo-4-community-warns-that-latest-patch-changed-how-item-salvaging-works/1100-6523489/);
  masterworking: [Icy Veins](https://icy-veins.com/d4/guides/masterworking-guide)
- Diablo 4 materials tab: [GameSpot](https://www.gamespot.com/articles/diablo-4-inventory-management-will-get-a-whole-lot-easier-with-season-2/1100-6518152/)
- Diablo 4 density increase: [Wowhead](https://www.wowhead.com/diablo-4/it/news/monster-density-increased-for-nightmare-dungeons-and-helltides-in-patch-1-1-1-334365),
  [PC Gamer](https://pcgamer.com/blizzard-just-dumped-buckets-of-demons-on-diablo-4-to-make-the-endgame-grind-way-less-miserable)
- Last Epoch crafting and loot filters: [Maxroll](https://maxroll.gg/last-epoch/resources/beginner-crafting-guide),
  [Maxroll filter guide](https://maxroll.gg/last-epoch/resources/loot-filter-guide)

Some Destiny 2 UI details (the flyout's sort options, the inventory page sizes) could not be confirmed from a source
and come from knowledge of the game.
