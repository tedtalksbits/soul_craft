/**
 * Placeholder village restoration sites (32x32, feet at the bottom): each project as a
 * ruin (row 0) and rebuilt (row 1). Frame names match `sprite` in content/restoration.json.
 */
import type { SpriteSheetFile } from '../../src/content/sprite-sheet';
import { hex, Sheet, type Surface } from './pixel-canvas';

const SHADOW = hex('#000000', 90);
const STONE = hex('#7a7570');
const STONE_DARK = hex('#4e4a46');
const WOOD = hex('#7a5a3a');
const WOOD_DARK = hex('#4a3626');
const ASH = hex('#5a5550');
const EMBER = hex('#ff7a30');
const GLOW = hex('#ffd080');

const PROJECTS = ['well', 'storehouse', 'palisade', 'lamps', 'smithy'] as const;
type ProjectArt = (typeof PROJECTS)[number];

function rubble(s: Surface, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++)
    s.rect(x + ((i * 5) % 13), y + ((i * 3) % 4), 2 + (i % 2), 2, i % 2 ? STONE : STONE_DARK);
}

function planks(s: Surface, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++)
    s.line(x + i * 3, y + (i % 2) * 2, x + i * 3 + 6, y + 3 - (i % 2) * 2, i % 2 ? WOOD : WOOD_DARK);
}

const RUIN: Record<ProjectArt, (s: Surface) => void> = {
  well: (s) => {
    s.ellipse(16, 28, 9, 3, SHADOW);
    s.rect(8, 22, 5, 5, STONE_DARK);
    s.rect(19, 23, 5, 4, STONE);
    rubble(s, 9, 26, 5);
  },
  storehouse: (s) => {
    s.ellipse(16, 28, 13, 3, SHADOW);
    s.rect(4, 18, 3, 10, WOOD_DARK);
    s.rect(24, 21, 3, 7, WOOD_DARK);
    planks(s, 5, 24, 6);
  },
  palisade: (s) => {
    s.ellipse(16, 29, 14, 2, SHADOW);
    [3, 9, 20, 27].forEach((x, i) => s.rect(x, 22 + (i % 2) * 3, 3, 7 - (i % 2) * 3, WOOD_DARK));
    planks(s, 8, 26, 5);
  },
  lamps: (s) => {
    s.ellipse(16, 29, 8, 2, SHADOW);
    s.rect(14, 24, 3, 5, WOOD_DARK);
    s.line(9, 28, 22, 26, WOOD);
    s.rect(22, 25, 3, 3, STONE_DARK);
  },
  smithy: (s) => {
    s.ellipse(16, 28, 13, 3, SHADOW);
    s.rect(4, 16, 8, 12, STONE_DARK);
    s.rect(5, 14, 5, 3, STONE);
    s.rect(17, 23, 9, 3, hex('#3a3a3e'));
    s.rect(19, 26, 5, 2, hex('#2a2a2e'));
    rubble(s, 12, 25, 4);
    s.rect(6, 22, 4, 3, ASH);
  },
};

const RESTORED: Record<ProjectArt, (s: Surface) => void> = {
  well: (s) => {
    s.ellipse(16, 28, 10, 3, SHADOW);
    s.ellipse(16, 24, 9, 4, STONE);
    s.ellipse(16, 23, 6, 2.5, hex('#3a6a8a'));
    s.rect(6, 12, 2, 13, WOOD);
    s.rect(24, 12, 2, 13, WOOD);
    s.rect(5, 10, 22, 3, WOOD_DARK);
    s.rect(15, 13, 1, 7, hex('#c8b890'));
  },
  storehouse: (s) => {
    s.ellipse(16, 28, 14, 3, SHADOW);
    s.rect(4, 14, 24, 14, WOOD);
    for (let x = 4; x < 28; x += 4) s.rect(x, 14, 1, 14, WOOD_DARK);
    s.rect(2, 9, 28, 6, hex('#6a3a2a'));
    s.rect(13, 20, 6, 8, WOOD_DARK);
  },
  palisade: (s) => {
    s.ellipse(16, 29, 15, 2, SHADOW);
    for (let x = 1; x < 31; x += 4) {
      s.rect(x, 12, 3, 17, WOOD);
      s.rect(x + 1, 10, 1, 2, WOOD);
    }
    s.rect(1, 17, 30, 2, WOOD_DARK);
    s.rect(1, 24, 30, 2, WOOD_DARK);
  },
  lamps: (s) => {
    s.ellipse(16, 29, 6, 2, SHADOW);
    s.rect(15, 8, 2, 21, WOOD_DARK);
    s.rect(15, 8, 7, 2, WOOD_DARK);
    s.rect(19, 10, 5, 6, hex('#3a3a3e'));
    s.rect(20, 11, 3, 4, GLOW);
  },
  smithy: (s) => {
    s.ellipse(16, 28, 14, 3, SHADOW);
    s.rect(3, 12, 11, 16, STONE);
    s.rect(4, 4, 6, 9, STONE_DARK);
    s.rect(5, 20, 7, 5, EMBER);
    s.rect(7, 21, 3, 2, GLOW);
    s.rect(17, 21, 10, 3, hex('#5f646b'));
    s.rect(20, 24, 4, 4, hex('#41454b'));
    s.rect(14, 9, 16, 3, WOOD_DARK);
    s.rect(28, 12, 2, 16, WOOD_DARK);
  },
};

export function buildVillage(): { png: Buffer; json: SpriteSheetFile } {
  const sheet = new Sheet(32 * PROJECTS.length, 64);
  const frames: Record<string, number> = {};
  PROJECTS.forEach((id, i) => {
    RUIN[id](sheet.frame(i, 32, 32));
    RESTORED[id](sheet.frame(PROJECTS.length + i, 32, 32));
    frames[`${id}_ruin`] = i;
    frames[id] = PROJECTS.length + i;
  });
  return {
    png: sheet.toPNG(),
    json: { image: 'village.png', frameWidth: 32, frameHeight: 32, anchor: [0.5, 1], frames, animations: {} },
  };
}
