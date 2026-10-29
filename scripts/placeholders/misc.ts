/** Placeholder slime, props (bonfire, torch, sign, pickups) and the bitmap digit font. */
import type { SpriteSheetFile } from '../../src/content/sprite-sheet';
import { hex, Sheet, type Surface } from './pixel-canvas';

const SHADOW = hex('#000000', 90);

// ------------------------------------------------------------------ slime (16x16)

function drawSlime(s: Surface, squish: number, hop: number, flash: boolean): void {
  s.ellipse(8, 14.5, 6, 2, SHADOW);
  const y = 11 - hop;
  s.ellipse(8, y, 6 * squish, 5 / squish, flash ? hex('#e8fff0') : hex('#4a8a6a'));
  s.rect(5, y - 3, 2, 1, hex('#8ad8a8'));
  s.rect(9, y - 5, 2, 2, hex('#c49aff'));
  s.rect(6, y - 6, 1, 2, hex('#c49aff'));
  s.rect(6, y - 1, 1, 1, hex('#102018'));
  s.rect(10, y - 1, 1, 1, hex('#102018'));
}

export function buildSlime(): { png: Buffer; json: SpriteSheetFile } {
  const sheet = new Sheet(64, 48);
  const squish = [1, 1.08, 1, 0.92];
  squish.forEach((k, i) => drawSlime(sheet.frame(i, 16, 16), k, 0, false));
  [0.85, 1, 1.05, 1.1].forEach((k, i) =>
    drawSlime(sheet.frame(4 + i, 16, 16), k, [2, 5, 5, 2][i] ?? 0, false),
  );
  drawSlime(sheet.frame(8, 16, 16), 1.15, 0, true);
  return {
    png: sheet.toPNG(),
    json: {
      image: 'slime.png',
      frameWidth: 16,
      frameHeight: 16,
      anchor: [0.5, 1],
      frames: {},
      animations: {
        idle: { frames: [0, 1, 2, 3], fps: 4, loop: true },
        hop: { frames: [4, 5, 6, 7], fps: 8, loop: false },
        hurt: { frames: [8], fps: 1, loop: false },
      },
    },
  };
}

// ------------------------------------------------------------------ props (16x24)

function flame(s: Surface, x: number, y: number, k: number, size: number): void {
  s.rect(x - 2 * size, y - 4 * size * k, 4 * size, 4 * size * k, hex('#ff6a10'));
  s.rect(x - size, y - 5 * size * k, 2 * size, 4 * size * k, hex('#ffb040'));
  s.rect(x - 0.5 * size, y - 2 * size, size, 2 * size, hex('#fff0b0'));
}

function bonfireBase(s: Surface): void {
  s.rect(1, 21, 14, 3, hex('#3a3532'));
  for (let i = 2; i <= 14; i += 3) s.rect(i, 20, 2, 2, hex('#6a625a'));
  s.rect(8, 6, 1, 14, hex('#8a7a6a'));
  s.rect(6, 7, 5, 1, hex('#8a7a6a'));
}

export function buildProps(): { png: Buffer; json: SpriteSheetFile } {
  const sheet = new Sheet(64, 120);
  const f = (i: number) => sheet.frame(i, 16, 24);
  // row 0: unlit bonfire, sign
  bonfireBase(f(0));
  f(0).rect(5, 19, 6, 2, hex('#4a2a18'));
  const sign = f(1);
  sign.rect(7, 14, 2, 10, hex('#4a3626'));
  sign.rect(2, 8, 12, 7, hex('#7a5a3a'));
  sign.rect(3, 10, 10, 1, hex('#4a3626'));
  sign.rect(3, 12, 7, 1, hex('#4a3626'));
  // row 1: lit bonfire
  [1, 0.85, 0.95, 0.8].forEach((k, i) => {
    bonfireBase(f(4 + i));
    flame(f(4 + i), 8, 21, k, 2);
  });
  // row 2: torch
  [1, 0.85, 0.95, 0.8].forEach((k, i) => {
    f(8 + i).rect(7, 16, 2, 8, hex('#3a2a1e'));
    flame(f(8 + i), 8, 16, k, 1);
  });
  // row 3: souls wisp x2, ember x2
  [0, 1].forEach((i) => {
    const s = f(12 + i);
    s.rect(7, 19 - i, 3, 3, hex('#e8f0ff'));
    s.rect(8, 17 - i, 1, 2, hex('#a8c0ff'));
  });
  [0, 1].forEach((i) => {
    const s = f(14 + i);
    s.ellipse(8.5, 20 - i, 2.5 + i * 0.5, 2.5 + i * 0.5, hex('#ff7a30'));
    s.rect(8, 19 - i, 1, 1, hex('#ffe0a0'));
  });
  // row 4: crafting stations
  const forge = f(16);
  forge.ellipse(8, 22.5, 7, 1.6, SHADOW);
  forge.rect(2, 15, 12, 7, hex('#3a3532'));
  forge.rect(3, 16, 10, 3, hex('#5a524a'));
  forge.rect(4, 17, 8, 2, hex('#ff7a30'));
  forge.rect(6, 17, 3, 1, hex('#ffd080'));
  forge.rect(4, 10, 9, 3, hex('#5f646b'));
  forge.rect(2, 10, 3, 2, hex('#5f646b'));
  forge.rect(7, 13, 3, 2, hex('#41454b'));
  const table = f(17);
  table.ellipse(8, 22.5, 7, 1.6, SHADOW);
  table.rect(1, 15, 14, 2, hex('#6e5236'));
  table.rect(2, 17, 2, 6, hex('#4a3825'));
  table.rect(12, 17, 2, 6, hex('#4a3825'));
  table.rect(3, 11, 3, 4, hex('#7ad8d0'));
  table.rect(4, 9, 1, 2, hex('#c8c0a8'));
  table.rect(9, 12, 4, 3, hex('#ff9a30'));
  table.rect(10, 10, 2, 2, hex('#c8c0a8'));
  return {
    png: sheet.toPNG(),
    json: {
      image: 'props.png',
      frameWidth: 16,
      frameHeight: 24,
      anchor: [0.5, 1],
      frames: { bonfire_unlit: 0, sign: 1, forge: 16, alchemy: 17 },
      animations: {
        bonfire_lit: { frames: [4, 5, 6, 7], fps: 8, loop: true },
        torch: { frames: [8, 9, 10, 11], fps: 8, loop: true },
        souls: { frames: [12, 13], fps: 3, loop: true },
        ember: { frames: [14, 15], fps: 3, loop: true },
      },
    },
  };
}

// ------------------------------------------------------------------ font (4x6 cells, 3x5 glyphs)

const GLYPHS: Record<string, string> = {
  '0': '111101101101111',
  '1': '010110010010111',
  '2': '111001111100111',
  '3': '111001111001111',
  '4': '101101111001001',
  '5': '111100111001111',
  '6': '111100111101111',
  '7': '111001010010010',
  '8': '111101111101111',
  '9': '111101111001111',
  '+': '000010111010000',
  '-': '000000111000000',
  '/': '001001010100100',
  '!': '010010010000010',
  x: '000101010101000',
};

export function buildFont(): { png: Buffer; json: SpriteSheetFile } {
  const chars = Object.keys(GLYPHS);
  const sheet = new Sheet(chars.length * 4, 6);
  const frames: Record<string, number> = {};
  chars.forEach((ch, i) => {
    const s = sheet.frame(i, 4, 6);
    const bits = GLYPHS[ch] ?? '';
    for (let b = 0; b < 15; b++) if (bits[b] === '1') s.px(b % 3, Math.floor(b / 3), hex('#ffffff'));
    frames[ch] = i;
  });
  return {
    png: sheet.toPNG(),
    json: { image: 'font.png', frameWidth: 4, frameHeight: 6, anchor: [0, 0], frames, animations: {} },
  };
}

// ------------------------------------------------------------------ item icons (16x16)

type IconDraw = (s: Surface) => void;
const ICON_SHADOW = hex('#000000', 70);

const blade =
  (base: string, light: string, guard: string): IconDraw =>
  (s) => {
    s.line(3, 13, 12, 4, hex(base));
    s.line(4, 13, 13, 4, hex(light));
    s.rect(3, 11, 3, 1, hex(guard));
    s.rect(4, 10, 1, 3, hex(guard));
    s.line(1, 15, 3, 13, hex('#5c4535'));
  };
const flask =
  (liquid: string): IconDraw =>
  (s) => {
    s.ellipse(8, 14.5, 4, 1, ICON_SHADOW);
    s.ellipse(8, 10.5, 4, 4, hex(liquid));
    s.rect(6, 9, 2, 2, hex('#ffffff', 120));
    s.rect(7, 3, 3, 4, hex('#c8c0a8', 200));
    s.rect(7, 2, 3, 1, hex('#6e5236'));
  };
const ring =
  (gem: string): IconDraw =>
  (s) => {
    s.ellipse(8, 14.5, 4, 1, ICON_SHADOW);
    s.ellipse(8, 10, 4.5, 4, hex('#c8c0a8'));
    s.ellipse(8, 10, 2.5, 2.2, hex('#000000', 0));
    for (let y = 8; y <= 12; y++)
      for (let x = 6; x <= 10; x++) if ((x - 8) ** 2 + (y - 10) ** 2 < 5) s.px(x, y, hex('#000000', 0));
    s.rect(7, 5, 3, 3, hex(gem));
  };

const ICONS: [string, IconDraw][] = [
  [
    'ashwood',
    (s) => {
      s.ellipse(8, 14, 6, 1.2, ICON_SHADOW);
      s.rect(2, 8, 12, 4, hex('#7a7468'));
      s.rect(2, 9, 12, 1, hex('#9a9488'));
      s.ellipse(13.5, 10, 1.5, 2, hex('#c8b898'));
    },
  ],
  [
    'fungal_cap',
    (s) => {
      s.ellipse(8, 14, 5, 1.2, ICON_SHADOW);
      s.rect(7, 9, 2, 5, hex('#c8bba0'));
      s.ellipse(8, 9, 6, 4, hex('#7a3f8a'), 'top');
      s.rect(5, 6, 1, 1, hex('#e8d6ff'));
      s.rect(10, 7, 1, 1, hex('#e8d6ff'));
    },
  ],
  [
    'glowspore',
    (s) => {
      s.ellipse(8, 9, 4, 4, hex('#7ad8d0', 120));
      s.ellipse(8, 9, 2, 2, hex('#c8fff4'));
      s.rect(4, 5, 1, 1, hex('#7ad8d0'));
      s.rect(12, 12, 1, 1, hex('#7ad8d0'));
    },
  ],
  [
    'iron_scrap',
    (s) => {
      s.ellipse(8, 14, 6, 1.2, ICON_SHADOW);
      s.rect(3, 9, 6, 4, hex('#6b6a64'));
      s.rect(7, 7, 6, 4, hex('#888680'));
      s.rect(9, 8, 2, 1, hex('#9a5a2e'));
    },
  ],
  [
    'bone_shard',
    (s) => {
      s.ellipse(8, 14, 5, 1.2, ICON_SHADOW);
      s.line(4, 12, 12, 5, hex('#e7dec4'));
      s.line(5, 12, 12, 6, hex('#c8c0a8'));
      s.rect(11, 4, 2, 2, hex('#e7dec4'));
    },
  ],
  [
    'slime_gel',
    (s) => {
      s.ellipse(8, 14, 5, 1.2, ICON_SHADOW);
      s.ellipse(8, 11, 5, 3.5, hex('#4a8a6a'));
      s.rect(6, 9, 2, 1, hex('#8ad8a8'));
    },
  ],
  ['chipped_sword', blade('#9da2a8', '#d8dcde', '#d0a85c')],
  ['iron_sword', blade('#7d8188', '#c3c7cb', '#5f646b')],
  [
    'bone_cleaver',
    (s) => {
      s.line(2, 14, 8, 8, hex('#5c4535'));
      s.ellipse(10, 6, 4, 3.5, hex('#e7dec4'));
      s.rect(8, 6, 3, 2, hex('#c8c0a8'));
    },
  ],
  [
    'padded_jacket',
    (s) => {
      s.rect(4, 4, 8, 10, hex('#5c5446'));
      s.rect(2, 4, 3, 6, hex('#5c5446'));
      s.rect(11, 4, 3, 6, hex('#5c5446'));
      s.rect(7, 4, 2, 10, hex('#3d372e'));
      s.rect(4, 9, 8, 1, hex('#6e6250'));
    },
  ],
  [
    'iron_mail',
    (s) => {
      s.rect(4, 4, 8, 10, hex('#6b6f75'));
      s.rect(2, 4, 3, 6, hex('#6b6f75'));
      s.rect(11, 4, 3, 6, hex('#6b6f75'));
      for (let y = 5; y < 14; y += 2)
        for (let x = 4 + (y % 4 === 1 ? 1 : 0); x < 12; x += 2) s.px(x, y, hex('#4a4d53'));
    },
  ],
  ['ring_vigor', ring('#c43a2a')],
  ['ring_breath', ring('#7ad8d0')],
  [
    'bandage',
    (s) => {
      s.ellipse(8, 14, 5, 1.2, ICON_SHADOW);
      s.ellipse(8, 10, 5, 4, hex('#c8b898'));
      s.ellipse(8, 10, 2, 1.6, hex('#6e6250'));
      s.rect(11, 12, 3, 1, hex('#c8b898'));
    },
  ],
  ['potion_ember', flask('#ff7a30')],
  ['potion_stone', flask('#8a8778')],
  ['potion_breath', flask('#7ad8d0')],
];

export function buildItems(): { png: Buffer; json: SpriteSheetFile } {
  const cols = 8;
  const sheet = new Sheet(cols * 16, Math.ceil(ICONS.length / cols) * 16);
  const frames: Record<string, number> = {};
  ICONS.forEach(([name, draw], i) => {
    draw(sheet.frame(i, 16, 16));
    frames[name] = i;
  });
  return {
    png: sheet.toPNG(),
    json: { image: 'items.png', frameWidth: 16, frameHeight: 16, anchor: [0.5, 1], frames, animations: {} },
  };
}
