# Cleanup list: what is left of the crafting era

Written 2026-11-02, after the gear rework (`gear-and-loot.md`) and the Power and stash rework
(`power-and-stash.md`). The game started with players crafting their own gear at a forge, one weapon upgrade path,
a 24-slot pack, item levels from biomes and a computed Power. Those systems are gone, but pieces of them remain in
code, text and docs. Nothing here has been changed yet: each item is marked for a cleanup pass. Tick items off (or
delete them) as they land.

**The content is clean.** No recipe, reward, drop or prefab makes gear any more; recipes only make consumables,
coatings, tools and Warden Sigils. Biomes have no item levels, and no code reads `ilvl`, `inventorySlots` or
auto-salvage.

## 1. Players can see it (fix first)

- [ ] **"Cannot craft: …" for things that aren't crafting.** `craftFailed` has become the general refusal event,
      but the toast (`src/client/app.ts:630`) only names some of its sources. Equipping from a closed stash,
      gambling, Rekindle and buying a signature all show "Cannot craft: …". Rename the event to `actionFailed`
      with a verb, or map every source.
- [ ] **The Crafting tab's old weapon upgrade panel** ("Reinforce X to +N", `inventory.ts` `upgradePanel`). It
      upgrades only the weapon, through the old `upgrade` action (`input.ts`, `crafting.ts` `nextUpgrade`,
      `canUpgrade`, `upgradeWeapon`), while the inspect view's Upgrade button (`smithy-panel.ts`) does every slot.
      Opening the forge lands on this panel. Delete the panel, the action and the wrappers; point the `upgrade`
      dev command at `upgradeGear [slot]`; move its two tests (`items.test.ts`, `restoration.test.ts`).
- [ ] **The "New gear" card describes the old Power** (`src/client/tutorial.ts:100-101`): "Power sums up your gear
      and levels. Nothing is ever locked behind it." Power is now the average of what you wear, and the gap to an
      enemy's Power matters. Rewrite.
- [ ] **"Pack" wording** for what is now the Character screen: toasts (`app.ts:531`, `app.ts:684`), the title
      screen's key line (`ui.ts:484`), the tool fact "Works from the pack" (`inventory.ts`, `facts`).

## 2. Dead or duplicated code

- [ ] **Gear without rolls can still be made.** `addItem` never rolls gear, so the `item` and `equip` dev
      commands make Power-0 Common pieces, and so would any recipe, reward or drop that named a gear item (content
      validation doesn't stop it). Decide one: `addItem` rolls gear at Max Power, or validation rejects gear ids
      in recipes, rewards and drops and the dev commands roll. Several tests rely on unrolled gear.
- [ ] **Unused `level` parameter** on `addItem` and `roomFor` (`items.ts`): it served the old salvage and infuse.
- [ ] **Material stack sizes** (`stack: 99`) mean nothing now that materials have no limit; `addItem` still splits
      materials into stacks of 99 and the card says "Stacks to 99". Make `stack` matter only for consumables.
- [ ] **A circular import** between `crafting.ts` and `smithy.ts` (`Check`, `stationNearby`). Move those to a
      small shared module once the old upgrade path is gone.
- [ ] **Unused CSS:** `.inventory .equip`, `.inventory .items .gear`, `.inventory .cell .worse`, `.recipe.upgrade`
      (with the panel), and stale comments around `.pack-tools`.
- [ ] **Over-exported symbols** used only in their own file: `upgradeWeapon`, `targetStack`, `junkToSalvage`,
      `GearUpgrade`, `statScale`, `scaleEffect`, `computeStats`, `equipFromStash`, `EQUIP_SLOTS`,
      `armorReduction`, `itemName`.
- [ ] **`forgeSteps` is only a label** (no code reads it; the gate is each step's `requires: "smithy"`), and armor
      steps' `requires` isn't validated the way weapons' are.

## 3. Wrong comments in code

- [ ] "Item level" in comments: `schemas.ts` (several, including a stray one on the biome's `ground` field and the
      Gambler's "level band"), `gear.ts`, `components.ts`, `inventory.ts`.
- [ ] `input.ts` says salvage needs the forge or a bonfire and infusing the forge; `events.ts` says infusing moves
      upgrades.
- [ ] `state.ts`: "absent in saves from before it" on fields older than the oldest save that still loads (16).
- [ ] Orphan or stale doc comments in `inventory.ts` (header, "paper doll", "pack slot", an empty crafting
      section header), `tutorial.ts`, `smithy-panel.ts`, and the Max Power comment stranded in `power.ts`.
- [ ] `pickups.ts` talks about a "full pack" for materials, which never fill.

## 4. Docs that contradict the game

- [ ] **roadmap.md:** "Last updated 2026-10-31"; "Now: tuning Milestone 4" ignores the gear work; the Done table
      has no gear or Power rows; Navigation still sits under Planned; "Gear and loot (decided, not built)"; gear
      phase 1 and 4 notes describe item levels, the paper doll, salvage at a forge and the old infuse; the
      storehouse still "adds inventory slots"; "Later" still lists the axe and pickaxe, which are built.
- [ ] **gear-and-loot.md:** the status line says nothing is built. The sections that `power-and-stash.md` replaced
      need "superseded" notes: the equipment screen (§3), the 24-slot bag, auto-salvage, the old infuse, Storehouse
      "+8 slots", the Gambler's level band, salvage at the forge.
- [ ] **power-and-stash.md:** still introduces itself as a proposal ("Today Power is a computed…").
- [ ] **content-pipeline.md:** pack size, item-level growth, "at item level 1", the magnet and full packs, the
      Gambler's level band, "works from the pack", `forgeSteps`, the effects table (missing `smithWork`,
      `gambler`), and "aoe (F)" (it is G).
- [ ] **ADRs:** 0012 lists `inventorySlots` and pack capacity; 0009 says quality is predictable and the inventory
      doesn't pause the game. Mark both amended. **There is no ADR for loot, Power and storage**, though
      `gear-and-loot.md` promises one: write ADR 0013.
- [ ] **CLAUDE.md:** "How to add things" has no entry for gear (bases, tiers, perks, Power, Legendaries), and says
      the art generators are "currently `player`" (there are about twelve).
- [ ] **architecture.md** (no `power.ts` or `storage.ts`, Power as derived from stats), **saves.md** (oldest save
      is 16, not 15), **dev-tools.md** (missing `gear`, `power`, `setpower`, `smith`, `rekindle`, `objective`;
      `upgrade` described as the old weapon upgrade).

## 5. Needs a decision from the owner

- [ ] **The story renames.** None of the "text that would change" in `story.md` has been applied (the title line,
      Oath and Sovereign Ember, the Warden's Kindling, "Keeper of the Last Kindling", the smithy's "Kindling"). It
      waits on the story draft being approved. The table also misses fire wording added since: "THE LAST EMBER
      FLARES", "The embers stir", "draws in the flame", Rekindle, the Ember Gambler, the Kindling modifier,
      Kindled Edge. Internal ids (`kindling_warden`, `relic_oath`) can keep their names.
- [ ] **story.md** says the smith brings "better forge upgrades"; the rebuilt smithy brings tempering and cleansing.
