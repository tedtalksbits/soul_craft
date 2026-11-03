# Roadmap

Where Soul Craft is going, how far it has got, and what is still undecided. Read this before starting a
feature: it says what the feature is for and what it must not grow into. Update it when a milestone lands or a
decision is made (decisions with lasting technical weight also get an ADR in `docs/adr/`).

Last updated: 2026-10-31, after the gear and loot design.

## Vision

**A top-down Soulslike action RPG where you fight with elemental class powers, hunt your gear from the creatures
and Wardens of a world that is different every time the flame wakes, and forge it into something greater.**

**Premise.** The land is forgetting itself, and Ashen Village is nearly gone. Maren, the last person who remembers
it, remembered you back. You were forgotten long ago, so the forgetting has nothing to take from you: you can carry
what others lose. Win back what the village forgot, and it comes back to life. **Memory** is the one power every
class draws on, the way Destiny's classes all draw on the Light. The world, cast, arc and the game text still to
be renamed (Kindlings become remnants, and so on) are in the story bible, [`docs/story.md`](story.md) (draft 2,
awaiting the owner's tweaks).

Pillars, in priority order:

1. **Combat first.** Souls-style fundamentals (stamina, rolls with i-frames, flasks, bonfires, readable enemy
   tells, losing souls on death), with Destiny-style class abilities on top. Every other system feeds combat.
2. **A world worth exploring.** A seeded, chunk-streamed overworld with handmade set pieces (villages, shrines,
   boss arenas). Comparable feel: _Tunic_, _Death's Door_, _Hyper Light Drifter_.
3. **Hunt and forge.** Weapons and armor drop from enemies and Wardens with random tiers and perks; materials from
   enemies and the land become upgrades, potions, tools and a restored village (`docs/gear-and-loot.md`).
4. **Life sim in service of combat.** Fishing, farming and pets exist to feed the fight (materials, buff food, a
   companion), not as a second game. No seasons, relationships or day/night planned.

Working principles:

- **Not a Souls purist.** Souls conventions are a reference, not a rule; improve on them where hindsight says so
  (the loot magnet, class abilities, a settings screen).
- **Data-driven.** Tunable numbers, items, recipes, classes and abilities live in `content/` and hot-reload.
- **Deterministic simulation.** It keeps saves exact, tests headless, and co-op possible later (ADR 0002).
- **Platform:** web first, desktop later. Keyboard and mouse for now.

## Done

| Milestone                      | What it delivered                                                                                                                                                                                                                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Foundation**              | Deterministic headless sim and ECS, procedural chunk-streamed world with prefabs, combat (sword, roll, stamina, flasks, bonfires), slime / hollow / archer / shield knight, health bars and damage numbers, save slots with migrations, content pipeline, dev tools                                  |
| **2. Items and crafting**      | Inventory with stack limits; weapon, armor and two ring slots; forge upgrades (+1 to +3); potions as timed buffs beside the flask; recipes at a forge, an alchemy table or anywhere; material drops; loot magnet; breakable trees and mushrooms                                                      |
| **3. Classes and abilities**   | Three classes (Vanguard / Ward, Stalker / Shade, Ashcaller / Ember), nine data-driven abilities on G / C / V (the AoE is hold to aim), super energy, class choice on new game and at bonfires, class color on effects, light, HUD and menus, cast poses, class sigils and ability icons (foundation) |
| **Settings and accessibility** | Settings screen with key rebinding, fill-the-window scaling, full screen, volume; every on-screen key follows the bindings; ability hints, an Abilities tab; class shown by name and sigil, never color alone                                                                                        |
| **Art pipeline**               | Every character, enemy, item icon and crafting station is real art made from source scripts (`tools/art`); a pixel-art UI kit                                                                                                                                                                        |
| **Navigation**                 | Bonfire travel, the world map (fog of war, landmarks, a pin), the compass strip, bonfire beacons, signposts that point home                                                                                                                                                                          |
| **4. Bosses and restoration**  | Five village restoration projects (well, storehouse, palisade, lamps, smithy) as the wood and stone sink; stone from rocks; the Ashen Warden in a fixed keep north of the village, with a fog gate, slam and charge, shield phases broken at braziers, adds and a boss bar (ADR 0012)                |

## Now: tuning Milestone 4

Milestone 4 is built, with its art: the Ashen Warden, the ruined and rebuilt village sites, the arena brazier and
the relic icons are all generated from source (`tools/art`). What is left:

- **Objectives (built):** Maren, by the village bonfire, gives the story's objectives in order: take an oath from a
  shrine knight and bring it to her (the class ability), beat the Warden and bring her what he kept (the super),
  rebuild the smithy. The HUD tracks the current one; the map never marks it. Content in `objectives.json`.
- **Tune from playtests:** the Warden's health, slam and charge, its shield thresholds and adds; project costs;
  how fast rocks give stone.
- **Carried over from Milestone 3:** tune abilities (cooldowns, damage, super charge rate, the class glow), and
  optional effect sprites (PixelLab) to replace the drawn rings and particles.

## Open decisions

These need an answer before the milestones that depend on them.

1. ~~**What do souls buy?**~~ **Decided:** levels at bonfires, in four attributes (ADR 0011).
2. ~~**How are abilities earned?**~~ **Decided:** through play and the story. Relics awaken the class ability and
   the super (ADR 0011), carried to Maren as objectives. Variants and modifiers per ability come next (ability
   trees, under Planned).
3. ~~**Life sim scope.**~~ **Decided:** farming, fishing and pets unlock through restoring the village, in service
   of combat. No seasons, relationships or free-form building.
4. **Terrain art.** PixelLab's top-down tilesets blend terrains at their edges, which needs neighbor-aware tile
   choice in the chunk renderer first. Alternatively, the art agent could make tiles from source like the rest.
5. ~~**Item quality and perks.**~~ **Decided (2026-10-31):** gear is looted, not crafted, in five tiers with
   rolled perks, six weapon types, and Warden chests with signature items. The full design and its decisions are in
   [`docs/gear-and-loot.md`](gear-and-loot.md).
6. **Co-op.** "Maybe later". The deterministic sim keeps it possible; nothing is planned.

## Planned

### Navigation (next, before bosses)

**Why:** in playtesting the user lost the spawn village (and its forge and alchemy table) and couldn't find it again.
The world is endless and procedural, and nothing told you where anything was. Built in this order:

1. **Bonfire travel** (done). While resting at any lit bonfire, warp to any other lit bonfire. Ashen Village is the
   hub, with the stations, and its bonfire is lit from the start of every game, so home is always on the list.
   The save keeps every lit bonfire's name and position (`SimState.bonfires`), so far ones can be reached. There
   is **no recall or "return home" item**: rejected as too cheesy, so travel is only ever between bonfires.
2. **World map** (M key) (done):
   - Fog of war: only chunks the player has visited show. They're saved in sim state and drawn with the tiles'
     existing `map` colors.
   - Markers: lit bonfires, stations, discovered shrines and camps, the player's position and facing, and the
     death spot where lost souls lie.
   - Player-placed pins.
   - Coordinates only in the map footer and a dev overlay.
3. **Compass strip** (done) across the top of the HUD: N / E / S / W, plus markers for the nearest lit bonfire,
   the village, the player's pin and where you died. North is always up in this game, so it is a fixed 360° bearing
   bar (N in the middle, S at both ends) rather than one that turns with the player. A marker hides once you are
   standing at it, and the death marker clears when you walk back to the spot. It can be hidden in Settings.

**Low-cost landmarks** alongside (done): a faint pillar of light above every lit bonfire, drawn over the darkness and
tall enough to be seen before the bonfire itself; and a signpost in every wayshrine that says how far and which way
Ashen Village lies (the world has no roads yet, so signposts stand at the wayshrines instead).

**The Navigation milestone is complete.**

**Considered and not chosen:** a minimap (the 384×216 view has no room to spare), raw coordinates on the HUD, and
separate portals (bonfire travel covers them).

**Never gated:** bonfire travel, the world map and the compass are available from the start. Returning villagers
(the restoration thread) only add extras, such as a cartographer who marks unexplored shrines on your map.

### The restoration thread (runs through Milestones 4 and 5)

The story spine made playable: bringing Ashen Village back to life is how the game's systems open up.

- **Each boss guards a Kindling**, a flame carried back to the village bonfire. Each Kindling restores one
  authored thing:
  - **The fields clear of ash:** farming opens, and crops give buff food.
  - **A villager returns:** the smith (better forge upgrades), the alchemist (new recipes), the fisher (fishing),
    or a beast-tamer (pets).
  - **The blight pushes back:** enemies stop spawning within a growing radius of the village.
- **Authored, not free-form.** Each restoration is a fixed step (this boss restores that), never free-form base
  building. A step may cost materials or souls to rebuild, which gives crafting materials a long-term use.
- **The world shows it.** Restored areas lose their ash tint, and the light over the village bonfire grows with
  each Kindling.
- **The Sovereign Ember** (the super's relic) is the first boss's reward, beside its Kindling (done).

#### Restoration projects: the wood and stone sink

Restoration is built through **projects**: ruined spots in Ashen Village (a dry well, collapsed houses, a burned
smithy, a fallen palisade, ash-choked fields). Interacting with one shows its cost and what it gives; rebuilding it
swaps the ruin for its restored version, so the village visibly grows. This is what gives **wood (ashwood) and
stone** a long-term use, and souls another one.

| Tier      | Needs                            | Examples                                                                                                                                                                                 |
| --------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Small** | Wood + stone (+ souls), any time | Repair the well (+1 flask charge); rebuild the storehouse (more inventory slots); raise the palisade (enemies stop spawning near the village); lamp posts (light)                        |
| **Major** | A **Kindling** + wood + stone    | Rebuild the smithy (the smith returns: better forge upgrades); restore the fields (farming); clear the dock (the fisher returns: fishing); mend the pens (the beast-tamer returns: pets) |

- **Small projects come first**, so wood and stone matter before any boss is beaten. Major projects are the
  Kindlings' rewards.
- **Data-driven:** projects live in `content/restoration.json` (cost, requirements, reward, the ruin they replace),
  like recipes, so they can be tuned or added without code.
- **Stone:** rocks break with the sword (several swings, like trees) and drop stone, through the existing
  breakable-tile system. The hills and ruins get more rock to quarry. A crafted pickaxe and axe come later (see
  Later).
- Still authored steps, never free-form base building.

### Milestone 4: Bosses (built; tuning left, see Now)

Destiny- and Tunic-style boss fights, each guarding a Kindling (the restoration thread). The first, the Ashen
Warden, covers all of the list below except carried relics and pressure plates beyond its braziers (ADR 0012):

- **Damage phases** with immune windows the player opens through mechanics.
- **Arena mechanics:** pressure plates, carried relics, waves of adds.
- **Boss arenas** as prefabs placed in the world, with a fog gate and an entrance moment.
- **A boss health bar**, phase transitions, and a reward (a material, an ability, a key item). The first boss
  takes over the **Sovereign Ember** (the super's relic), which a second shrine guardian drops until then.
- **Boss art** from the art agent (done: the Warden, the village sites, the brazier, relic icons).
- **Restoration projects** (the wood and stone sink above): the small projects, stone from rocks, and the first
  major project, opened by the first boss's Kindling.

Decisions 1 and 2, which it depended on, are made (ADR 0011).

### Ability trees (phases 1 to 4 built)

Owner's playtest ask: abilities and supers need far more depth. Decided shape: **variants and modifiers**. Each
ability gets 2-3 versions picked at a bonfire; each class gets modifier slots that tie its abilities together.
Base versions are free, variants cost souls, the best come from Wardens.

1. **Built: the framework.** Variants are whole abilities with `variantOf` (content only), learned with souls and
   swapped at a bonfire. One variant per AoE and class ability from existing effects: Shockwave, Bulwark Rush,
   Twin Charge, Cutting Step, Wildfire, Backdraft.
2. **Built: healing and overshield.** Zones can heal or shield the player standing in them, a new
   `overshield` effect, and an overshield band on the health bar. Hearth and Cinder Ward (Fire Pot), Rally
   (Ground Slam).
3. **Built: Stalker tricks.** Latch (Ash Bomb: a charge that sticks to an enemy), False Step (Shadowstep: leaves
   a decoy enemies chase; bosses are not fooled), Vanish (Shadowstep: unseen for a while, and the first blow out
   of hiding deals double and gets past shields). Enemies now pick a target instead of always the player.
4. **Built: supers and modifiers.** Two versions per super: Bastion (a shielding dome) and Avalanche (a long
   charge) for Earthshatter, Ghost Run (unseen and fast) and Knife Fan (a volley) for Bladestorm, Meteor (one
   huge fused strike) and Pyre (a burning aura that follows you) for Cinder Storm. Class modifiers in
   `modifiers.json`, four per class: three bought with souls, one a Warden's. Two slots, plus one per defeated
   Warden.
5. **Art and tuning (under way):** every variant has its own icon (PixelLab, `docs/ICON_ART.md`). A first
   number pass toned down Pyre, Bastion's shield and Iron Will and raised Meteor; the rest waits on a playtest.

### Next: Gear and loot (decided, not built)

Playtest feedback shifted gear from crafting to loot. The design, its research and the owner's decisions are in
[`docs/gear-and-loot.md`](gear-and-loot.md). Phases, in order:

0. **Bonfire and saves (built):** resting and every panel hold the world still (`InputFrame.menu`); no resting
   or changing gear while an enemy is after you; wild enemies come back somewhere new at each rest and never
   within `world.restClearance` tiles of the bonfire; saves before version 14 are refused with a "start a new
   game" message.
1. **Gear foundation (built):** weapon, two rings, helmet, chest and legs; every piece of gear carries its tier,
   item level, rolled perks and roll seed; `loot.json` holds tiers, a first pool of 17 stat perks and the drop
   tables; Armor on the k = 60 curve with a 75% cap; soft-capped attributes; Power; the paper-doll equipment
   screen with try-on comparisons, tier borders and a "worse" badge; enemy drops by biome item level, with pity;
   forge gear recipes removed; a new game starts in Common sword, hood, jacket and wraps.
2. **Perks (built):** effect perks that share the class modifiers' hooks (kill heals, cooldowns, a rest
   shield, poise), class perks on rings with smart loot, Greater perks (Noble and up, 1 in 20, ×1.5), Blighted
   drops (Rare and up, 4%, a drawback and ×1.4), tier floors (an extra flask charge from Noble, extra roll i-frames
   from Rare), no doubled perks, and five Legendary bases with hand-made powers: Cinderbrand, Crown of the
   Unforgotten, Pyreheart Cuirass, Ashwalker Greaves and Ring of the Last Ember. Weapon-type perk pools and the
   other Legendary weapons come with phase 3.
3. **Weapon types (built):** every type taps a light chain with a finisher, holds for a charged
   attack (full charge has a payoff) and strikes out of a roll; hitstop, lunges, stagger and hyper armor per move,
   all in `weapons.json`. The sword (Flow), spear (Tipper, a 360° sweep) and hammer (Break: crushes, hyper armor,
   a full-charge shockwave) are in, with class affinity, type perks, the Ashwood Spear and Stone Maul, and two
   Legendaries (Oathspear, Gravebell). Twin daggers are in too: Flank crits from behind, Bleed that bursts at five
   stacks, a lunge-through charge, the Bone Daggers and Iron Dirks, and Twinfang. The bow is in: stamina is its only ammo, arrows pin, and a
   release in the Perfect window pierces and rips out every pin; the Ashwood Bow, Bone Recurve and Pale Wind.
   The Ember staff is in: melee hits store Embers (up to 4) that its charged fireball spends (a weak spark
   with none), the Ember Staff and Charred Rod, and Hearthwood. All six weapon types are built.
4. **Economy (built):** salvage (at the forge or a bonfire; materials by tier, a Warden Mark from a
   Legendary, never souls) with locking, junk marks, "salvage junk" and auto-salvage for Common and Standard;
   armor upgrades; infusing an old piece's upgrades onto a new one; tempering a perk and cleansing blight (the
   smith, once the smithy is rebuilt); respec at a bonfire. Weapon coatings at the alchemy table (fire, bleed,
   Warden's Bane, 90 s); an axe and a pickaxe in two tiers (fewer swings, more yield, and richer finds like iron
   from rock); ranks II and III for the well, storehouse, palisade and lamps (III needs a Warden Mark); and the Ember
   Gambler, who opens shop with the storehouse's rank II.
5. **Wardens (built):** a chest every time a Warden falls (the first kill keeps its story drops and adds a Noble
   or better); the Ashen Warden's signature, the Warden's Aegis (a ring of embers after a roll), with pity (12%,
   +6% a miss, sure by the 8th chest) and 6 Warden Marks to buy it; Rekindle from the Warden's bonfire (refights
   give only items); Heat 2 and 3 with Warden Sigils (tougher, richer, and a ring of embers from the slam at Heat
   3); the alternate kill (bait its charge onto the braziers three times for the Warden's Brand); and a poise
   meter hammers fill three times faster.
6. **Onboarding (built):** Maren's first errand, the Road Camp by the old road west of the village: clear 5 hollows
   and 3 slimes, beat Grub (a named hollow boss with one slow, telegraphed lunge, who always drops a Standard
   helmet), and gather 20 fungal caps, which she turns into your first 5 Field Bandages before sending you to rest.
   New `kill`, `gather` and `all` goals, objective rewards, and a "New gear" card and toast when picked-up gear
   would raise Power.
7. **Art (built):** every gear base has its own icon (15 new, the Legendaries and the Warden's pieces among
   them); Noble and Legendary drops raise a beam in their tier's color with a pip on the compass, and gear near
   the player shows its name in its tier's color (the chimes were already in). Gear shows on the character: a
   body for each chest weight, a hood, cap or full helm by the helmet's weight (with a setting to hide it), the
   weapon of each of the six types in hand, trims and legs in the tier's color, and an ember glint for a
   Legendary ring.

### Next: Power, the stash and the character screen (built)

The next round of gear work: Power from 10 to 1000 printed on every item, drops a little above the best you own,
cheap infusion, dismantling anywhere, pockets and a stash, a Destiny-style slot flyout, and more enemies. The
proposal and its open questions are in [`docs/power-and-stash.md`](power-and-stash.md). Phases, in order:

1. **More enemies (built):** wild enemies rise in packs (2 to 4, from each biome's pack table), about 2.5 × as
   many as before; a melee attack token (`world.packs.attackers`, 1) makes a pack take turns, the rest holding
   their ground; the Hollow Camp comes up twice as often, and the new Ash Nest (slimes and Hollows round an Ash
   Mother, an elite that always drops gear); gear chance per kill cut (Hollow and archer 8% → 5%, slime 3% → 2%).
2. **Power (built):** Power 10 to 1000 on every piece instead of item levels (save version 16); your Power is
   the average worn, Max Power the best owned per slot; enemy Power by distance rings round the village (bosses
   their own, Heat +100 a step); the gap scales blows dealt (weapon) and taken (armor); drops at Max Power plus a
   source offset, at least the foe's Power, at most the ring's cap (a Warden's chest: its Power + 100); a red skull
   over foes 50+ above you, the rings on the map, and `power` / `setpower` dev commands.
3. **Pockets, bag, materials and stash (built):** 9 spare pieces per gear slot (rings share), 12 stacks of
   consumables, unlimited materials; a 200-piece stash that opens at the village bonfire, and at every bonfire
   once the Storehouse is rebuilt (its ranks now add stash room); full pockets send new gear to the stash from
   anywhere; Max Power counts the stash; a Stash tab and Stash buttons on the Inventory screen.
4. **The character screen (built):** Character, Bag, Stash, Crafting and Abilities tabs; slot tiles with only
   icon, tier and Power; a flyout per slot of everything owned for it (carried and stashed, highest Power first,
   ▲ when better); a short card on hover, full inspect on right-click; click to equip (straight from the stash
   where it opens); Equip best; a short stat line with Details; arrow keys and Enter. No gamepad yet.
5. **Dismantle and infuse (built):** dismantle anywhere by holding the button, junk (X) and lock (L) marks, a held
   "Dismantle all junk" with a preview (never locked pieces or Legendaries, Noble only when ticked), auto-junk in
   place of auto-salvage, and Infuse at any bonfire: raise a piece to a stronger one's Power for 1 bone shard and
   50 souls, the stronger one used up.

**Playtest round 2 (2026-11-02).** Density and the Warden fight landed well. Changed from the notes:

- **Gear can change mid-fight:** the lock while an enemy is after you is gone.
- **Charged attacks cut terrain like taps:** each tile takes a hit the first tick a swing reaches it, so a lunging
  charge (the daggers' lunge-through, the sword's thrust) no longer passes trees by.
- **Charged attacks cost 2.5 to 4 times a light swing's stamina,** and a new weapon perk (`chargedStamina`, 20%)
  brings it down.
- **The class dodge throws enemies off for 1.5 s after the dash** (was 0.4 s).
- **Shots hit what they visibly pass through:** arrows, fireballs and knives test their whole path each tick against
  a hurtbox that rises to the foe's body, not just its footprint.
- **Infuse needs the same rarity,** and costs Echoes (a new material every dismantled piece gives, more for better
  tiers) plus 50 souls. **Hold F** over a piece in a flyout to dismantle it (1.5 s, the tile fills, letting go
  cancels); the held buttons take 1.5 s too.
- **Supers with their own weapons** ([`docs/supers.md`](supers.md), ADR 0013): all three roaming supers are built,
  Bladestorm's shade blades, Earthshatter's stone maul and Cinder Storm's cinder stave; the burst and defensive
  variants' upgrades come next.
- **Tools, kept apart from weapons** (owner's call): crafted, no Power, worn on a tool belt (axe and pickaxe now;
  the hoe and rod quarters wait on farming and fishing). Attacking a tree or rock with its tool on the belt swings
  the tool, whatever weapon is held, and only tools fell trees and break rock. Tools wear out after so many swings
  and break: crafting new ones is the materials' sink. A new game starts with a crude axe and pickaxe (craftable
  anywhere); the iron and smith's tools bite deeper, yield more and last longer. The swing shows the tool itself (its
  icon, chopping down at the hand), so a crude, iron or smith's tool reads as what it is.
- **The character screen, redesigned from the mood board** (owner approved, with their sketch): weapon, tool belt
  and rings left of the character drawn in their gear, armor right, one big Power number, a quiet info column that
  becomes the hovered piece's card, flyouts over the character that close when you move away, and key hints along
  the bottom. Stats and actions are icons with hover text (`ui_icons`). The Bag and Stash tabs share the frame: fill on
  top, the bag's fixed slots, the stash filtered by slot and sorted by Power, the hovered piece in the info column.

### Milestone 5: Life sim, in service of combat

Each part opens through the restoration thread: a Kindling clears the fields or brings back the villager who
teaches it.

- **Fishing:** a skill-based minigame; fish are materials and buff food.
- **Farming:** crops for buff food and alchemy.
- **Pets:** a tamable companion that fights beside you.

### Later

- **Gathering tools:** a crafted axe and pickaxe. Trees and rocks break with the sword for now; tools would make
  gathering a progression step (faster, more yield, or required for harder nodes).
- Terrain tiles and the last placeholder props (bonfire, sign, torch, pickups) and the digit font.
- Desktop build (Steam).
- Real audio (today every sound is procedural).
- Co-op, if decided.

### Housekeeping

- **CI:** GitHub has no checks on pull requests yet. A workflow running `pnpm check` would catch problems before
  merge, now that several sessions open PRs.

## Who makes what

| Work                                           | Who                                                                                                                                                                                                                                |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code, content, integration, docs               | The main Claude Code session in this repo                                                                                                                                                                                          |
| Characters, enemies, props, cast poses         | The art agent: Python voxel generators in `tools/art`. It runs in the cloud with **no access to this repo**, so its briefs must be self-contained and files reach it by hand. Each delivery is checked to reproduce byte for byte. |
| UI kit, class sigils, ability icons, (terrain) | A PixelLab session through the PixelLab MCP, in this repo, on its own branch and PR                                                                                                                                                |
| Playtesting, decisions, priorities             | The project owner                                                                                                                                                                                                                  |

The art spec and every delivery's port report: `docs/CHARACTER_ART.md`.
