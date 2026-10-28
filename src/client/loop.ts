import { TICK_RATE } from '../sim/constants';

const STEP_MS = 1000 / TICK_RATE;
/** Never simulate more than this many ticks per frame (avoids a death spiral after a stall). */
const MAX_STEPS_PER_FRAME = 6;

/**
 * Fixed-timestep driver: ticks at TICK_RATE regardless of display refresh,
 * renders once per animation frame. Supports pause, single-stepping and time
 * scaling for debugging.
 */
export class FixedLoop {
  timeScale = 1;
  paused = false;
  private pendingSteps = 0;
  private acc = 0;
  private last = 0;
  private running = false;

  constructor(
    private readonly tick: () => void,
    private readonly render: (dtMs: number) => void,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const dt = Math.min(250, now - this.last);
      this.last = now;
      if (this.paused) {
        for (; this.pendingSteps > 0; this.pendingSteps--) this.tick();
      } else {
        this.acc += dt * this.timeScale;
        let steps = 0;
        while (this.acc >= STEP_MS && steps < MAX_STEPS_PER_FRAME) {
          this.acc -= STEP_MS;
          steps++;
          this.tick();
        }
        if (steps === MAX_STEPS_PER_FRAME) this.acc = 0;
      }
      this.render(dt);
    };
    requestAnimationFrame(frame);
  }

  /** Advance `n` ticks while paused. */
  step(n = 1): void {
    this.pendingSteps += n;
  }
}
