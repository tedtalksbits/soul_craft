/** Placeholder props (bonfire, torch, sign, pickups, brazier) and the bitmap digit font. */
import type { SpriteSheetFile } from '../../src/content/sprite-sheet';
import { hex, Sheet, type Surface } from './pixel-canvas';

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
  // row 4: boss arena brazier, cold then burning
  const brazierBowl = (s: Surface) => {
    s.ellipse(8, 22.5, 5, 1.4, hex('#000000', 90));
    s.rect(7, 17, 2, 6, hex('#3a3532'));
    s.rect(4, 14, 8, 3, hex('#5f646b'));
    s.rect(5, 17, 6, 1, hex('#41454b'));
  };
  brazierBowl(f(16));
  f(16).rect(5, 13, 6, 1, hex('#4a4440'));
  [1, 0.85, 0.95].forEach((k, i) => {
    brazierBowl(f(17 + i));
    flame(f(17 + i), 8, 14, k, 2);
  });
  return {
    png: sheet.toPNG(),
    json: {
      image: 'props.png',
      frameWidth: 16,
      frameHeight: 24,
      anchor: [0.5, 1],
      frames: { bonfire_unlit: 0, sign: 1, brazier: 16 },
      animations: {
        bonfire_lit: { frames: [4, 5, 6, 7], fps: 8, loop: true },
        torch: { frames: [8, 9, 10, 11], fps: 8, loop: true },
        souls: { frames: [12, 13], fps: 3, loop: true },
        ember: { frames: [14, 15], fps: 3, loop: true },
        brazier_lit: { frames: [17, 18, 19], fps: 8, loop: true },
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
  // Capitals, for key labels on the HUD.
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '110101101101101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101110011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101010010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
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
