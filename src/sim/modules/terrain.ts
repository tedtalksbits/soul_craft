/**
 * Cuttable terrain: tall grass, trees, mushrooms. Each swing that touches a
 * cuttable tile deals one hit; damage is remembered per tile (in SimState, so
 * it survives unloading and saves) until the tile breaks into ground.
 */
import type { Box } from '../../core/math';
import { TILE } from '../constants';
import type { Simulation } from '../simulation';
import { rollDrops } from './combat';

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
      const taken = (sim.state.tileDamage[key] ?? 0) + 1;
      if (taken < cut.hits) {
        sim.state.tileDamage[key] = taken;
        sim.events.emit({ type: 'tileHit', x, y, tile: tile.id, hitsLeft: cut.hits - taken });
        continue;
      }
      Reflect.deleteProperty(sim.state.tileDamage, key);
      sim.world.setTile(tx, ty, cut.into ?? groundAt(sim, tx, ty));
      rollDrops(sim, cut.drops, x, y);
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
