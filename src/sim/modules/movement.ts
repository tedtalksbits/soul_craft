import { Body, Dying, Motion, Player } from '../components';
import type { SimModule } from '../module';
import { moveBody } from '../physics';
import type { Simulation } from '../simulation';

/** Per-tick knockback decay. */
const KNOCKBACK_DRAG = 0.8;

function integrate(sim: Simulation): void {
  const { ecs } = sim;
  for (const [e, motion, body] of ecs.query(Motion, Body)) {
    if (ecs.has(e, Dying)) continue;
    const dx = motion.vx + motion.kx;
    const dy = motion.vy + motion.ky;
    if (sim.state.cheats.noclip && ecs.has(e, Player)) {
      body.x += dx;
      body.y += dy;
      motion.hitWall = false;
    } else {
      // Only the player gets corner assistance; enemies (the knight's charge) should still slam into walls.
      const slide = ecs.has(e, Player) ? sim.content.player.cornerSlide : 0;
      motion.hitWall = moveBody(sim.world, body, dx, dy, slide);
    }
    motion.kx *= KNOCKBACK_DRAG;
    motion.ky *= KNOCKBACK_DRAG;
    if (Math.abs(motion.kx) + Math.abs(motion.ky) < 0.05) motion.kx = motion.ky = 0;
  }
}

export const movementModule: SimModule = {
  id: 'movement',
  systems: [{ phase: 'physics', run: integrate }],
};
