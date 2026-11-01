import { describe, expect, it } from 'vitest';
import { DEFAULT_APPEARANCE, type AppearanceDef } from '../../src/content/appearance';
import { Appearance, Player } from '../../src/sim/components';
import { inputFrame } from '../../src/sim/input';
import { playerStats } from '../../src/sim/modules/items';
import { Simulation } from '../../src/sim/simulation';
import { createSave, parseSave, SAVE_VERSION } from '../../src/save/format';
import { content, newSim } from '../helpers';

describe('character appearance', () => {
  it('changes cosmetics through menu input while the world remains paused, without changing stats', () => {
    const sim = newSim();
    const before = playerStats(sim, sim.player);
    const appearance: AppearanceDef = {
      ...DEFAULT_APPEARANCE,
      skin: 'deep',
      hair: 'swept',
      hairColor: 'silver',
      beard: true,
      hideHelmet: true,
    };
    const stateTime = sim.ecs.need(sim.player, Player).t;
    sim.step(inputFrame({ menu: true, actions: [{ type: 'appearance', appearance }] }));
    expect(sim.ecs.need(sim.player, Appearance)).toEqual(appearance);
    expect(sim.ecs.need(sim.player, Player).t).toBe(stateTime);
    expect(playerStats(sim, sim.player)).toEqual(before);
    const restored = Simulation.restore(parseSave(createSave(sim, '1')).snapshot, content);
    expect(restored.ecs.need(restored.player, Appearance)).toEqual(appearance);
  });

  it('migrates gear-era saves without changing their input or gear', () => {
    const sim = newSim();
    const save = createSave(sim, '1');
    save.version = 15;
    delete save.snapshot.ecs.components['appearance'];
    const before = JSON.stringify(save);
    const loaded = parseSave(save);
    expect(loaded.version).toBe(SAVE_VERSION);
    const restored = Simulation.restore(loaded.snapshot, content);
    expect(restored.ecs.need(restored.player, Appearance)).toEqual(DEFAULT_APPEARANCE);
    expect(JSON.stringify(save)).toBe(before);
  });
});
