import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { playerLook } from '../../src/client/render/player-look';
import type { TierId } from '../../src/content/schemas';
import { Equipment, Wielding, type ItemStack } from '../../src/sim/components';
import { ROOT } from '../../scripts/lib/load-content';
import { content, newSim } from '../helpers';

const worn = (item: string, tier: TierId): ItemStack => ({
  item,
  count: 1,
  level: 0,
  gear: { tier, power: 1, seed: 1, perks: [] },
});
const color = (tier: TierId) => Number.parseInt(content.loot.tiers[tier].color.slice(1), 16);

describe('playerLook', () => {
  it('follows the chest’s weight, the helmet’s shape and the weapon’s type', () => {
    const sim = newSim();
    const eq = sim.ecs.need(sim.player, Equipment);
    Object.assign(eq, {
      chest: worn('iron_mail', 'noble'),
      helmet: worn('iron_helm', 'rare'),
      weapon: worn('ashwood_spear', 'common'),
      legs: null,
    });
    const look = playerLook(sim, true);
    expect(look.body).toBe('player_plate');
    expect(look.layers).toEqual([
      { sheet: 'player_trim_plate', tint: color('noble') },
      { sheet: 'player_helm', tint: 0xffffff },
      { sheet: 'player_helm_trim', tint: color('rare') },
      { sheet: 'player_spear', tint: 0xffffff },
    ]);
  });

  it('hides the helmet when the setting says so, and shows bare cloth with nothing worn', () => {
    const sim = newSim();
    const eq = sim.ecs.need(sim.player, Equipment);
    Object.assign(eq, { chest: null, helmet: worn('ashen_hood', 'common'), weapon: null, legs: null });
    const look = playerLook(sim, false);
    expect(look.body).toBe('player');
    expect(look.layers.map((l) => l.sheet)).toEqual(['player_trim_cloth']);
  });

  it('shimmers with a Legendary ring', () => {
    const sim = newSim();
    const eq = sim.ecs.need(sim.player, Equipment);
    expect(playerLook(sim, true).shimmer).toBe(false);
    eq.ring1 = worn('ring_of_the_last_ember', 'legendary');
    expect(playerLook(sim, true).shimmer).toBe(true);
  });

  it('only names sheets that exist, for every weapon type and armor weight', () => {
    const sim = newSim();
    const eq = sim.ecs.need(sim.player, Equipment);
    const sheets = new Set<string>();
    for (const [id, def] of Object.entries(content.items)) {
      if (def.kind !== 'weapon' && def.kind !== 'armor') continue;
      Object.assign(eq, { weapon: null, chest: null, helmet: null, legs: null });
      const slot = def.kind === 'weapon' ? 'weapon' : def.armor.slot;
      eq[slot] = worn(id, 'standard');
      const look = playerLook(sim, true);
      sheets.add(look.body);
      for (const l of look.layers) sheets.add(l.sheet);
    }
    const missing = [...sheets].filter((s) => !existsSync(join(ROOT, 'assets', 'sprites', `${s}.json`)));
    expect(missing).toEqual([]);
  });
});

describe('a roaming super in hand', () => {
  it('shows its weapon, tinted, in place of the held one, and every super weapon has its sheet', () => {
    const sim = newSim();
    Object.assign(sim.ecs.need(sim.player, Equipment), { weapon: worn('ashwood_bow', 'common') });
    sim.ecs.add(sim.player, Wielding, {
      ability: 'bladestorm',
      weapon: 'shade_blades',
      ticks: 600,
      bonus: 0,
    });
    const blades = content.weapons.supers['shade_blades']!;
    const weapon = playerLook(sim, true).layers.at(-1);
    expect(weapon).toEqual({
      sheet: blades.look.sheet,
      tint: Number.parseInt(blades.look.tint.slice(1), 16),
    });
    const missing = Object.values(content.weapons.supers)
      .map((s) => s.look.sheet)
      .filter((s) => !existsSync(join(ROOT, 'assets', 'sprites', `${s}.json`)));
    expect(missing).toEqual([]);
  });
});
