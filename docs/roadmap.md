# Roadmap

Where Soul Craft is going, how far it has got, and what is still undecided. Read this before starting a
feature: it says what the feature is for and what it must not grow into. Update it when a milestone lands or a
decision is made (decisions with lasting technical weight also get an ADR in `docs/adr/`).

Last updated: 2026-10-29, after Milestone 3's foundation.

## Vision

**A top-down Soulslike action RPG where you fight with elemental class powers, forge your gear from what you
gather, and explore a world that is different every time the flame wakes.**

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
- **Decide how abilities are earned** (see open decisions). Today every class has all three from the start.
- **Optional:** effect sprites for the abilities (PixelLab), to replace the drawn rings and particles.

## Open decisions

These need an answer before the milestones that depend on them.

1. **What do souls buy?** Today only crafting and forge upgrades. Souls games level stats at the bonfire. Without
   some lasting progression there is little long-term pull, and **boss difficulty depends on how strong players
   can get**, so decide before Milestone 4.
2. **How are abilities earned?** Options: all from the start (today), Destiny-style variants per slot picked at
   a bonfire, or unlocked through play (bosses, shrines, items).
3. **Life sim scope.** Kept in service of combat (pillar 4), or bigger? Recommendation: in service of combat.
4. **Terrain art.** PixelLab's top-down tilesets blend terrains at their edges, which needs neighbor-aware tile
   choice in the chunk renderer first. Alternatively, the art agent could make tiles from source like the rest.
5. **Item quality and perks.** Deferred in Milestone 2 (ADR 0009) until there is loot worth rolling.
6. **Co-op.** "Maybe later". The deterministic sim keeps it possible; nothing is planned.

## Planned

### Milestone 4: Bosses

Destiny- and Tunic-style boss fights:

- **Damage phases** with immune windows the player opens through mechanics.
- **Arena mechanics:** pressure plates, carried relics, waves of adds.
- **Boss arenas** as prefabs placed in the world, with a fog gate and an entrance moment.
- **A boss health bar**, phase transitions, and a reward (a material, an ability, a key item).
- **Boss art** from the art agent.

Depends on: open decisions 1 and 2.

### Milestone 5: Life sim, in service of combat

- **Fishing:** a skill-based minigame; fish are materials and buff food.
- **Farming:** crops for buff food and alchemy.
- **Pets:** a tamable companion that fights beside you.

### Later

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
