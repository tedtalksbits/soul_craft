/**
 * Cuttable terrain: tall grass, trees, mushrooms. Each swing that touches a
 * cuttable tile deals one hit; damage is remembered per tile (in SimState, so
 * it survives unloading and saves) until the tile breaks into ground.
 */
import type { DropDef, ToolKind } from '../../content/schemas';
import type { Box } from '../../core/math';
import { Inventory } from '../components';
import { TILE } from '../constants';
import type { Simulation } from '../simulation';
import { rollDrops } from './combat';

/** The best tool of a kind the player carries, if any: the highest tier wins. */
export function bestTool(sim: Simulation, kind: ToolKind) {
  let best: { tier: number; power: number; yield: number } | null = null;
  for (const s of sim.ecs.get(sim.player, Inventory)?.stacks ?? []) {
    const def = sim.content.items[s.item];
    if (def?.kind === 'tool' && def.tool.kind === kind && def.tool.tier > (best?.tier ?? 0)) best = def.tool;
  }
  return best;
}

/** A tool's yield on a tile's drops: item amounts grow, souls and embers don't. */
function richer(drops: readonly DropDef[], yieldBonus: number): DropDef[] {
  if (yieldBonus <= 0) return [...drops];
  return drops.map((d) =>
    d.kind === 'item'
      ? {
          ...d,
          amount: [Math.round(d.amount[0] * (1 + yieldBonus)), Math.round(d.amount[1] * (1 + yieldBonus))],
        }
      : d,
  );
}

export const tileDamageKey = (tx: number, ty: number): string => `${tx},${ty}`;

/** Deals one hit to every cuttable tile under `box`. Returns whether any multi-hit tile was struck. */
export function strikeTiles(sim: Simulation, box: Box): boolean {
  let solidHit = false;
  for (let ty = Math.floor(box.y / TILE); ty <= Math.floor((box.y + box.h) / TILE); ty++) {
    for (let tx = Math.floor(box.x / TILE); tx <= Math.floor((box.x + box.w) / TILE); tx++) {
      const tile = sim.world.tileAt(tx, ty);
      const cut = tile?.cut;
      if (!tile || !cut) continue;
      if (cut.hits > 1) solidHit = true;
      const x = tx * TILE + TILE / 2;
      const y = ty * TILE + TILE / 2;
      const key = tileDamageKey(tx, ty);
      // The right tool bites deeper: extra hits a swing, and richer drops once it breaks.
      const tool = cut.tool ? bestTool(sim, cut.tool) : null;
      const taken = (sim.state.tileDamage[key] ?? 0) + 1 + (tool?.power ?? 0);
      if (taken < cut.hits) {
        sim.state.tileDamage[key] = taken;
        sim.events.emit({ type: 'tileHit', x, y, tile: tile.id, hitsLeft: cut.hits - taken });
        continue;
      }
      Reflect.deleteProperty(sim.state.tileDamage, key);
      sim.world.setTile(tx, ty, cut.into ?? groundAt(sim, tx, ty));
      rollDrops(sim, richer(cut.drops, tool?.yield ?? 0), x, y);
      for (const extra of cut.toolDrops)
        if (tool && tool.tier >= extra.tier) rollDrops(sim, extra.drops, x, y);
      sim.events.emit({ type: 'tileCut', x, y, tile: tile.id, hits: cut.hits });
    }
  }
  return solidHit;
}

/** The local biome's primary ground tile: what a felled tree or mushroom leaves behind. */
function groundAt(sim: Simulation, tx: number, ty: number): string {
  const biome = sim.content.biomes[sim.world.gen.biomeAt(tx, ty)];
  const ground = biome?.ground[0]?.[0];
  if (ground === undefined) throw new Error(`No ground tile for biome at ${tx},${ty}`);
  return ground;
}
