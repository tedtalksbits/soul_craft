# Icons: the full list, and how to replace them

Every icon in the game is one PNG in `assets/sprites/source/icons/<sheet>/`, packed into one of four sprite sheets
in `assets/sprites/` by `pnpm icons`. This page lists each icon by the name the game uses, says what it stands
for, and explains how to swap in your own art.

| Sheet       | Icons | Drawn                             | Where they show                                                      |
| ----------- | ----- | --------------------------------- | -------------------------------------------------------------------- |
| `ui_icons`  | 27    | **Grayscale**, tinted by the game | Character, Bag and Stash screens: stats, keys and actions            |
| `items`     | 57    | **Full color**                    | Inventory cells, the quick slot on the HUD, the tool in a tool swing |
| `sigils`    | 3     | **Grayscale**, tinted by the game | The class emblem on the HUD and in menus                             |
| `abilities` | 27    | **Grayscale**, tinted by the game | The HUD's ability slots and the Abilities screen                     |

**114 icons in all.** Seven of them are drawn but not shown anywhere yet (marked _unused_ below). You can skip
those for now.

## The rules every icon follows

- **16×16 pixels, a transparent background,** with the subject centered. The game draws these at 2× in menus
  (32 px on screen) and at 1× in the HUD's 16 px ability slots. `pnpm icons` rejects any other size; larger art,
  such as 32×32, needs a change to the packer and the display scales.
- **Grayscale sheets (`ui_icons`, `sigils`, `abilities`):** draw them in whites and grays only. The game
  multiplies each pixel by a color. On the `ui_icons` sheet, that's ember gold for Power, off-white for what you
  press and dim ash for labels. Sigils and abilities take their class's color: Vanguard blue `#6fb7f0`, Stalker
  violet `#a98ce8` and Ashcaller orange `#ff7a30`. White becomes the full color and darker grays become shadow, so
  any color you paint in will be lost.
- **Full-color sheet (`items`):** draw these as finished art. Light comes from the upper left in the rest of the
  game. A 1 px dark outline keeps them readable on the dark slot frames.
- **Gear is not tinted per rarity:** the rarity color goes on the slot's frame. So one icon covers a piece at
  every tier.

## The lists

### `ui_icons`: stats, keys and actions (grayscale)

| Name          | Stands for                                                               | Shown                                   |
| ------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `power`       | Power, the average of what you wear (the game's headline number)         | Top of the character screen; item cards |
| `power_max`   | Max Power, the best piece you own per slot (a hollow version of `power`) | Top of the character screen             |
| `attack`      | Attack damage                                                            | Info column; item cards                 |
| `armor`       | Armor / damage taken                                                     | Info column; item cards                 |
| `health`      | Max health, and the Vigor attribute                                      | Info column; item cards; Details        |
| `stamina`     | Max stamina, stamina regen, and the Endurance attribute                  | Info column; item cards; Details        |
| `level`       | Character level                                                          | Info column                             |
| `might`       | The Might attribute                                                      | Details                                 |
| `attunement`  | The Attunement attribute                                                 | Details                                 |
| `souls`       | Souls (the currency)                                                     | _unused_                                |
| `crit`        | Critical hits                                                            | _unused_                                |
| `ability`     | Ability power                                                            | _unused_                                |
| `healing`     | Healing                                                                  | _unused_                                |
| `speed`       | Move speed                                                               | _unused_                                |
| `mouse_left`  | Left click                                                               | Footer key hints                        |
| `mouse_right` | Right click                                                              | Footer key hints                        |
| `equip`       | Equip                                                                    | Footer key hints                        |
| `inspect`     | Inspect / select                                                         | Footer key hints                        |
| `junk`        | Mark as junk                                                             | Footer key hints                        |
| `lock`        | Lock; also "browse only" on a closed stash                               | Footer key hints; Stash top bar         |
| `dismantle`   | Dismantle (hold F)                                                       | Footer key hints                        |
| `infuse`      | Infuse                                                                   | _unused_                                |
| `stash`       | The stash                                                                | Stash top bar                           |
| `bag`         | The bag; also the stash's "everything else" filter                       | Bag top bar; Stash filters              |
| `all`         | The stash's "everything" filter                                          | Stash filters                           |
| `best`        | Equip best                                                               | The Best button                         |
| `details`     | The full stat sheet                                                      | _unused_                                |

### `items`: everything you can carry (full color)

Some icons serve more than one name in the game. Each row below is one icon to draw.

| Name                       | Item                                         | Kind               |
| -------------------------- | -------------------------------------------- | ------------------ |
| `ashwood`                  | Ashwood                                      | material           |
| `stone`                    | Stone                                        | material           |
| `fungal_cap`               | Fungal Cap                                   | material           |
| `glowspore`                | Glowspore                                    | material           |
| `iron_scrap`               | Iron Scrap                                   | material           |
| `bone_shard`               | Bone Shard                                   | material           |
| `slime_gel`                | Slime Gel                                    | material           |
| `echo`                     | Echo (what dismantled gear leaves)           | material           |
| `warden_mark`              | Warden Mark                                  | material           |
| `warden_sigil`             | Warden Sigil                                 | material           |
| `crude_axe`                | Crude Axe                                    | tool               |
| `crude_pickaxe`            | Crude Pickaxe                                | tool               |
| `iron_axe`                 | Iron Axe                                     | tool               |
| `iron_pickaxe`             | Iron Pickaxe                                 | tool               |
| `steel_axe`                | Smith's Axe                                  | tool               |
| `steel_pickaxe`            | Smith's Pickaxe                              | tool               |
| `chipped_sword`            | Chipped Sword                                | weapon             |
| `iron_sword`               | Iron Sword                                   | weapon             |
| `bone_cleaver`             | Bone Cleaver                                 | weapon             |
| `ashwood_spear`            | Ashwood Spear                                | weapon             |
| `stone_maul`               | Stone Maul                                   | weapon             |
| `bone_daggers`             | Bone Daggers                                 | weapon             |
| `iron_dirks`               | Iron Dirks                                   | weapon             |
| `ashwood_bow`              | Ashwood Bow                                  | weapon             |
| `bone_recurve`             | Bone Recurve                                 | weapon             |
| `ember_staff`              | Ember Staff                                  | weapon             |
| `charred_rod`              | Charred Rod                                  | weapon             |
| `cinderbrand`              | Cinderbrand                                  | weapon (Legendary) |
| `oathspear`                | Oathspear                                    | weapon (Legendary) |
| `gravebell`                | Gravebell                                    | weapon (Legendary) |
| `twinfang`                 | Twinfang                                     | weapon (Legendary) |
| `pale_wind`                | Pale Wind                                    | weapon (Legendary) |
| `hearthwood`               | Hearthwood                                   | weapon (Legendary) |
| `wardens_brand`            | The Warden's Brand                           | weapon (Legendary) |
| `ashen_hood`               | Ashen Hood                                   | helmet (cloth)     |
| `iron_helm`                | Iron Helm                                    | helmet (plate)     |
| `crown_of_the_unforgotten` | Crown of the Unforgotten                     | helmet (Legendary) |
| `padded_jacket`            | Padded Jacket                                | chest (cloth)      |
| `iron_mail`                | Iron Mail                                    | chest (plate)      |
| `pyreheart_cuirass`        | Pyreheart Cuirass                            | chest (Legendary)  |
| `wardens_aegis`            | The Warden's Aegis                           | chest (Legendary)  |
| `wanderers_wraps`          | Wanderer's Wraps                             | legs (cloth)       |
| `iron_greaves`             | Iron Greaves                                 | legs (plate)       |
| `ashwalker_greaves`        | Ashwalker Greaves                            | legs (Legendary)   |
| `ring_vigor`               | Ring of Vigor                                | ring               |
| `ring_breath`              | Ring of Breath                               | ring               |
| `ring_last_ember`          | Ring of the Last Ember                       | ring (Legendary)   |
| `bandage`                  | Field Bandage                                | consumable         |
| `potion_ember`             | Ember Tonic                                  | consumable         |
| `potion_stone`             | Stoneskin Draught                            | consumable         |
| `potion_breath`            | Breath Tonic                                 | consumable         |
| `fire_oil`                 | Fire Oil                                     | consumable         |
| `bleeding_oil`             | Bleeding Oil                                 | consumable         |
| `wardens_bane`             | Warden's Bane                                | consumable         |
| `relic_oath`               | Oath Ember                                   | relic              |
| `relic_sovereign`          | Sovereign Ember                              | relic              |
| `kindling`                 | Warden's Kindling (a boss's restoring flame) | key item           |

**Tool icons:** draw them from the handle at the lower left to the head at the upper right. During a tool swing
the game draws the icon at the player's hand and rotates it on that diagonal, holding it by the bottom-left corner.

### `sigils`: class emblems (grayscale)

| Name        | Class                      |
| ----------- | -------------------------- |
| `vanguard`  | Vanguard: shield and earth |
| `stalker`   | Stalker: blades and shadow |
| `ashcaller` | Ashcaller: fire            |

### `abilities`: one per ability (grayscale, tinted with the class color)

Each class has three slots: an area ability, a class ability and a super. Each slot has a base ability and
variants that swap in for it. A variant without its own icon falls back to its base's, so the 9 base icons are
the minimum and the 18 variants are optional.

| Class     | Slot  | Base            | Variants                               |
| --------- | ----- | --------------- | -------------------------------------- |
| Vanguard  | area  | `ground_slam`   | `shockwave`, `rally`                   |
| Vanguard  | class | `shield_charge` | `bulwark_rush`                         |
| Vanguard  | super | `earthshatter`  | `bastion`, `avalanche`                 |
| Stalker   | area  | `ash_bomb`      | `twin_charge`, `latch`                 |
| Stalker   | class | `shadowstep`    | `cutting_step`, `false_step`, `vanish` |
| Stalker   | super | `bladestorm`    | `ghost_run`, `knife_fan`               |
| Ashcaller | area  | `fire_pot`      | `wildfire`, `hearth`, `cinder_ward`    |
| Ashcaller | class | `repel`         | `backdraft`                            |
| Ashcaller | super | `cinder_storm`  | `meteor`, `pyre`                       |

What each does, for the art brief:

| Name            | What it does                                             |
| --------------- | -------------------------------------------------------- |
| `ground_slam`   | A slam into the earth that hurls everything back         |
| `shockwave`     | A lighter, wider slam ring                               |
| `rally`         | A slam that steadies you                                 |
| `shield_charge` | A rush behind the shield that knocks foes down           |
| `bulwark_rush`  | A shorter, heavier shield rush                           |
| `avalanche`     | A long, unstoppable charge                               |
| `earthshatter`  | The ground gives you a stone maul (a super weapon)       |
| `bastion`       | A ring of stone raised around you                        |
| `ash_bomb`      | A lobbed charge of ash that bursts                       |
| `twin_charge`   | Two charges in one throw                                 |
| `latch`         | A barbed charge that sticks to a foe                     |
| `shadowstep`    | A blink through the air                                  |
| `cutting_step`  | A short blink with a blade out                           |
| `false_step`    | A blink that leaves your shadow behind as a decoy        |
| `vanish`        | Step into nothing: unseen for a while                    |
| `bladestorm`    | Twin shade blades in hand (a super weapon)               |
| `ghost_run`     | Unseen and faster for a long while                       |
| `knife_fan`     | Every knife thrown at once in a fan                      |
| `fire_pot`      | A thrown pot of ember oil that leaves the ground burning |
| `wildfire`      | Thinner oil spread wide                                  |
| `hearth`        | A warm patch that heals you                              |
| `cinder_ward`   | Embers that cling to you as armor                        |
| `repel`         | A pulse of heat that throws everything back              |
| `backdraft`     | A tighter, hotter pulse                                  |
| `cinder_storm`  | A stave of fire in hand (a super weapon)                 |
| `meteor`        | One great ember pulled down from the sky                 |
| `pyre`          | You set yourself alight                                  |

### Marks still drawn as text (optional)

These are typed characters rather than art. If your pack has icons for them, they can become `ui_icons` entries;
that takes a small code change each.

| Today | Means                                          |
| ----- | ---------------------------------------------- |
| 🔒    | A locked piece (corner of its cell)            |
| ✕     | A junk piece; also "where you died" on the map |
| ⇪     | Junk that could still infuse what you wear     |
| ▲ ▼   | Better or worse than what you wear             |
| S     | A piece that is in the stash (in a flyout)     |
| ☐ ☑   | The "include Noble" and Auto-junk toggles      |
| ▲     | "You" on the world map                         |

## How to replace them

Every icon is its own PNG in `assets/sprites/source/icons/<sheet>/<name>.png`, for example
`assets/sprites/source/icons/items/iron_sword.png` or `…/ui_icons/power.png`. Those files are the source of truth;
the sheets in `assets/sprites/` are built from them.

1. **Replace the file.** Save your icon over the old one with the same name: 16×16, PNG, transparent background.
   Do as many as you like; any you don't touch keep the current art.
2. **Pack:** run `pnpm icons`. It rebuilds all four sheets and their JSON, and `pnpm dev` shows the change at once.
   It reports, and exits with an error for:
   - a file it skipped: the wrong size, or a name with anything but lowercase letters, digits and `_`;
   - a name the game requires that has no file. That's every item's icon, every class's sigil and every base
     ability. Those would show as empty cells.

   It also lists files the game doesn't use. They're kept, so you can add an icon before its item exists.

3. **Commit** the loose files together with the rebuilt sheets. `pnpm check` fails if a sheet doesn't match its
   folder, which catches a forgotten `pnpm icons`.

**Adding an icon:** drop a new file in the folder and run `pnpm icons`. Then point at it by name: an item's
`"icon"` in `content/items.json`; for a new class or ability, its id is the name. An ability variant gets its own
icon just by having a file named after it; without one it shows its base's icon.

**Ordering:** a sheet keeps its icons in the cells they had and puts new names after them, so the game never needs
cell numbers from you. The JSON maps each name to its cell.

**Checking by eye:** run `pnpm dev`, then look at the character, Bag and Stash screens, the HUD's ability bar and
the Abilities screen. A `ui_icons` name with no file shows as an empty cell, not an error. The menus name those in
code, so `pnpm icons` can't check them; the list above is the full set.
