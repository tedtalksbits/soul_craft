import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import { Body, Enemy, Equipment, Facing, Inventory, Player, Project } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { inputFrame } from '../../src/sim/input';
import { canUpgrade } from '../../src/sim/modules/crafting';
import { addItem, countItem } from '../../src/sim/modules/items';
import { rebuild } from '../../src/sim/modules/restoration';
import { inventoryCapacity } from '../../src/sim/modules/restored-effects';
import { resetEnemies } from '../../src/sim/modules/streaming';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, press, run } from '../helpers';

function site(sim: Simulation, project: string): Entity {
  for (const [e, p] of sim.ecs.query(Project)) if (p.project === project) return e;
  throw new Error(`no ${project} site loaded`);
}

/** Stands the player just below a project's site, facing it. */
function standAt(sim: Simulation, project: string): void {
  const at = sim.ecs.need(site(sim, project), Body);
  Object.assign(sim.ecs.need(sim.player, Body), { x: at.x, y: at.y + 14 });
  sim.ecs.need(sim.player, Facing).dir = 'up';
}

/** Gives the player everything a project costs, plus some to spare. */
function affordAll(sim: Simulation, project: string): void {
  const def = content.restoration[project]!;
  for (const c of def.cost.items) addItem(sim, sim.player, c.item, c.count);
  sim.ecs.need(sim.player, Player).souls += def.cost.souls + 50;
}

const rebuildAction = (project: string) => inputFrame({ actions: [{ type: 'rebuild', project }] });

describe('village restoration', () => {
  it('places every project in the village as a ruin', () => {
    const sim = newSim();
    run(sim, 1);
    const sites = [...sim.ecs.query(Project)].map(([, p]) => p.project).sort();
    expect(sites).toEqual(Object.keys(content.restoration).sort());
    expect(sim.state.restored).toEqual({});
  });

  it('rebuilds the well with wood, stone and souls, and adds a flask charge', () => {
    const sim = newSim();
    run(sim, 1);
    standAt(sim, 'well');
    affordAll(sim, 'well');
    const p = sim.ecs.need(sim.player, Player);
    const [souls, flasks] = [p.souls, p.maxFlasks];
    const inv = sim.ecs.need(sim.player, Inventory);
    const stone = countItem(inv, 'stone');

    const events = run(sim, 1, rebuildAction('well'));
    expect(ofType(events, 'restored')).toEqual([{ type: 'restored', project: 'well' }]);
    expect(sim.state.restored).toEqual({ well: true });
    expect(p.souls).toBe(souls - content.restoration['well']!.cost.souls);
    expect(countItem(inv, 'stone')).toBe(stone - 16);
    expect(p.maxFlasks).toBe(flasks + 1);
    expect(p.flasks).toBe(p.maxFlasks);
  });

  it('spends nothing when the player cannot pay or is not at the site', () => {
    const sim = newSim();
    run(sim, 1);
    standAt(sim, 'well');
    const p = sim.ecs.need(sim.player, Player);
    const souls = p.souls;
    const poor = run(sim, 1, rebuildAction('well'));
    expect(ofType(poor, 'rebuildFailed')[0]?.reason).toMatch(/^needs \d+ /);
    expect(p.souls).toBe(souls);

    affordAll(sim, 'well');
    standAt(sim, 'storehouse');
    const far = run(sim, 1, rebuildAction('well'));
    expect(ofType(far, 'rebuildFailed')[0]?.reason).toBe('too far from the site');
    expect(sim.state.restored).toEqual({});
  });

  it('opens a ruin to rebuild, and lets a rebuilt site speak', () => {
    const sim = newSim();
    run(sim, 1);
    standAt(sim, 'well');
    expect(ofType(press(sim, ['use']), 'projectOpened')).toEqual([
      { type: 'projectOpened', project: 'well' },
    ]);
    rebuild(sim, 'well', { free: true });
    expect(ofType(press(sim, ['use']), 'read')[0]?.lines).toEqual(content.restoration['well']!.restoredLines);
  });

  it('grows the pack when the storehouse is rebuilt', () => {
    const sim = newSim();
    const base = inventoryCapacity(sim);
    rebuild(sim, 'storehouse', { anywhere: true, free: true });
    expect(inventoryCapacity(sim)).toBe(base + 8);
    // More stone than the bigger pack holds: it fills every slot, the new ones included.
    const inv = sim.ecs.need(sim.player, Inventory);
    const left = addItem(sim, sim.player, 'stone', 99 * (base + 8) + 1);
    expect(inv.stacks.length).toBe(base + 8);
    expect(left).toBeGreaterThan(0);
  });

  it('keeps enemies from rising near the village once the palisade stands', () => {
    const sim = newSim();
    run(sim, 1);
    const ward = content.restoration['palisade']!.effects.find((f) => f.type === 'safeRadius');
    if (ward?.type !== 'safeRadius') throw new Error('palisade has no ward');
    const near = () =>
      [...sim.ecs.query(Enemy, Body)].filter(([, , b]) => Math.hypot(b.x, b.y) < ward.tiles * TILE).length;
    // Walk to the edge of the ward so the chunks inside it are loaded.
    Object.assign(sim.ecs.need(sim.player, Body), { x: (ward.tiles - 6) * TILE, y: 0 });
    run(sim, 2);
    const before = near();
    rebuild(sim, 'palisade', { anywhere: true, free: true });
    resetEnemies(sim);
    expect(near()).toBe(0);
    // Not a vacuous pass: this seed does put enemies inside the ward before the palisade.
    expect(before).toBeGreaterThan(0);
  });

  it('holds back the final forge steps until the smithy is rebuilt', () => {
    const sim = newSim();
    run(sim, 1);
    const def = content.items['chipped_sword'];
    if (def?.kind !== 'weapon') throw new Error('chipped_sword is not a weapon');
    const gated = def.upgrades.findIndex((u) => u.requires === 'smithy');
    expect(gated).toBeGreaterThan(0);
    sim.ecs.need(sim.player, Equipment).weapon = { item: 'chipped_sword', count: 1, level: gated };
    for (const c of def.upgrades[gated]!.items) addItem(sim, sim.player, c.item, c.count);
    sim.ecs.need(sim.player, Player).souls += def.upgrades[gated]!.souls;

    expect(canUpgrade(sim, { ignoreStation: true })).toEqual({
      ok: false,
      reason: 'needs the smithy rebuilt',
    });
    rebuild(sim, 'smithy', { anywhere: true, free: true });
    expect(canUpgrade(sim, { ignoreStation: true })).toEqual({ ok: true });
  });
});
