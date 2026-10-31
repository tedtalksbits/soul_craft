import { describe, expect, it } from 'vitest';
import type { Entity } from '../../src/core/ecs';
import { Abilities, Body, Inventory, Npc } from '../../src/sim/components';
import { killEnemy } from '../../src/sim/modules/combat';
import { findInteraction } from '../../src/sim/modules/interaction';
import { countItem } from '../../src/sim/modules/items';
import { objectiveText, talkTo } from '../../src/sim/modules/objectives';
import { rebuild } from '../../src/sim/modules/restoration';
import type { Simulation } from '../../src/sim/simulation';
import { content, face, newSim, ofType, press, run, spawnNear } from '../helpers';

const objectives = content.objectives;
const maren = content.npcs['maren']!;

function marenEntity(sim: Simulation): Entity {
  const found = [...sim.ecs.query(Npc)].find(([, n]) => n.npc === 'maren');
  if (!found) throw new Error('Maren is not in the village');
  return found[0];
}

function talk(sim: Simulation) {
  talkTo(sim, marenEntity(sim));
  const events = sim.events.drain();
  const spoke = ofType(events, 'spoke');
  expect(spoke).toHaveLength(1);
  return { lines: spoke[0]!.lines, events };
}

/** Beats a shrine knight next to the player and lets the magnet bring in its oath. */
function bringOath(sim: Simulation) {
  sim.state.cheats.god = true;
  killEnemy(sim, spawnNear(sim, 'knight', 30, 0));
  run(sim, 180);
  expect(countItem(sim.ecs.need(sim.player, Inventory), 'relic_oath')).toBe(1);
}

describe('objectives', () => {
  it('a new game points the player to Maren, who stands by the village bonfire', () => {
    const sim = newSim();
    run(sim, 1);
    expect(objectiveText(sim)).toBe('Speak with Maren.');
    const mb = sim.ecs.need(marenEntity(sim), Body);
    const pb = sim.ecs.need(sim.player, Body);
    Object.assign(pb, { x: mb.x, y: mb.y + 10 });
    face(sim, 'up');
    expect(findInteraction(sim)?.label).toBe('Talk to Maren');
    const events = press(sim, ['use']);
    expect(ofType(events, 'spoke')[0]?.name).toBe('Maren');
  });

  it('Maren gives the oath, the HUD tracks it, and asking again gets a reminder', () => {
    const sim = newSim();
    run(sim, 1);
    const { lines, events } = talk(sim);
    expect(lines).toEqual(objectives['oath']!.lines);
    expect(ofType(events, 'objectiveStarted')).toEqual([{ type: 'objectiveStarted', objective: 'oath' }]);
    expect(objectiveText(sim)).toBe(objectives['oath']!.track);
    expect(talk(sim).lines).toEqual(objectives['oath']!.reminder);
  });

  it('bringing her the oath awakens the class ability and she asks for the keep next', () => {
    const sim = newSim();
    run(sim, 1);
    talk(sim);
    bringOath(sim);
    // Carrying it is not enough: nothing is awake until Maren takes it.
    expect(sim.ecs.need(sim.player, Abilities).unlocked.class).toBe(false);
    const { lines, events } = talk(sim);
    expect(lines).toEqual([...objectives['oath']!.doneLines, ...objectives['keep']!.lines]);
    expect(ofType(events, 'abilityUnlocked').map((e) => e.slot)).toEqual(['class']);
    expect(ofType(events, 'objectiveCompleted')).toEqual([{ type: 'objectiveCompleted', objective: 'oath' }]);
    expect(countItem(sim.ecs.need(sim.player, Inventory), 'relic_oath')).toBe(0);
    expect(sim.state.objectives).toEqual({ active: 'keep', done: { oath: true } });
    expect(objectiveText(sim)).toBe(objectives['keep']!.track);
  });

  it('an oath taken before she asks is handed over the first time the player speaks to her', () => {
    const sim = newSim();
    run(sim, 1);
    bringOath(sim);
    const { lines } = talk(sim);
    expect(lines).toEqual([
      ...objectives['oath']!.lines,
      ...objectives['oath']!.doneLines,
      ...objectives['keep']!.lines,
    ]);
    expect(sim.ecs.need(sim.player, Abilities).unlocked.class).toBe(true);
  });

  it('a goal met away from her shows "Return to Maren" until it is reported', () => {
    const sim = newSim();
    run(sim, 1);
    sim.state.objectives = { active: 'forge', done: { oath: true, keep: true } };
    rebuild(sim, 'smithy', { anywhere: true, free: true });
    expect(objectiveText(sim)).toBe('Return to Maren.');
    expect(talk(sim).lines).toEqual(objectives['forge']!.doneLines);
  });

  it('with the story told, the HUD line goes and Maren has only small talk', () => {
    const sim = newSim();
    run(sim, 1);
    sim.state.objectives = {
      active: null,
      done: Object.fromEntries(Object.keys(objectives).map((id) => [id, true])),
    };
    expect(objectiveText(sim)).toBeNull();
    expect(talk(sim).lines).toEqual(maren.idleLines);
  });

  it('bringing her what the Warden kept awakens the super, and she asks for the smithy', () => {
    const sim = newSim();
    run(sim, 1);
    sim.ecs.need(sim.player, Inventory).stacks.push({ item: 'relic_sovereign', count: 1, level: 0 });
    sim.state.objectives = { active: 'keep', done: { oath: true } };
    sim.ecs.need(sim.player, Abilities).unlocked.class = true;
    const { lines } = talk(sim);
    expect(lines).toEqual([...objectives['keep']!.doneLines, ...objectives['forge']!.lines]);
    expect(sim.ecs.need(sim.player, Abilities).unlocked.super).toBe(true);
  });
});
