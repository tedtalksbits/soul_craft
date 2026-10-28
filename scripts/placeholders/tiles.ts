/** Placeholder terrain tiles, in the style of the original prototype. 16x16, eight per row. */
import { hashString } from '../../src/core/hash';
import { Rng } from '../../src/core/rng';
import type { SpriteSheetDef } from '../../src/content/sprite-sheet';
import { hex, shade, Sheet, type RGBA, type Surface } from './pixel-canvas';

type Draw = (s: Surface, r: () => number) => void;

const GRASS = hex('#545e3e');
const MOSS = hex('#2a4236');
const ASH = hex('#605e50');
const PALE = hex('#424842');
const SHADOW = hex('#000000', 90);

function ground(base: RGBA): Draw {
  return (s, r) => {
    s.rect(0, 0, 16, 16, shade(base, 0.96 + r() * 0.08));
    for (let i = 0; i < 9; i++)
      s.rect((r() * 15) | 0, (r() * 15) | 0, 1, 2, shade(base, r() < 0.5 ? 0.8 : 1.18));
  };
}

function tallBlades(base: RGBA): Draw {
  return (s, r) => {
    ground(base)(s, r);
    for (let i = 0; i < 7; i++) {
      const bx = 1 + ((r() * 13) | 0);
      const by = 5 + ((r() * 9) | 0);
      s.rect(bx, by - 3, 1, 4, shade(base, 1.4));
      s.rect(bx + 1, by - 4, 1, 4, shade(base, 1.25));
      s.rect(bx + 2, by - 2, 1, 3, shade(base, 0.7));
    }
  };
}

function stones(base: RGBA, gap: RGBA): Draw {
  return (s, r) => {
    for (let j = 0; j < 2; j++)
      for (let i = 0; i < 2; i++) s.rect(i * 8, j * 8, 7, 7, shade(base, 0.85 + r() * 0.25));
    s.rect(0, 7, 16, 1, gap);
    s.rect(7, 0, 1, 16, gap);
    s.rect(15, 0, 1, 16, gap);
    s.rect(0, 15, 16, 1, gap);
    if (r() < 0.4) s.rect(2 + ((r() * 10) | 0), 2 + ((r() * 10) | 0), 3, 1, shade(base, 0.6));
  };
}

const FRAMES: [string, Draw][] = [
  ['grass_0', ground(GRASS)],
  ['grass_1', ground(GRASS)],
  ['grass_2', ground(GRASS)],
  [
    'flowers',
    (s, r) => {
      ground(GRASS)(s, r);
      for (let i = 0; i < 4; i++) {
        const c = r() < 0.5 ? hex('#d8d0b0') : hex('#c8a0d8');
        s.rect(1 + ((r() * 13) | 0), 1 + ((r() * 13) | 0), 2, 2, c);
      }
    },
  ],
  ['moss_0', ground(MOSS)],
  ['moss_1', ground(MOSS)],
  ['moss_2', ground(MOSS)],
  ['ash_0', ground(ASH)],
  ['ash_1', ground(ASH)],
  ['ash_2', ground(ASH)],
  ['pale_0', ground(PALE)],
  ['pale_1', ground(PALE)],
  ['pale_2', ground(PALE)],
  ['tall_grass', tallBlades(GRASS)],
  ['tall_moss', tallBlades(MOSS)],
  [
    'path_0',
    (s, r) => {
      s.rect(0, 0, 16, 16, hex('#7a6a52'));
      for (let i = 0; i < 7; i++)
        s.rect((r() * 14) | 0, (r() * 14) | 0, 2, 1, r() < 0.5 ? hex('#8a7a60') : hex('#5e5040'));
    },
  ],
  [
    'path_1',
    (s, r) => {
      s.rect(0, 0, 16, 16, hex('#766650'));
      for (let i = 0; i < 9; i++)
        s.rect((r() * 14) | 0, (r() * 14) | 0, 2, 1, r() < 0.5 ? hex('#8a7a60') : hex('#5e5040'));
    },
  ],
  ['flagstone_0', stones(hex('#6e6c62'), hex('#45443e'))],
  ['flagstone_1', stones(hex('#6e6c62'), hex('#45443e'))],
  ['stone_floor_0', stones(hex('#4a4648'), hex('#2a2628'))],
  ['stone_floor_1', stones(hex('#4a4648'), hex('#2a2628'))],
  [
    'wall',
    (s, r) => {
      const base = hex('#4e4a4c');
      for (let j = 0; j < 4; j++)
        for (let i = -1; i < 2; i++)
          s.rect(i * 8 + (j % 2 ? 4 : 0), j * 4, 7, 3, shade(base, 0.75 + r() * 0.35));
      for (let j = 0; j < 4; j++) s.rect(0, j * 4 + 3, 16, 1, shade(base, 0.45));
      s.rect(0, 0, 16, 1, shade(base, 1.35));
    },
  ],
  [
    'water',
    (s, r) => {
      s.rect(0, 0, 16, 16, hex('#2b4a58'));
      for (let i = 0; i < 4; i++) s.rect((r() * 12) | 0, (r() * 15) | 0, 4, 1, hex('#3a6070'));
      for (let i = 0; i < 2; i++) s.rect((r() * 12) | 0, (r() * 15) | 0, 3, 1, hex('#244050'));
    },
  ],
  [
    'shallows',
    (s, r) => {
      s.rect(0, 0, 16, 16, hex('#3e6470'));
      for (let i = 0; i < 5; i++) s.rect((r() * 13) | 0, (r() * 15) | 0, 3, 1, hex('#5a8088'));
      for (let i = 0; i < 3; i++) s.rect((r() * 14) | 0, (r() * 14) | 0, 2, 2, hex('#6a6a52', 160));
    },
  ],
  [
    'tree',
    (s) => {
      const leaf = hex('#3a4c2e');
      s.ellipse(9, 13.5, 7, 2.5, SHADOW);
      s.rect(7, 9, 3, 5, hex('#3a2c22'));
      s.ellipse(8, 7, 7, 7, shade(leaf, 0.7));
      s.ellipse(7, 6, 5.5, 5.5, leaf);
      s.rect(4, 3, 3, 2, shade(leaf, 1.35));
      s.rect(8, 2, 2, 1, shade(leaf, 1.35));
    },
  ],
  [
    'fungal_tree',
    (s) => {
      const leaf = hex('#24463e');
      s.ellipse(9, 13.5, 7, 2.5, SHADOW);
      s.rect(7, 9, 3, 5, hex('#2e2a30'));
      s.ellipse(8, 7, 7, 7, shade(leaf, 0.7));
      s.ellipse(7, 6, 5.5, 5.5, leaf);
      s.rect(4, 3, 2, 2, hex('#7ad8d0', 200));
      s.rect(10, 5, 1, 1, hex('#c49aff', 200));
    },
  ],
  [
    'dead_tree',
    (s) => {
      const bark = hex('#3a302a');
      s.rect(4, 13, 9, 2, SHADOW);
      s.line(8, 15, 8, 5, bark);
      s.line(9, 15, 9, 6, bark);
      s.line(8, 5, 3, 1, bark);
      s.line(8, 7, 13, 2, bark);
      s.line(8, 10, 11, 8, bark);
    },
  ],
  ['giant_shroom_0', shroom(hex('#7a3f8a'))],
  ['giant_shroom_1', shroom(hex('#3f7a86'))],
  [
    'rock',
    (s) => {
      s.rect(2, 12, 13, 3, SHADOW);
      s.ellipse(8, 9, 7, 6, hex('#6a6660'));
      s.ellipse(7, 7, 5, 3.5, hex('#8a8680'));
      s.rect(9, 11, 4, 1, hex('#4a4642'));
    },
  ],
  [
    'grave',
    (s) => {
      s.rect(3, 13, 11, 2, SHADOW);
      s.rect(4, 5, 8, 9, hex('#8a8884'));
      s.ellipse(8, 5, 4, 4, hex('#8a8884'), 'top');
      s.rect(7, 6, 2, 5, hex('#5a5854'));
      s.rect(5, 7, 6, 1, hex('#5a5854'));
    },
  ],
  [
    'roof',
    (s) => {
      s.rect(0, 0, 16, 16, hex('#4c3a36'));
      for (let j = 0; j < 4; j++)
        for (let i = 0; i < 4; i++)
          s.rect(i * 4 + (j % 2) * 2, j * 4, 3, 3, (i + j) % 2 ? hex('#5a4440') : hex('#6a504a'));
    },
  ],
  ['house_wall', houseWall()],
  [
    'house_window',
    (s, r) => {
      houseWall()(s, r);
      s.rect(5, 5, 6, 5, hex('#1a1412'));
      s.rect(6, 6, 4, 3, hex('#f0b060', 140));
    },
  ],
  [
    'house_door',
    (s, r) => {
      houseWall()(s, r);
      s.rect(4, 4, 8, 12, hex('#3a2618'));
      s.rect(10, 10, 1, 1, hex('#c8a050'));
    },
  ],
];

function shroom(cap: RGBA): Draw {
  return (s) => {
    s.ellipse(8, 14, 6, 2, SHADOW);
    s.rect(6, 7, 4, 7, hex('#c8bba0'));
    s.ellipse(8, 7, 8, 6, cap, 'top');
    s.rect(0, 6, 16, 2, cap);
    s.rect(3, 3, 2, 1, hex('#e8d6ff'));
    s.rect(10, 2, 2, 1, hex('#e8d6ff'));
    s.rect(7, 4, 1, 1, hex('#e8d6ff'));
  };
}

function houseWall(): Draw {
  return (s) => {
    s.rect(0, 0, 16, 16, hex('#8a8070'));
    for (let j = 0; j < 4; j++) s.rect(0, j * 4 + 3, 16, 1, hex('#6a604f'));
    s.rect(0, 0, 16, 2, hex('#000000', 80));
  };
}

export function buildTiles(): { png: Buffer; json: SpriteSheetDef } {
  const cols = 8;
  const sheet = new Sheet(cols * 16, Math.ceil(FRAMES.length / cols) * 16);
  const frames: Record<string, number> = {};
  FRAMES.forEach(([name, draw], i) => {
    const rng = new Rng(hashString(name));
    draw(sheet.frame(i, 16, 16), () => rng.next());
    frames[name] = i;
  });
  return {
    png: sheet.toPNG(),
    json: { image: 'tiles.png', frameWidth: 16, frameHeight: 16, anchor: [0, 0], frames, animations: {} },
  };
}
