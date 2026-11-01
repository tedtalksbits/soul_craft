import fs from 'node:fs';
import { Sheet, hex } from './placeholders/pixel-canvas';

const sheet = new Sheet(32, 32);
const s = sheet.frame(0, 32, 32);
// Double contrast remains readable over both dark foliage and pale stone.
for (const [x, y, w, h] of [
  [13, 1, 6, 10],
  [13, 21, 6, 10],
  [1, 13, 10, 6],
  [21, 13, 10, 6],
]) {
  s.rect(x ?? 0, y ?? 0, w ?? 0, h ?? 0, hex('#10151c'));
}
for (const [x, y, w, h] of [
  [15, 3, 2, 6],
  [15, 23, 2, 6],
  [3, 15, 6, 2],
  [23, 15, 6, 2],
]) {
  s.rect(x ?? 0, y ?? 0, w ?? 0, h ?? 0, hex('#fff4cc'));
}
s.rect(13, 13, 6, 6, hex('#10151c'));
s.rect(14, 14, 4, 4, hex('#f8b94e'));
s.rect(15, 15, 2, 2, hex('#fff8dd'));
fs.mkdirSync(new URL('../assets/cursors/', import.meta.url), { recursive: true });
fs.writeFileSync(new URL('../assets/cursors/aim.png', import.meta.url), sheet.toPNG());
