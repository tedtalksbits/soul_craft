import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../src/core/commands';
import { Ai, Body, Health, Player, Stamina } from '../../src/sim/components';
import { TILE } from '../../src/sim/constants';
import { applyDamage } from '../../src/sim/modules/combat';
import { spawnProjectile } from '../../src/sim/modules/projectiles';
import { content, face, newSim, ofType, press, run, spawnNear } from '../helpers';

describe('player melee', () => {
  it('kills a slime in a few swings and banks its souls', () => {
    const sim = newSim();
    sim.state.cheats.god = true;
    face(sim, 'right');
    const slime = spawnNear(sim, 'slime', 14, 0);
    const events = [];
    for (let i = 0; i < 5 && sim.ecs.isAlive(slime); i++) events.push(...press(sim, ['attack'], 20));

    const hits = ofType(events, 'damaged').filter((e) => e.target === slime);
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const h of hits) expect(h.amount).toBeGreaterThanOrEqual(h.crit ? 15 : 10);
    expect(ofType(events, 'killed')).toHaveLength(1);
    expect(sim.ecs.need(sim.player, Player).souls).toBe(content.enemies.slime!.souls);
  });

  it('hits each target once per swing', () => {
    const sim = newSim();
    face(sim, 'right');
    const hollow = spawnNear(sim, 'hollow', 14, 0);
    const events = press(sim, ['attack'], 20);
    expect(ofType(events, 'damaged').filter((e) => e.target === hollow)).toHaveLength(1);
  });

  it('is gated by stamina', () => {
    const sim = newSim();
    sim.ecs.need(sim.player, Stamina).value = 0;
    sim.ecs.need(sim.player, Stamina).delay = 100;
    expect(ofType(press(sim, ['attack'], 2), 'swing')).toHaveLength(0);
  });

  it('buffers an attack pressed during the previous swing', () => {
    const sim = newSim();
    press(sim, ['attack'], 10);
    const events = press(sim, ['attack'], 30);
    expect(ofType(events, 'swing')).toHaveLength(1);
  });

  it('cuts tall grass in front of the player', () => {
    const sim = newSim();
    face(sim, 'right');
    const pb = sim.ecs.need(sim.player, Body);
    const tx = Math.floor((pb.x + 16) / TILE);
    const ty = Math.floor(pb.y / TILE);
    sim.world.setTile(tx, ty, 'tall_grass');
    const events = press(sim, ['attack'], 20);
    expect(ofType(events, 'tileCut').length).toBeGreaterThanOrEqual(1);
    expect(sim.world.tileAt(tx, ty)?.id).toBe('grass');
  });
});

describe('enemy defenses', () => {
  it('a shield knight blocks unless stunned', () => {
    const sim = newSim();
    face(sim, 'right');
    // Just outside the knight's 18 px wide body, so contact damage does not cancel the swing.
    const knight = spawnNear(sim, 'knight', 18, 0);
    const hp = sim.ecs.need(knight, Health).hp;
    const blocked = press(sim, ['attack'], 20);
    expect(ofType(blocked, 'blocked')).toHaveLength(1);
    expect(sim.ecs.need(knight, Health).hp).toBe(hp);

    const kb = sim.ecs.need(knight, Body);
    Object.assign(sim.ecs.need(sim.player, Body), { x: kb.x - 18, y: kb.y });
    sim.ecs.need(knight, Ai).state = 'stunned';
    sim.ecs.need(knight, Ai).t = 0;
    const hit = press(sim, ['attack'], 12);
    expect(ofType(hit, 'damaged').some((e) => e.target === knight)).toBe(true);
  });
});

describe('player defense', () => {
  it('rolling grants invulnerability frames', () => {
    const sim = newSim();
    press(sim, ['roll'], 4, [1, 0]);
    const pb = sim.ecs.need(sim.player, Body);
    const hit = { amount: 10, crit: false, fromX: pb.x - 10, fromY: pb.y, knockback: 0 };
    expect(applyDamage(sim, sim.player, hit)).toBe('ignored');
    run(sim, 30);
    expect(applyDamage(sim, sim.player, hit)).toBe('hit');
  });

  it('a ready shield turns arrows from the front but not from behind', () => {
    const sim = newSim();
    const pb = sim.ecs.need(sim.player, Body);
    const health = sim.ecs.need(sim.player, Health);
    face(sim, 'left');
    spawnProjectile(sim, {
      kind: 'arrow',
      team: 'enemy',
      x: pb.x - 30,
      y: pb.y,
      dirX: 1,
      dirY: 0,
      speed: 2.3,
      damage: 10,
    });
    expect(ofType(run(sim, 20), 'blocked')).toHaveLength(1);
    expect(health.hp).toBe(health.max);

    face(sim, 'right');
    spawnProjectile(sim, {
      kind: 'arrow',
      team: 'enemy',
      x: pb.x - 30,
      y: pb.y,
      dirX: 1,
      dirY: 0,
      speed: 2.3,
      damage: 10,
    });
    run(sim, 20);
    expect(health.hp).toBe(health.max - 10);
  });

  it('drinking a flask heals and spends a charge', () => {
    const sim = newSim();
    const health = sim.ecs.need(sim.player, Health);
    health.hp = 20;
    const before = sim.ecs.need(sim.player, Player).flasks;
    const events = press(sim, ['heal'], content.player.flask.duration);
    expect(ofType(events, 'healed')[0]?.amount).toBe(content.player.flask.heal);
    expect(health.hp).toBe(20 + content.player.flask.heal);
    expect(sim.ecs.need(sim.player, Player).flasks).toBe(before - 1);
  });
});

describe('death and respawn', () => {
  it('drops half the souls and returns the player to their last bonfire', async () => {
    const sim = newSim();
    const registry = new CommandRegistry<{ sim: typeof sim }>().register(...sim.commands);
    await registry.execute({ sim }, 'rest');
    run(sim, 2, { moveX: 1, moveY: 0, aim: null, pressed: 0, held: 0 });
    const checkpoint = sim.state.checkpoint!;
    expect(checkpoint.id).toBe('ashen_village@origin#15,11');

    const player = sim.ecs.need(sim.player, Player);
    player.souls = 101;
    await registry.execute({ sim }, 'tp 10 10');
    run(sim, 1);
    await registry.execute({ sim }, 'kill');
    const died = ofType(sim.events.drain(), 'playerDied');
    expect(died[0]?.soulsLost).toBe(50);
    expect(player.souls).toBe(51);

    const events = run(sim, content.player.death.respawnDelay + 2);
    expect(ofType(events, 'playerRespawned')).toHaveLength(1);
    const pb = sim.ecs.need(sim.player, Body);
    expect(Math.abs(pb.x - checkpoint.x)).toBeLessThan(2);
    expect(sim.ecs.need(sim.player, Health).hp).toBe(content.player.maxHp);
  });
});
