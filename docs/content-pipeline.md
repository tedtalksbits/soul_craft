# Content and asset pipeline

Everything a designer tunes lives in data, validated on load and hot-reloaded while the game runs.

## Content (`/content`)

| File                  | What it defines                                                                    |
| --------------------- | ---------------------------------------------------------------------------------- |
| `player.json`         | Player stats: health, stamina, attack timing, roll, flask, pack size, starting kit |
| `items.json`          | Items: materials, weapons, armor, rings, consumables                               |
| `recipes.json`        | Crafting recipes: output, inputs, soul cost, station                               |
| `loot.json`           | Gear tiers, perks, item-level growth, pity and the drop tables enemies name        |
| `weapons.json`        | Weapon types: each one's chain, charged attack, dash-strike and signature rule     |
| `restoration.json`    | Village projects: cost, tier, effects, ruin and rebuilt sprites, villager lines    |
| `npcs.json`           | People to talk to (Maren): name, sprite frame, small talk                          |
| `objectives.json`     | The story's objectives, in order: giver, HUD line, what is said, the goal          |
| `classes.json`        | Classes: name, element, and their AoE, class and super abilities                   |
| `abilities.json`      | Abilities: slot, cooldown, cast timing and a list of effects                       |
| `modifiers.json`      | Class modifiers: passive bonuses worn in slots, and how many slots there are       |
| `enemies.json`        | Enemy archetypes: stats, drops, a `brain`, and a `boss` block for bosses           |
| `tiles.json`          | Tile types: sprite frames, solidity, cutting, light, map color                     |
| `biomes.json`         | Ground, scatter rules, darkness, ambient particles, spawn tables                   |
| `world.json`          | Terrain noise, biome rules, origin, region and fixed prefab placement              |
| `prefabs/<id>.json`   | Handmade set pieces as ASCII rows plus a legend                                    |
| `scenarios/<id>.json` | Dev boot presets: a seed and console commands                                      |

Schemas: `src/content/schemas.ts`. Cross-references (biome → tile, prefab → enemy and so on) are checked in
`src/content/content.ts`. One bad file reports every problem with its path, and the running game keeps its
last good content.

Ways to edit:

1. **Any text editor**, with `pnpm dev` running: save and the game reloads that file in place (toast:
   "Reloaded content/…"). Errors print in the console (`).
2. **In-game editor** (F10, or `edit enemies.json`): changes apply live as soon as the whole content set
   validates; **Save** writes the file through the dev server.
3. `pnpm content:validate` from the CLI or CI.

Hot-reloaded stats apply to things spawned afterwards. Rest at a bonfire (or run `rest`) to respawn enemies
with new values. World and tile edits regenerate the loaded chunks immediately.

Files are kept in the canonical layout that the editor writes (`pnpm content:format`), so editor saves only
diff what changed. Note that JSON objects list numeric-looking keys first (e.g. prefab legend `"2"`).

### Cuttable tiles

A tile with `cut` can be broken by the player's sword: `{ "hits": 3 }` takes three swings (one hit per swing,
however many tiles the swing covers), `into` is what it becomes (default: the local biome's first ground
tile, so a dead tree leaves ash in the hills and pale earth in the graveyard), and `drops` lists pickups.
Partial damage is remembered per tile and saved. Currently: tall grass and tall moss (1 hit, small drops),
trees and fungal trees (3), dead trees and giant mushrooms (2). Trees and mushrooms drop crafting materials
(ashwood, fungal caps, glowspores), never souls. Rocks, walls, graves and water are not cuttable.

Movement assistance for the player lives in `player.json`: `cornerSlide` is how many pixels the player is
nudged around a corner it clips while walking straight (0 turns it off). Enemies get none, so a knight's
charge still slams into corners.

The loot magnet is `player.json → magnet`: landed drops within `radius` px fly to the player, starting at
`speed` px/tick and gaining `accel` per tick up to `maxSpeed`. Once caught, a drop keeps coming. Items the pack has
no room for are not pulled. `radius: 0` turns it off.

### Items and recipes

Every item has `kind`, `name`, `description`, `icon` (a frame name in `assets/sprites/items.json`) and
`stack` (equipment must be 1). By kind:

- `material`: nothing else; used by recipes, upgrades and restoration projects.
- `key`: nothing else; carried until something spends it (a boss's Kindling, for a major project).
- `weapon`: `weapon { type, damage, staminaCost, reach, width, knockback }` and `upgrades`, the forge steps in
  order, each `{ damage, souls, items }`, plus an optional `requires` (a restoration project that must be rebuilt
  first: the last steps wait on the smithy). `type` (`sword`, `spear`, `hammer`, `daggers`, `bow` or `staff`) picks its moves from
  `weapons.json`, which multiply these numbers. Unarmed fights like a weak sword, on purpose.
- `armor`: `armor { slot, value, weight }`: `helmet`, `chest` or `legs`; its Armor at item level 1, Common; and
  `cloth`, `leather` or `plate` (how it will look on the character). Plus `upgrades`, forge steps like a weapon's
  that each add `armor`.
- `ring`: nothing of its own; its power is its `innate` perk. Two ring slots.

Weapons, armor and rings are gear, and gear is loot (docs/gear-and-loot.md). Each also takes `innate` (fixed perks,
`[{ perk, value }]`, at item level 1, Common strength) and `drop` (how often the base is picked when gear drops,
relative to the others of its slot; `0` never drops, like the Chipped Sword). A copy's tier, Power, rolled
perks and roll seed live on the item itself, not here; the tier scales the base's damage, Armor and innate perks
(Power never does: it is checked against the foe's), so tuning a base re-tunes every copy.

`loot.json` holds the five `tiers` (name, color, how many perks they roll, and multipliers for base stats and
perk strength), `power` (the starting and highest Power, each drop source's offset above Max Power, and a Warden
chest's headroom above its Power), `perkSpread` (how far a roll lands from its target),
`pity` (after `after` drops in a row below `tier`, the next is that tier or better), the named `tables` of tier
odds, `greater` and `blight` (from which tier, how often, and how much stronger), `smartLoot` (the share of
class perks that are for the class being played), and `perks`. A perk is `{ text, stat | effect, value, slots }`
plus optional `integer`, `fixed` (never scaled or spread), `class` (works only for that class), `minTier` and
`drawback` (a Blighted item's: it takes its stat away and only rolls as one). A stat perk's `text` shows `{v}` as
the value. An `effect` is one of the class modifier effect types, so gear and modifiers share the same hooks;
its numbers are written at strength 1 and the roll scales them, and `{v}` shows its headline
number. A weapon, armor piece or ring with a `power { name, text, effect }` is a Legendary base: it drops only as a
Legendary, and its `innate` perk is the power's partner. A power's `text` is shown as written (`{v}` is only
filled in for perks). An enemy drops gear with `gear { chance, table }`; its
Power comes from `modules/power.ts`: Max Power plus the source's offset, at least the foe's own Power, at most its
ring's cap (`world.json → rings`). Enemy Power comes from those rings by distance from the village, or a boss's
`boss.power`, and `player.json → power.gap` sets how the gap scales blows both ways. Validation insists every slot can roll the best tier's number of perks and
has a base that can drop, and that class perks and effects name real classes and abilities.

`weapons.json` gives each weapon type a light `chain` (tapped; the last move is the finisher, and
`chainWindow` ticks after a move ends the next tap continues it), a `charged` move (held; full after
`chargeTicks`, else `partial` damage and no payoff), a `dash` move (an attack within `dashWindow` ticks of a
roll), a `signature` rule (`flow`, `tipper`, `break`, `flank`, `pin` or `embers`) and the classes it has an `affinity` with. Each move sets
multipliers for `damage`, `stamina`, `reach`, `width` and `knockback`, its timing (`duration`, `activeFrom`,
`activeTo`), `hitstop`, `lunge`, `stagger`, `hyperArmor`, `around` (a full sweep), `through` (lunges through foes, untouchable), `shot` (fires an arrow instead of
swinging; a negative `lunge` steps back), and how it is drawn (`arc`,
`pose`). A type can also set `drawDrain` (stamina a held charge burns per tick) and `chargePose`. `affinityBonus`,
`minCharge` and `chargeMove` apply to every type. A perk with `weaponTypes` rolls only on
weapons of those types.

A boss's `boss` block can add `poise { max, stagger }` (weapon damage fills it while the shield is down, hammers
three times faster; full, the boss staggers) and `warden { signature, alternate { item, slams } }`: its named
Legendary, and the one it gives instead when its charge was baited onto the arena's braziers `slams` times.
`loot.json → wardens` sets the chest (pieces, tier odds, the first kill's tier floor, materials, Marks), the
signature's pity, the Marks that buy it outright, the Sigil item, and what each step of Heat adds.

`restoration.json` projects can have `ranks`: rank II, III and so on, each `{ description, cost, effects }`, raised
at the site like the first rebuild and adding to the effects before them. The `gambler` effect opens the Ember
Gambler's shop at the site; `loot.json → gambler` sets the price per level band, the levels in a band, and the
tier `odds`.

`loot.json → smithy` prices the smithy's work: `salvage` (per tier, how many of each slot's three
`materials`, plus one `mark` item from a Legendary; never souls), `temper` (souls and items, times a factor per
tier, rising by `growth` per temper to at most `cap` times), `cleanse` (souls and items) and `infuse` (the share
of the old item's upgrade costs that moving them takes). The `smithWork` restoration effect brings the smith
back, for tempering and cleansing.

Armor cuts hits to `k / (k + Armor)` (`player.json → armor`), never past `cap` with buffs. Attributes gain less
past `leveling.softCaps`: each `perLevel` value is `[below, between, past]` the two breakpoints, and gear's
attribute points count toward them.

- `relic`: `unlocks` (`class` or `super`) and `source` (where it is found, shown on locked abilities). Taken on
  pickup, never carried; it only drops while its slot is still locked.
- `consumable`: `effect` is `{ type: "heal", amount }`, `{ type: "buff", stat, amount, seconds }` or a weapon coating,
  `{ type: "coat", coating, seconds }`, where `coating` is `{ kind: "fire", damage, seconds }` (hits set foes
  burning), `{ kind: "bleed", stacks, ticks, damage, stagger }` (hits stack Bleed) or `{ kind: "warden", bonus }`
  (more damage to bosses). A new coating replaces the old one.
- `tool`: `tool { kind, tier, power, yield }`, an `axe` or `pick`. It works from the pack (the best of each kind
  carried counts): `power` extra hits a swing on tiles whose `cut.tool` matches, `yield` more item drops, and the
  tile's `cut.toolDrops` up to its `tier`.
  Drinking one takes the flask's drink time. A second buff on the same stat refreshes the first.

A buff's `stat` is `damage`, `defense`, `staminaRegen` (fractions: 0.2 = +20%) or `maxHp` (points).

A recipe is `{ output { item, count }, inputs [{ item, count }], souls, station }`, where `station` is
`"forge"`, `"alchemy"` or `null` (craftable anywhere). Stations are prefab entities; the player must stand
within twice the interact range. Enemy and tile `drops` can be `{ "kind": "item", "item": "iron_scrap", ... }`.
Every item id named anywhere is cross-checked on load.

### Restoration projects

`restoration.json` maps a project id to `{ name, description, tier, cost { items, souls }, effects, sprite
{ ruin, restored }, restoredLines }`. A prefab places the site with `{ "kind": "project", "project": "well" }`;
interacting with the ruin shows the rebuild screen, and once rebuilt the site says its `restoredLines`. The
sprites are frames in the `village` sheet (`pnpm art village`). Effects (ADR 0012):

| Effect                                      | Gives                                                  |
| ------------------------------------------- | ------------------------------------------------------ |
| `{ "type": "maxFlasks", "amount": 1 }`      | Flask charges, added once when rebuilt                 |
| `{ "type": "inventorySlots", "amount": 8 }` | Pack slots                                             |
| `{ "type": "safeRadius", "tiles": 40 }`     | No enemies spawn within this many tiles of the village |
| `{ "type": "light", "radius": 70 }`         | Warm light at the site                                 |
| `{ "type": "forgeSteps" }`                  | Unlocks weapon upgrade steps that name this project    |

Stone comes from rocks (`tiles.json → rock.cut`), wood from trees.

### Bosses

A boss is an enemy with `boss { title, arenaTiles }`. Its arena is the square `arenaTiles` from its spawn point to
each side: walking in starts the fight, a bar shows its name and title, and the player is held inside until it
ends. Once killed it never respawns. The `warden` brain adds `shieldAt` (health fractions where its shield goes
up), `adds` (what it calls while shielded) and the slam and charge numbers; prefab `brazier` entities in the arena
break the shield when the player stands on them all. Boss arenas are placed by `world.json → fixed`
(`{ "prefab": "warden_arena", "region": [0, -1] }`), so every world has them in the same place. A fixed piece
takes over its region; `at` (its center, in world tiles) places it exactly instead, for one that must sit close to
the village (the Road Camp), and it must stay inside its region. A palisade's ward never holds a boss back.

Any enemy can take `sureGear { slot, tier }` (a piece it always drops: Grub's Standard helmet) and `look { scale,
tint }`, which draws it larger and tinted while it borrows another enemy's sprite.

### People and objectives

`npcs.json` names the people the player can talk to; a prefab places one with `{ "kind": "npc", "npc": "maren" }`,
drawn from the `npcs` sheet by its `sprite` frame. `objectives.json` is the story's to-do list, offered in file
order: each has a `giver`, the HUD's `track` line, `lines` (asking), `reminder` (asked again) and `doneLines`
(reported), and a `goal`: `unlock` (an ability slot awakened), `defeat` (a boss), `restore` (a project), `kill`
(`enemies`: kills by kind, e.g. `{ "hollow": 5 }`), `gather` (`item`, `count`, and `consume` to hand them over), or
`all` (`steps`, each a `text` and one of those goals, shown together on the HUD with their counts). Goals are read
from the world, so one met early completes the moment it is reported; kills alone count from the moment the
objective is given. `reward` lists items the giver hands over when it is reported. Objectives are never marked on
the map. Relics are carried to the giver: talking to Maren with one in the pack hands it over and awakens its slot.

### Leveling

`player.json → leveling`: `cost` (`base`, `growth`: a level costs `round(base * growth^(level - 1))` souls) and
`perLevel`, what one point in each attribute gives: `vigor.maxHp`, `endurance.maxStamina`, `might.damage`
(fraction of sword damage), `attunement.abilityDamage` and `attunement.energy` (fractions). Leveling happens
while resting at a bonfire. `player.json → start.unlocked` says which ability slots a new game has awakened
(default: neither; the AoE is always known).

### Classes and abilities

A class (`classes.json`) names one ability per slot: `aoe` (F), `class` (C) and `super` (V), plus an
`element`: a name and three colors (`light`, `base`, `dark`). The element is how players tell classes apart,
as Destiny's elements are: every ability effect and its damage numbers, the player's light, the charged-super
wisps and super glow, the HUD slots, the class cards, the toast on a class change and the class tag on the title,
pause and bonfire menus are drawn in it (all through `src/client/render/class-palette.ts`). Menus always show
the class and element names beside the color, so nothing depends on color alone. Each class has a sigil in
`assets/sprites/sigils.*` and each ability an icon in `assets/sprites/abilities.*` (16×16 frames named by id, made by
`pnpm art icons`). Both are gray glyphs that the game tints with the element; a new class or ability needs one. Keep the three classes'
`base` colors well apart in hue (today blue, violet, orange). Players pick a class on the new-game screen and can change it from the
bonfire menu while resting. `player.json → start.class` is the default for games started without that screen
(scenarios, `?new`, tests).

An ability (`abilities.json`) has a `slot`, a `cooldown` in seconds (AoE and class; supers spend a full energy
bar instead), a `cast` (`ticks` the player is locked, effects land on tick `release`), a `pose` (the player
animation it plays, e.g. `cast_slam`; default `attack`), and `effects`, applied in order:

- `blast`: hits everything within `radius`, at `self` or the cursor (`at: "aim"`, capped at `range`), after
  an optional `fuse` in ticks, and `latch`: a fused blast sticks to the nearest enemy within that many px
  of where it lands and rides along until it bursts. `damage`, `knockback`, and `stagger` (ticks the enemy is stopped, guard down).
- `zone`: ground at `self` or the cursor that pulses every `interval` ticks for `duration` ticks, after
  `delay`: `damage` to enemies in it, `heal` to the player standing in it, and `shield` (`amount` per pulse
  up to `max`, lasting `seconds`) as overshield. It needs at least one of the three. With `follow` (only at
  `self`) it moves with the player: an aura (Pyre).
- `decoy`: a false image where the player stood when the effect lands (before a dash moves them). Enemies
  that can see it chase it instead of the player for `seconds`. Bosses are not fooled.
- `vanish`: the player is unseen for `seconds` (enemies notice them only up close). Taking a hit ends it;
  attacking ends it too, and that first hit deals `bonus` more (1 = double) and gets past a raised shield.
- `overshield`: `amount` extra health on the player at once, for `seconds`. Overshield soaks blows before
  health; a blow it soaks completely doesn't make the player flinch. Resting clears it.
- `volley`: `count` knives thrown at once, fanned across `spread` degrees around the cursor. Each flies
  `range` px at `speed` px per tick and hits the first enemy it meets for `damage` and `stagger`.
- `dash`: carries the player `distance` px over `ticks`, optionally with i-frames, hitting what it passes
  (`width`, `damage`, `knockback`, `stagger`).
- `empower`: a super mode for `seconds`: `damage` and `crit` bonuses, `defense` (0.5 = half damage taken),
  `staminaFree` swings, and `speed` (0.5 = walk half again as fast).

Ability hits go through shields. Super energy is `player.json → energy`: `perDamage` dealt, `perKill` and
`perSecond`. The super's own hits don't charge it. Every class must name an existing ability of the right slot.

**Variants.** An ability with `variantOf` is another version of that base ability, in the same slot: the player
learns it for `souls` at a bonfire (Abilities, from the bonfire menu or the pack) and uses it in place of the base,
switching back and forth for free once learned. Classes always name the base. A variant draws its base's icon
until it has its own frame in the `abilities` sheet.

**Modifiers.** `modifiers.json` holds `slots` (`base` slots every class has, plus `perWarden` for each boss
defeated) and the `modifiers`, each for one `class`. A modifier costs `souls` to learn, or names a `boss`: then it
is free once that boss has fallen. The player puts them on and takes them off while resting (Abilities tab), and
each class keeps its own. Effects:

- `kill`: when the player kills an enemy (`where: "any"`, or `"zone"`: standing in one of the player's zones),
  take `cooldown.seconds` off a slot's cooldown, add `energy` and `heal`.
- `hurt`: `energy` per point of damage the player takes, even damage an overshield soaks.
- `cooldown`: a slot's cooldown times `factor` (0.75 = ready a quarter sooner).
- `castShield`: using the ability in `slot` gives `amount` overshield for `seconds`.
- `ambush`: adds `bonus` to the damage of the first blow out of hiding (Vanish, Ghost Run).

Modifier ids must not match an ability id (learned variants and modifiers share one record).

### Prefabs

```json
{
  "name": "Forsaken Shrine", // optional: named area (title on first visit)
  "darkness": 0.7, // optional: overrides biome darkness inside
  "biomes": ["pale_graveyard"], // optional: where region placement may put it
  "legend": {
    "#": { "tile": "wall" },
    "K": { "tile": "stone_floor", "entity": { "kind": "enemy", "archetype": "knight" } }
  },
  "rows": ["#####", "#.K.#", "#####"]
}
```

A sign's lines may include `{village}`, filled in when read with where the starting village lies from that sign
("Ashen Village lies 140 paces to the north-east."), so signposts always point home.

A prefab's optional `marker` (`village`, `shrine`, `camp`, `wayshrine`, `arena`) puts it on the world map once the player
has seen it, labeled with its `name`. Crafting stations are marked on their own. How far the player sees for the
map is `player.json → exploration.revealRadius` (tiles); the map draws each tile in its `map` color.

A space keeps the generated terrain. Entity kinds: `bonfire`, `sign`, `enemy`, `torch`, `station`
(`{ "kind": "station", "station": "forge" }`), `project` (a restoration site), `brazier` (a boss arena's),
`playerSpawn` (origin prefab only). To add a prefab to the world, add it to `world.json → regions.prefabs` with a weight.

## Sprites (`/assets/sprites`)

Each sheet is a PNG on a fixed grid plus a JSON sidecar (`src/content/sprite-sheet.ts`):

```json
{
  "image": "hollow.png",
  "frameWidth": 16,
  "frameHeight": 24,
  "anchor": [0.5, 1],
  "frames": { "still_name": 3 },
  "animations": { "walk_down": { "frames": [4, 5, 6, 7], "fps": 8, "loop": true } }
}
```

Frames are numbered left to right, top to bottom. Edit PNGs in any pixel editor (Aseprite, Piskel,
LibreSprite…). Saving hot-reloads the sheet.

**Animation names the renderer looks for**, most specific first: `<pose>_<dir8>`, `<pose>_<dir>`,
`<pose>`, then the same for `walk` and `idle`. `<dir>` is `down`, `up`, `left` or `right`; `<dir8>` adds
`down_right`, `up_right`, `up_left` and `down_left`. Diagonals are optional and are chosen from the direction
of travel, held while standing still. A missing pose falls back to walk/idle frames rather than failing.

**Pivots** (optional) name points relative to the anchor, in pixels, that effects attach to.
An animation may also carry an **offset** (pixels, x right, y down) added to the sprite position; generators
set it when they shift a pose to fit the frame, so the body still lands where it should.
`swing` places the player's sword arc; without one it sits 9 px above the feet.
Animations may also carry their own `pivots`, overriding the sheet-level ones for that animation (the
archer's per-direction `release` on `attack_<dir>`). In use: `swing` (player sword arc), `head` (enemy health
bar, 4 px above), `release` (arrow flight height; on `cast_throw_<dir>`, the throwing hand's `[x, y]`, where a
lobbed charge starts).

A cast pose may mark its **`release`** frame (an index into its `frames`). The game then times the pose to its
ability: the frames before the release share the ticks up to the ability's release tick, the release frame shows
exactly when the effect lands, and the rest share the remainder of the cast (a dash loops them instead). One pose
serves a quick class ability and a slow super alike.

- Player poses: `idle`, `walk`, `attack`, `roll`, `hurt`, `drink`, `sit`, `dead`, and the cast poses `cast_slam`,
  `cast_throw`, `cast_charge`, `cast_push`, `cast_raise`
- Enemy poses: `idle`, `walk`, `windup` (telegraph), `attack`, `hurt`, `stunned`, `hop`
- Props: `bonfire_lit`, `bonfire_unlit`, `torch`, `sign`, `souls`, `ember`
- Tiles: named frames referenced from `tiles.json`. `overlay: true` tiles are transparent and drawn over the
  local biome's ground.

### Generated character art

Characters with real art are generated from Python source in `tools/art/` (see its README):
`pnpm art:setup` once, then e.g. `pnpm art ashen_one` to rebuild `player.png` + `player.json`. Edit the
script, not the PNG.

### Placeholders

`pnpm assets:placeholders` draws programmatic placeholder sheets (`scripts/placeholders/`). It **never
overwrites existing files** unless you pass `--force` (optionally limited to names:
`pnpm assets:placeholders --force props`). What is still placeholder: tiles, props (bonfire, sign,
torch, souls, ember) and the font. Replace any PNG with real art whenever you like, keeping the
grid and JSON in step.
