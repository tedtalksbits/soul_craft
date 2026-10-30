/**
 * Boss fight visuals, mostly drawn above the darkness so they read at night: the fog
 * wall around the arena while the fight is on, the slam's danger circle growing
 * under a boss that is raising its weapon, the shield shimmering around a
 * shielded boss, and the bursts when a slam lands, a brazier lights or the
 * shield breaks. Purely cosmetic: sim state and events.
 */
import { Graphics } from 'pixi.js';
import type { Content } from '../../content/content';
import { Ai, Body, Boss, Enemy } from '../../sim/components';
import type { SimEvent } from '../../sim/events';
import type { Simulation } from '../../sim/simulation';
import type { Effects } from './effects';

const FOG = 0xb8b0a8;
const DANGER = 0xe05a4a;
const SHIELD = 0xffc070;
const FIRE = 0xff9a30;
const RING_MS = 380;

interface Ring {
  x: number;
  y: number;
  radius: number;
  ageMs: number;
}

export class BossFx {
  /**
   * The slam's warning fill, on the floor under the entities (in the world layer), so it never
   * covers the boss's raise: that pose is the tell.
   */
  readonly floor = new Graphics();
  /** The slam's warning outline, above the darkness. */
  readonly ground = new Graphics();
  /** The fog wall, the shield and landed slams, over the warning circle. */
  readonly air = new Graphics();
  private readonly rings: Ring[] = [];
  private clockMs = 0;

  constructor(private readonly effects: Effects) {}

  handle(e: SimEvent, content: Content | undefined): void {
    if (!content) return;
    switch (e.type) {
      case 'bossSlam':
        this.rings.push({ x: e.x, y: e.y, radius: e.radius, ageMs: 0 });
        this.effects.burst(e.x, e.y, {
          count: 28,
          color: 0x6a6258,
          speed: 2,
          size: 2,
          life: 40,
          z: 2,
          vz: 0.8,
          grav: 0.05,
        });
        this.effects.burst(e.x, e.y, {
          count: 16,
          color: FIRE,
          speed: 1.6,
          life: 26,
          add: true,
          z: 3,
          vz: 0.6,
          grav: 0.05,
        });
        this.effects.shake = Math.min(10, this.effects.shake + 6);
        return;
      case 'brazierLit':
        this.effects.burst(e.x, e.y - 6, {
          count: 18,
          color: FIRE,
          speed: 1,
          life: 34,
          add: true,
          z: 6,
          vz: 1,
          grav: 0,
        });
        return;
      case 'bossShieldBroken':
        this.effects.shake = Math.min(10, this.effects.shake + 7);
        return;
      default:
        return;
    }
  }

  clear(): void {
    this.rings.length = 0;
    this.floor.clear();
    this.ground.clear();
    this.air.clear();
  }

  update(sim: Simulation, dtMs: number): void {
    this.clockMs += dtMs;
    const floor = this.floor.clear();
    const g = this.ground.clear();
    const air = this.air.clear();

    const fight = sim.state.bossFight;
    if (fight) {
      // The fog wall: a wavering pale border just outside the arena's edge.
      const pulse = 0.35 + 0.1 * Math.sin(this.clockMs / 300);
      const x0 = fight.x - fight.half;
      const y0 = fight.y - fight.half;
      const size = fight.half * 2;
      air.rect(x0 - 2, y0 - 2, size + 4, size + 4).stroke({ color: FOG, alpha: pulse, width: 3 });
      air.rect(x0 - 5, y0 - 5, size + 10, size + 10).stroke({ color: FOG, alpha: pulse * 0.4, width: 3 });
    }

    for (const [, boss, enemy, ai, body] of sim.ecs.query(Boss, Enemy, Ai, Body)) {
      const brain = sim.content.enemies[enemy.archetype]?.brain;
      if (brain?.type === 'warden' && ai.state === 'raise') {
        // The danger circle fills in as the weapon rises: out of it before it is full.
        const t = Math.min(1, ai.t / brain.slamWindupTicks);
        const r = brain.slamRadius;
        g.ellipse(body.x, body.y, r, r * 0.7).stroke({ color: DANGER, alpha: 0.7, width: 1 });
        floor.ellipse(body.x, body.y, r * t, r * 0.7 * t).fill({ color: DANGER, alpha: 0.3 + 0.2 * t });
      }
      if (boss.shielded) {
        const shimmer = 0.35 + 0.15 * Math.sin(this.clockMs / 120);
        air
          .ellipse(body.x, body.y - 10, body.w * 0.9, body.h * 1.4)
          .stroke({ color: SHIELD, alpha: shimmer, width: 1 });
        air
          .ellipse(body.x, body.y - 10, body.w * 0.9, body.h * 1.4)
          .fill({ color: SHIELD, alpha: shimmer * 0.15 });
      }
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const ring = this.rings[i]!;
      ring.ageMs += dtMs;
      const t = ring.ageMs / RING_MS;
      if (t >= 1) {
        this.rings.splice(i, 1);
        continue;
      }
      const r = ring.radius * (0.4 + 0.6 * t);
      air.ellipse(ring.x, ring.y, r, r * 0.7).stroke({ color: FIRE, alpha: 1 - t, width: 2 });
    }
  }
}
