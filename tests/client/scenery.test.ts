import { Container, Texture, TextureSource } from 'pixi.js';
import { describe, expect, it } from 'vitest';
import type { Assets } from '../../src/client/assets';
import { canopyHidesPlayer, ChunkLayer } from '../../src/client/render/chunk-layer';
import { Body } from '../../src/sim/components';
import { newSim } from '../helpers';

function setup() {
  const sim = newSim();
  for (const chunk of sim.world.loaded) chunk.tiles.fill(sim.content.tileId('grass'));
  sim.world.load(0, 0).tiles.fill(sim.content.tileId('grass'));
  sim.world.setTile(31, 31, 'tree');
  const texture = new Texture({ source: new TextureSource({ width: 48, height: 64 }) });
  const sheet = {
    named: new Map(
      ['tree', 'fungal_tree', 'dead_tree', 'giant_shroom_0', 'giant_shroom_1'].map((name) => [name, texture]),
    ),
    def: { anchor: [0.5, 1] },
  };
  const assets = {
    version: 0,
    sheet: () => sheet,
    missingTexture: Texture.EMPTY,
  } as unknown as Assets;
  const depth = new Container({ sortableChildren: true });
  const layer = new ChunkLayer(assets, depth);
  return { sim, depth, layer, assets };
}

describe('full-size terrain scenery', () => {
  it('fades overlapping foliage smoothly, leaves the trunk opaque, and restores it in front', () => {
    const { sim, depth, layer } = setup();
    const player = sim.ecs.need(sim.player, Body);
    player.x = 504;
    player.y = 482 - player.h / 2;
    layer.sync(sim, 16);
    const tree = depth.children[0]!;
    const canopy = tree.children[0]!;
    const trunk = tree.children[1]!;
    expect(canopy.alpha).toBeGreaterThan(0.18);
    expect(canopy.alpha).toBeLessThan(1);
    expect(trunk.alpha).toBe(1);
    layer.sync(sim, 1000);
    expect(canopy.alpha).toBeCloseTo(0.18, 2);
    player.y = 520;
    layer.sync(sim, 1000);
    expect(canopy.alpha).toBeCloseTo(1, 2);
    layer.clear();
    depth.destroy({ children: true });
  });

  it('does not fade scenery beside the player or below the player head area', () => {
    const bounds = { x: 100, y: 100, width: 48, height: 45 };
    expect(canopyHidesPlayer(bounds, 164, { x: 80, y: 130, w: 10, h: 10 })).toBe(false);
    expect(canopyHidesPlayer(bounds, 164, { x: 124, y: 80, w: 10, h: 10 })).toBe(false);
    expect(canopyHidesPlayer(bounds, 164, { x: 124, y: 180, w: 10, h: 10 })).toBe(false);
    expect(canopyHidesPlayer(bounds, 164, { x: 124, y: 130, w: 10, h: 10 })).toBe(true);
  });
  it.each(['fungal_tree', 'dead_tree', 'giant_shroom'])('uses tile frame names for %s scenery', (tile) => {
    const { sim, depth, layer } = setup();
    sim.world.setTile(31, 31, tile);
    layer.sync(sim);
    expect(depth.children).toHaveLength(1);
    expect(depth.children[0]?.zIndex).toBe(512);
    layer.clear();
    depth.destroy({ children: true });
  });
  it('anchors scenery at its world-space trunk, including the edge of a chunk', () => {
    const { sim, depth, layer } = setup();
    layer.sync(sim);
    expect(depth.children).toHaveLength(1);
    const tree = depth.children[0]!;
    expect([tree.x, tree.y, tree.zIndex]).toEqual([504, 512, 512]);
    const behind = new Container();
    behind.zIndex = 511;
    const ahead = new Container();
    ahead.zIndex = 513;
    depth.addChild(ahead, behind);
    depth.sortChildren();
    expect(depth.children).toEqual([behind, tree, ahead]);
    layer.clear();
    depth.destroy({ children: true });
  });

  it('removes felled trees and refreshes scenery without duplicate sprites', () => {
    const { sim, depth, layer, assets } = setup();
    layer.sync(sim);
    layer.sync(sim);
    expect(depth.children).toHaveLength(1);
    assets.version++;
    layer.sync(sim);
    expect(depth.children).toHaveLength(1);
    sim.world.setTile(31, 31, 'grass');
    layer.sync(sim);
    expect(depth.children).toHaveLength(0);
    sim.world.setTile(31, 31, 'tree');
    layer.sync(sim);
    sim.world.unload('0,0');
    layer.sync(sim);
    expect(depth.children).toHaveLength(0);
    layer.clear();
    depth.destroy({ children: true });
  });
});
