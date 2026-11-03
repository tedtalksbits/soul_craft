import { describe, expect, it } from 'vitest';
import { Body, Equipment, Inventory, Player, Projectile, Toolbelt } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { Action, inputFrame, NO_INPUT } from '../../src/sim/input';
import { durabilityLeft, toolbelt } from '../../src/sim/modules/tools';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, run, spawnNear } from '../helpers';

/** A tile right in front of the player, who faces it. */
function tileAhead(sim: Simulation, tile: string): [number, number] {
  face(sim, 'right');
  const pb = sim.ecs.need(sim.player, Body);
  const at: [number, number] = [Math.floor((pb.x + 12) / TILE), Math.floor(pb.y / TILE)];
  sim.world.setTile(at[0], at[1], tile);
  return at;
}

const swing = (sim: Simulation) =>
  run(sim, 1, { ...NO_INPUT, pressed: Action.attack }).concat(
    run(sim, content.player.toolSwing.duration + 4),
  );

describe('the tool belt', () => {
  it('a new game starts with a crude axe and pickaxe on it', () => {
    const belt = toolbelt(newSim());
    expect([belt.axe?.item, belt.pick?.item]).toEqual(content.player.start.tools);
  });

  it('a player from before tools (an older save) is given the starting ones', () => {
    const sim = newSim();
    sim.ecs.remove(sim.player, Toolbelt);
    run(sim, 1);
    expect(sim.ecs.get(sim.player, Toolbelt)?.axe?.item).toBe(content.player.start.tools[0]);
  });

  it('attacking a tree swings the axe instead of the weapon, a hit a swing, wearing it down', () => {
    const sim = newSim();
    const [tx, ty] = tileAhead(sim, 'tree');
    const axe = toolbelt(sim).axe!;
    const fresh = durabilityLeft(sim, axe);
    const first = swing(sim);
    expect(ofType(first, 'tileHit').map((e) => e.hitsLeft)).toEqual([2]);
    expect(durabilityLeft(sim, axe)).toBe(fresh - 1);
    swing(sim);
    swing(sim);
    expect(sim.world.tileAt(tx, ty)?.id).not.toBe('tree');
  });

  it('works whatever weapon is held: a bow facing a tree swings the axe, no arrow', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Equipment).weapon = { item: 'ashwood_bow', count: 1, level: 0 };
    tileAhead(sim, 'tree');
    const events = run(sim, 1, { ...NO_INPUT, pressed: Action.attack });
    expect(sim.ecs.need(sim.player, Player).state).toBe('gather');
    events.push(...run(sim, 30));
    expect(ofType(events, 'tileHit')).toHaveLength(1);
    expect([...sim.ecs.query(Projectile)]).toEqual([]);
  });

  it('a foe in front gets the weapon, not the tool', () => {
    const sim = newSim();
    sim.state.cheats.god = true;
    tileAhead(sim, 'tree');
    spawnNear(sim, 'hollow', 10, 0);
    run(sim, 1, { ...NO_INPUT, pressed: Action.attack });
    expect(sim.ecs.need(sim.player, Player).state).toBe('attack');
  });

  it('weapons never fell trees: with no axe, a blow only says one is needed', () => {
    const sim = newSim();
    toolbelt(sim).axe = null;
    const [tx, ty] = tileAhead(sim, 'tree');
    const events = swing(sim);
    expect(sim.ecs.need(sim.player, Player).state).not.toBe('gather');
    expect(ofType(events, 'tileHit')).toEqual([]);
    expect(ofType(events, 'needsTool')[0]?.kind).toBe('axe');
    expect(sim.world.tileAt(tx, ty)?.id).toBe('tree');
  });

  it('a worn-out tool breaks and leaves the belt', () => {
    const sim = newSim();
    tileAhead(sim, 'tree');
    toolbelt(sim).axe!.durability = 1;
    const events = swing(sim);
    expect(ofType(events, 'toolBroke')).toEqual([{ type: 'toolBroke', item: 'crude_axe' }]);
    expect(toolbelt(sim).axe).toBeNull();
  });

  it('a tool in the pack goes on the belt, and the one there comes off into the pack', () => {
    const sim = newSim();
    const inv = sim.ecs.need(sim.player, Inventory);
    inv.stacks.push({ item: 'iron_axe', count: 1, level: 0 });
    run(sim, 1, inputFrame({ menu: true, actions: [{ type: 'equip', index: inv.stacks.length - 1 }] }));
    expect(toolbelt(sim).axe?.item).toBe('iron_axe');
    expect(inv.stacks.some((s) => s.item === 'crude_axe')).toBe(true);
    expect(sim.ecs.need(sim.player, Equipment).weapon?.item).toBe('chipped_sword');
    run(sim, 1, inputFrame({ menu: true, actions: [{ type: 'unequipTool', kind: 'axe' }] }));
    expect(toolbelt(sim).axe).toBeNull();
  });
});
