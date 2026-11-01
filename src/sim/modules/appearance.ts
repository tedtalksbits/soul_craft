import { AppearanceSchema } from '../../content/appearance';
import { Appearance } from '../components';
import type { SimModule } from '../module';

/** Cosmetic only, but still travels through deterministic input and per-character saves. */
export const appearanceModule: SimModule = {
  id: 'appearance',
  systems: [
    {
      phase: 'control',
      menu: true,
      run: (sim) => {
        for (const action of sim.input.actions ?? []) {
          if (action.type !== 'appearance') continue;
          const result = AppearanceSchema.safeParse(action.appearance);
          if (result.success) sim.ecs.add(sim.player, Appearance, result.data);
        }
      },
    },
  ],
};
