# Roadmap

Where Soul Craft is going, how far it has got, and what is still undecided. Read this before starting a
feature: it says what the feature is for and what it must not grow into. Update it when a milestone lands or a
decision is made (decisions with lasting technical weight also get an ADR in `docs/adr/`).

Last updated: 2026-10-29, after Milestone 3's foundation.

## Vision

**A top-down Soulslike action RPG where you fight with elemental class powers, forge your gear from what you
gather, and explore a world that is different every time the flame wakes.**

**Premise.** Ashen Village is dying: ash chokes the fields, the villagers have fled or hollowed, and the blight's
guardians hold the land around it. You are the Ashen One, woken at its last bonfire. You restore the village and
bring it back to life for its people (see the restoration thread under Planned).

Pillars, in priority order:

1. **Combat first.** Souls-style fundamentals (stamina, rolls with i-frames, flasks, bonfires, readable enemy
   tells, losing souls on death), with Destiny-style class abilities on top. Every other system feeds combat.
2. **A world worth exploring.** A seeded, chunk-streamed overworld with handmade set pieces (villages, shrines,
   boss arenas). Comparable feel: _Tunic_, _Death's Door_, _Hyper Light Drifter_.
3. **Gather and craft.** Materials from enemies and the land become gear, upgrades and potions.
4. **Life sim in service of combat.** Fishing, farming and pets exist to feed the fight (materials, buff food, a
   companion), not as a second game. No seasons, relationships or day/night planned.

Working principles:

- **Not a Souls purist.** Souls conventions are a reference, not a rule; improve on them where hindsight says so
  (the loot magnet, class abilities, a settings screen).
- **Data-driven.** Tunable numbers, items, recipes, classes and abilities live in `content/` and hot-reload.
- **Deterministic simulation.** It keeps saves exact, tests headless, and co-op possible later (ADR 0002).
- **Platform:** web first, desktop later. Keyboard and mouse for now.

## Done

| Milestone                      | What it delivered                                                                                                                                                                                                                                                           |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Foundation**              | Deterministic headless sim and ECS, procedural chunk-streamed world with prefabs, combat (sword, roll, stamina, flasks, bonfires), slime / hollow / archer / shield knight, health bars and damage numbers, save slots with migrations, content pipeline, dev tools         |
| **2. Items and crafting**      | Inventory with stack limits; weapon, armor and two ring slots; forge upgrades (+1 to +3); potions as timed buffs beside the flask; recipes at a forge, an alchemy table or anywhere; material drops; loot magnet; breakable trees and mushrooms                             |
| **3. Classes and abilities**   | Three classes (Vanguard / Ward, Stalker / Shade, Ashcaller / Ember), nine data-driven abilities on F / C / V, super energy, class choice on new game and at bonfires, class color on effects, light, HUD and menus, cast poses, class sigils and ability icons (foundation) |
| **Settings and accessibility** | Settings screen with key rebinding, fill-the-window scaling, full screen, volume; every on-screen key follows the bindings; ability hints, an Abilities tab; class shown by name and sigil, never color alone                                                               |
| **Art pipeline**               | Every character, enemy, item icon and crafting station is real art made from source scripts (`tools/art`); a pixel-art UI kit                                                                                                                                               |

## Now: finishing Milestone 3

- **Tune abilities from playtests:** cooldowns, damage, super charge rate, the class glow's strength.
- **Done: progression and unlocks** (ADR 0011). Souls buy levels at bonfires (Vigor, Endurance, Might,
  Attunement), and a new game knows only its AoE: relics from Forsaken Shrine guardians awaken the class ability
  and then the super.
- **Optional:** effect sprites for the abilities (PixelLab), to replace the drawn rings and particles.

## Open decisions

These need an answer before the milestones that depend on them.

1. ~~**What do souls buy?**~~ **Decided:** levels at bonfires, in four attributes (ADR 0011).
2. ~~**How are abilities earned?**~~ **Decided:** through play. Relics awaken the class ability and the super
   (ADR 0011). Destiny-style variants per slot could still come later, as boss rewards.
3. ~~**Life sim scope.**~~ **Decided:** farming, fishing and pets unlock through restoring the village, in service
   of combat. No seasons, relationships or free-form building.
4. **Terrain art.** PixelLab's top-down tilesets blend terrains at their edges, which needs neighbor-aware tile
   choice in the chunk renderer first. Alternatively, the art agent could make tiles from source like the rest.
5. **Item quality and perks.** Deferred in Milestone 2 (ADR 0009) until there is loot worth rolling.
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
- **The Sovereign Ember** (the super's relic, which a second shrine knight drops for now) becomes the first boss's
  Kindling reward.

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

### Milestone 4: Bosses

Destiny- and Tunic-style boss fights, each guarding a Kindling (the restoration thread):

- **Damage phases** with immune windows the player opens through mechanics.
- **Arena mechanics:** pressure plates, carried relics, waves of adds.
- **Boss arenas** as prefabs placed in the world, with a fog gate and an entrance moment.
- **A boss health bar**, phase transitions, and a reward (a material, an ability, a key item). The first boss
  takes over the **Sovereign Ember** (the super's relic), which a second shrine guardian drops until then.
- **Boss art** from the art agent.
- **Restoration projects** (the wood and stone sink above): the small projects, stone from rocks, and the first
  major project, opened by the first boss's Kindling.

Decisions 1 and 2, which it depended on, are made (ADR 0011).

### Milestone 5: Life sim, in service of combat

Each part opens through the restoration thread: a Kindling clears the fields or brings back the villager who
teaches it.

- **Fishing:** a skill-based minigame; fish are materials and buff food.
- **Farming:** crops for buff food and alchemy.
- **Pets:** a tamable companion that fights beside you.

### Later

- **Gathering tools:** a crafted axe and pickaxe. Trees and rocks break with the sword for now; tools would make
  gathering a progression step (faster, more yield, or required for harder nodes).
- Relic icons (the Oath and Sovereign Embers use stand-in item icons).
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
