import type { Assets } from '../assets';
import type { Simulation } from '../../sim/simulation';
import { playerLayerSpecs, playerLook } from '../render/player-appearance';
import type { Dir8 } from '../render/facing';
import { h } from './dom';
import { iconElement, tintedIcon } from './icons';

export function characterPreview(
  assets: Assets,
  sim: Simulation | null,
  direction: Dir8 = 'down',
): HTMLElement {
  const root = h('div', { class: 'character-preview', role: 'img', ariaLabel: 'Equipped character preview' });
  if (!sim) return root;
  const look = playerLook(sim);
  const scale = look.appearance.prototype ? 1.5 : 3;
  for (const [layer, tint] of playerLayerSpecs(playerLook(sim))) {
    const rect = assets.sheet(`${look.sheetPrefix}_${layer}`)?.animFrameRect(`idle_${direction}`);
    const icon =
      tint === 0xffffff
        ? iconElement(rect, scale)
        : tintedIcon(rect, `#${tint.toString(16).padStart(6, '0')}`, scale);
    root.append(icon);
  }
  return root;
}
