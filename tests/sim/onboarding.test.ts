import { describe, expect, it } from 'vitest';
import { gearSlotOf } from '../../src/content/content';
import type { Entity } from '../../src/core/ecs';
import { Body, Enemy, Inventory, Npc, Pickup } from '../../src/sim/components';
import { CHUNK, TILE } from '../../src/sim/constants';
import { killEnemy } from '../../src/sim/modules/combat';
import { resetEnemies } from '../../src/sim/modules/streaming';
import { addItem, countItem } from '../../src/sim/modules/items';
import { objectiveText, talkTo } from '../../src/sim/modules/objectives';
import type { Simulation } from '../../src/sim/simulation';
import { content, newSim, ofType, run, spawnNear } from '../helpers';

const camp = content.objectives['road_camp']!;

function talk(sim: Simulation) {
  const maren = [...sim.ecs.query(Npc)].find(([, n]) => n.npc === 'maren')![0];
  talkTo(sim, maren);
  return sim.events.drain();
}

/** A new game in which Maren has just sent the player to the Road Camp. */
function onErrand(): Simulation {
  const sim = newSim();
  run(sim, 1);
  talk(sim);
  return sim;
}

const kill = (sim: Simulation, archetype: string, n = 1) => {
  for (let i = 0; i < n; i++) killEnemy(sim, spawnNear(sim, archetype, 40 + i * 4, 0));
  sim.events.drain();
};
const inv = (sim: Simulation) => sim.ecs.need(sim.player, Inventory);

describe('the Road Camp', () => {
  it('is Maren’s first errand, its steps shown together on the HUD', () => {
    const sim = newSim();
    run(sim, 1);
    const events = talk(sim);
    expect(ofType(events, 'objectiveStarted')[0]?.objective).toBe('road_camp');
    expect(objectiveText(sim)).toBe(
      [
        camp.track,
        '· Clear the camp: 0/5 Hollows, 0/3 Fungal Slimes',
        '· Defeat Grub',
        '· Gather fungal caps: 0/20 Fungal Caps',
      ].join('\n'),
    );
  });

  it('counts kills from the moment it is given, and ticks a step off once met', () => {
    const sim = newSim();
    run(sim, 1);
    kill(sim, 'hollow', 2);
    talk(sim);
    expect(objectiveText(sim)).toContain('0/5 Hollows');
    kill(sim, 'hollow', 5);
    kill(sim, 'slime', 2);
    expect(objectiveText(sim)).toContain('Clear the camp: 5/5 Hollows, 2/3 Fungal Slimes');
    kill(sim, 'slime');
    expect(objectiveText(sim)).toContain('✓ Clear the camp');
  });

  it('Grub is a boss who always drops a Standard helmet', () => {
    const sim = onErrand();
    const grub: Entity = spawnNear(sim, 'grub', 40, 0);
    killEnemy(sim, grub);
    const events = sim.events.drain();
    expect(ofType(events, 'bossDefeated')[0]?.boss).toBe('grub');
    const helmet = [...sim.ecs.query(Pickup)].map(([, p]) => p).find((p) => p.gear);
    expect(helmet?.gear?.tier).toBe('standard');
    expect(gearSlotOf(content.item(helmet!.item!))).toBe('helmet');
    expect(objectiveText(sim)).toContain('✓ Defeat Grub');
  });

  it('reported done, Maren takes the caps, brews bandages and asks for the oath', () => {
    const sim = onErrand();
    kill(sim, 'hollow', 5);
    kill(sim, 'slime', 3);
    killEnemy(sim, spawnNear(sim, 'grub', 40, 0));
    addItem(sim, sim.player, 'fungal_cap', 23);
    expect(objectiveText(sim)).toBe('Return to Maren.');
    const bandages = countItem(inv(sim), 'field_bandage');
    const events = talk(sim);
    expect(ofType(events, 'objectiveCompleted')[0]?.objective).toBe('road_camp');
    expect(countItem(inv(sim), 'fungal_cap')).toBe(3);
    expect(countItem(inv(sim), 'field_bandage')).toBe(bandages + 5);
    expect(sim.state.objectives.active).toBe('oath');
    expect(sim.state.objectives.kills).toBeUndefined();
  });

  it('is not done while the caps are short', () => {
    const sim = onErrand();
    kill(sim, 'hollow', 5);
    kill(sim, 'slime', 3);
    killEnemy(sim, spawnNear(sim, 'grub', 40, 0));
    addItem(sim, sim.player, 'fungal_cap', 19);
    expect(ofType(talk(sim), 'spoke')[0]?.lines).toEqual(camp.reminder);
    expect(countItem(inv(sim), 'fungal_cap')).toBe(19);
  });

  it('keeps Grub in his camp even once the palisade wards the village', () => {
    const sim = newSim();
    sim.state.restored['palisade'] = true;
    sim.state.projectRanks = { palisade: content.restoration['palisade']!.ranks.length + 1 };
    const placed = sim.world.gen.fixedPlacements().find((p) => p.prefabId === 'road_camp')!;
    Object.assign(sim.ecs.need(sim.player, Body), { x: (placed.x0 + 12) * TILE, y: (placed.y0 + 16) * TILE });
    run(sim, 2);
    resetEnemies(sim);
    const here = [...sim.ecs.query(Enemy, Body)].filter(
      ([, , b]) => Math.hypot(b.x / TILE - (placed.x0 + 12), b.y / TILE - (placed.y0 + 8)) < 14,
    );
    expect(here.map(([, e]) => e.archetype)).toEqual(['grub']);
  });

  it('leaves the Warden in its keep when Grub’s fight starts with the keep still loaded', () => {
    const sim = newSim();
    const fixed = sim.world.gen.fixedPlacements();
    const camp = fixed.find((p) => p.prefabId === 'road_camp')!;
    const keep = fixed.find((p) => p.prefabId === 'warden_arena')!;
    const pb = sim.ecs.need(sim.player, Body);
    Object.assign(pb, { x: (keep.x0 + 12) * TILE, y: (keep.y0 + keep.h + 6) * TILE });
    run(sim, 2);
    const warden = () => [...sim.ecs.query(Enemy, Body)].find(([, e]) => e.archetype === 'ashen_warden')![2];
    const home = { x: warden().x, y: warden().y };
    Object.assign(pb, { x: (camp.x0 + 14) * TILE, y: (camp.y0 + 7) * TILE });
    run(sim, 2);
    expect(sim.state.bossFight?.boss).toBe('grub');
    expect({ x: warden().x, y: warden().y }).toEqual(home);
  });

  it('sits west of the village on the old road, inside its region, with the camp to clear', () => {
    const sim = newSim();
    const placed = sim.world.gen.fixedPlacements().find((p) => p.prefabId === 'road_camp')!;
    const fixed = content.world.fixed.find((f) => f.prefab === 'road_camp')!;
    const span = content.world.regions.sizeChunks * CHUNK;
    expect(placed.x0).toBeGreaterThanOrEqual(fixed.region[0] * span);
    expect(placed.y0).toBeGreaterThanOrEqual(fixed.region[1] * span);
    expect(placed.x0 + placed.w).toBeLessThanOrEqual((fixed.region[0] + 1) * span);
    expect(placed.y0 + placed.h).toBeLessThanOrEqual((fixed.region[1] + 1) * span);
    // Its road runs on the row the village's west road leaves by.
    expect(placed.y0 + placed.h - 1).toBe(-1);
    const spawns: Record<string, number> = {};
    for (const row of placed.prefab.rows)
      for (const ch of row) {
        const ent = placed.prefab.legend[ch]?.entity;
        if (ent?.kind === 'enemy') spawns[ent.archetype] = (spawns[ent.archetype] ?? 0) + 1;
      }
    expect(spawns).toEqual({ hollow: 5, slime: 3, grub: 1 });
  });
});
