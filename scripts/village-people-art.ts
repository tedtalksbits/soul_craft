import fs from 'node:fs';
import { format } from 'prettier';
import { Sheet, hex } from './placeholders/pixel-canvas';
import type { SpriteSheetFile } from '../src/content/sprite-sheet';

// Maren retains her gray shawl and staff at the same pixel scale as the player.
const npcs = new Sheet(96, 48);
for (let i = 0; i < 2; i++) {
  const s = npcs.frame(i, 48, 48);
  const lift = i;
  // The feet and hem never move during her slow breathing cycle.
  s.rect(17, 43, 5, 4, hex('#292a2c'));
  s.rect(25, 43, 5, 4, hex('#292a2c'));
  s.rect(18, 44, 3, 2, hex('#6d5a47'));
  s.rect(26, 44, 3, 2, hex('#6d5a47'));
  for (let y = 27; y <= 43; y++) {
    const half = 6 + Math.floor((y - 27) / 5);
    s.rect(24 - half, y, half * 2, 1, hex('#302f32'));
    s.rect(25 - half, y, half * 2 - 3, 1, hex('#66574e'));
    s.rect(23, y, 2, 1, hex('#87715b'));
    if (y > 32) s.rect(18, y, 2, 1, hex('#4b4543'));
    s.rect(28, y, 2, 1, hex('#494142'));
  }
  // Hunched shoulders, a broad triangular shawl, and broken woven highlights.
  for (let y = 20; y <= 32; y++) {
    const half = y < 25 ? 7 + Math.floor((y - 20) / 2) : 10 - Math.floor((y - 25) / 2);
    s.rect(23 - half, y - lift, half * 2 + 1, 1, hex('#343b40'));
    s.rect(24 - half, y - lift, half * 2 - 2, 1, hex('#888b86'));
    s.rect(24, y - lift, Math.max(1, half - 2), 1, hex('#5e6768'));
  }
  s.line(16, 23 - lift, 23, 29 - lift, hex('#b5b5a5'));
  s.line(18, 25 - lift, 24, 30 - lift, hex('#a4a89c'));
  s.line(30, 23 - lift, 25, 30 - lift, hex('#424e54'));
  s.rect(23, 25 - lift, 2, 3, hex('#c6a76d'));
  for (const [x = 0, y = 0] of [
    [15, 27],
    [18, 29],
    [21, 31],
    [27, 30],
    [30, 27],
  ]) {
    s.rect(x, y - lift, 1, 2, hex('#b5b5a5'));
  }
  s.rect(19, 36, 3, 4, hex('#796852'));
  s.px(19, 36, hex('#b49b73'));
  s.px(21, 39, hex('#b49b73'));
  s.rect(26, 34, 1, 6, hex('#a38b6b'));
  // Silver hair surrounds a small, weathered face rather than a large cartoon head.
  s.ellipse(23, 16 - lift, 6, 7, hex('#343b40'));
  s.ellipse(22, 15 - lift, 4, 5, hex('#b6b8ae'));
  s.rect(19, 16 - lift, 8, 6, hex('#9b7d64'));
  s.rect(20, 16 - lift, 6, 4, hex('#d5b28a'));
  s.rect(19, 13 - lift, 7, 3, hex('#d1d0bb'));
  s.rect(18, 15 - lift, 2, 5, hex('#b6b8ae'));
  s.rect(26, 15 - lift, 2, 6, hex('#7c8582'));
  s.px(21, 17 - lift, hex('#34313a'));
  s.px(25, 17 - lift, hex('#34313a'));
  s.px(23, 19 - lift, hex('#a17e63'));
  s.rect(21, 21 - lift, 4, 1, hex('#765d51'));
  s.rect(20, 16 - lift, 2, 1, hex('#8f877b'));
  s.px(25, 16 - lift, hex('#8f877b'));
  s.rect(18, 11 - lift, 3, 2, hex('#e0daca'));
  s.px(22, 12 - lift, hex('#e0daca'));
  // Knotted walking stick and hand remain readable against paving.
  s.line(34, 19, 33, 45, hex('#282d30'));
  s.line(36, 19, 35, 45, hex('#282d30'));
  s.line(35, 19, 34, 45, hex('#a0804f'));
  s.rect(33, 18, 4, 2, hex('#665039'));
  s.rect(31, 28 - lift, 4, 3, hex('#9c7a5d'));
  s.rect(31, 28 - lift, 3, 1, hex('#d5b28a'));
}

const signs = new Sheet(32, 32);
const sign = signs.frame(0, 32, 32);
sign.rect(14, 15, 5, 16, hex('#282e2d'));
sign.rect(15, 16, 2, 14, hex('#9a754b'));
sign.rect(17, 17, 1, 13, hex('#5d4837'));
sign.rect(3, 3, 26, 14, hex('#282e2d'));
sign.rect(4, 4, 24, 11, hex('#9a754b'));
sign.rect(5, 4, 22, 1, hex('#c5a570'));
sign.rect(4, 9, 24, 1, hex('#594738'));
sign.rect(5, 11, 22, 3, hex('#88613f'));
sign.rect(4, 15, 23, 1, hex('#594738'));
sign.rect(3, 4, 1, 2, hex('#594738'));
sign.rect(26, 13, 3, 2, hex('#282e2d'));
sign.rect(11, 4, 2, 1, hex('#88613f'));
sign.rect(20, 13, 4, 1, hex('#b18a57'));
sign.px(4, 4, hex('#282e2d'));
sign.px(27, 5, hex('#282e2d'));
sign.rect(6, 7, 2, 1, hex('#725338'));
sign.rect(22, 7, 3, 1, hex('#725338'));
sign.rect(10, 13, 3, 1, hex('#594738'));
// Pale carved marks suggest writing without pretending a tiny label is legible.
for (const [x = 0, y = 0, w = 0] of [
  [8, 6, 5],
  [15, 6, 8],
  [8, 12, 7],
  [17, 12, 4],
])
  sign.rect(x, y, w, 1, hex('#e4d2a3'));
for (const x of [5, 26]) {
  sign.px(x, 6, hex('#323c3c'));
  sign.px(x, 12, hex('#323c3c'));
}

async function save(name: string, sheet: Sheet, def: SpriteSheetFile) {
  fs.writeFileSync(new URL(`../assets/sprites/${name}.png`, import.meta.url), sheet.toPNG());
  fs.writeFileSync(
    new URL(`../assets/sprites/${name}.json`, import.meta.url),
    await format(JSON.stringify(def), { parser: 'json' }),
  );
}
/** Keep feet anchored and use whole output pixels; never scale sprites at runtime. */
function compact(
  source: Sheet,
  frameWidth: number,
  frameHeight: number,
  count: number,
  scale: number,
): Sheet {
  const result = new Sheet(source.width, source.height);
  const width = Math.round(frameWidth * scale);
  const height = Math.round(frameHeight * scale);
  const left = Math.floor((frameWidth - width) / 2);
  const top = frameHeight - height;
  for (let frame = 0; frame < count; frame++) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const sx = frame * frameWidth + Math.floor(((x + 0.5) * frameWidth) / width);
        const sy = Math.floor(((y + 0.5) * frameHeight) / height);
        const from = (sy * source.width + sx) * 4;
        const to = ((top + y) * result.width + frame * frameWidth + left + x) * 4;
        result.data.set(source.data.subarray(from, from + 4), to);
      }
    }
  }
  return result;
}
await save('npcs', compact(npcs, 48, 48, 2, 0.8), {
  image: 'npcs.png',
  frameWidth: 48,
  frameHeight: 48,
  anchor: [0.5, 1],
  frames: {},
  animations: { maren: { frames: [0, 1], fps: 1, loop: true } },
});
await save('signs', compact(signs, 32, 32, 1, 0.7), {
  image: 'signs.png',
  frameWidth: 32,
  frameHeight: 32,
  anchor: [0.5, 1],
  frames: { sign: 0 },
  animations: {},
});
