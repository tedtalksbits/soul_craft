import fs from 'node:fs';
import { PNG } from 'pngjs';
import { Sheet, hex } from './placeholders/pixel-canvas';

// Native-resolution clustered foliage; the collision tile remains 16x16.
const sheet = new Sheet(48 * 5, 64);
const s = sheet.frame(0, 48, 64);
s.ellipse(24, 60, 10, 3, hex('#172923', 100));
s.line(21, 58, 24, 35, hex('#27352c'));
s.rect(20, 37, 8, 23, hex('#27352c'));
s.rect(22, 39, 3, 20, hex('#75583c'));
s.rect(25, 42, 2, 17, hex('#493f30'));
s.line(22, 60, 17, 61, hex('#493f30'));
s.line(26, 59, 31, 61, hex('#493f30'));
const clusters = [
  [23, 14, 12, 12],
  [14, 25, 12, 12],
  [32, 24, 12, 13],
  [23, 33, 15, 12],
  [9, 34, 8, 8],
  [38, 34, 8, 9],
];
for (const [cx = 0, cy = 0, rx = 0, ry = 0] of clusters) {
  s.ellipse(cx, cy, rx, ry, hex('#142f29'));
  s.ellipse(cx - 1, cy - 2, rx - 1, ry - 2, hex('#245340'));
  s.ellipse(cx - 2, cy - 4, rx - 3, ry - 4, hex('#39794f'));
  s.ellipse(cx - 3, cy - 6, rx - 5, ry - 6, hex('#62965e'));
}
// Short, stepped leaf clusters instead of smooth airbrushed ramps.
for (let i = 0; i < 45; i++) {
  const x = 4 + ((i * 17) % 40);
  const y = 5 + ((i * 13) % 36);
  const p = (y * sheet.width + x) * 4;
  if ((sheet.data[p + 3] ?? 0) === 255) {
    s.rect(x, y, 2, 1, hex(i % 3 === 0 ? '#80ae70' : '#2b6245'));
    s.px(x - 1, y + 1, hex('#39794f'));
  }
}
// Fungal trees retain the broad canopy but use cooler foliage and shelf fungi.
for (let y = 0; y < 64; y++) {
  for (let x = 0; x < 48; x++) {
    const p = (y * sheet.width + x) * 4;
    const target = (y * sheet.width + 48 + x) * 4;
    const r = sheet.data[p] ?? 0;
    const g = sheet.data[p + 1] ?? 0;
    const b = sheet.data[p + 2] ?? 0;
    sheet.data.set(
      g > r
        ? [Math.round(r * 0.65), Math.min(255, g + 14), Math.min(255, b + 48), sheet.data[p + 3] ?? 0]
        : [r, g, b, sheet.data[p + 3] ?? 0],
      target,
    );
  }
}
const fungal = sheet.frame(1, 48, 64);
for (const [x = 0, y = 0] of [
  [15, 30],
  [29, 39],
  [19, 48],
  [31, 20],
]) {
  fungal.ellipse(x, y, 5, 2, hex('#263d50'));
  fungal.rect(x - 4, y - 2, 7, 2, hex('#75d5cf'));
  fungal.rect(x - 2, y - 3, 3, 1, hex('#c1efd4'));
}
// Sparse angular branches keep dead trees legible against pale or ashen ground.
const dead = sheet.frame(2, 48, 64);
const branches = [
  [24, 59, 23, 10],
  [23, 27, 11, 16],
  [11, 16, 8, 7],
  [12, 17, 5, 15],
  [24, 35, 36, 20],
  [36, 20, 39, 9],
  [35, 23, 44, 20],
  [23, 15, 30, 5],
  [24, 45, 12, 35],
  [12, 35, 8, 25],
];
for (const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] of branches) {
  for (let dx = -2; dx <= 2; dx++) dead.line(x1 + dx, y1, x2 + dx, y2, hex('#292e32'));
  dead.line(x1, y1, x2, y2, hex('#8c8070'));
  dead.line(x1 - 1, y1, x2 - 1, y2, hex('#b2a08a'));
}
// Continue the branch bark down into a flared, outlined root collar rather
// than covering it with a flat rectangular stump.
const root = [
  '.......dhbsd........',
  '.......dhbsd........',
  '.......dhbbsd.......',
  '.......dhbbsd.......',
  '.......dhbbsd.......',
  '.......dhbbsd.......',
  '......ddhbbsdd......',
  '......dhhbbssd......',
  '.....ddhbbbsdd......',
  '.....dhhbbbsdd......',
  '....ddhbbbsbhsd.....',
  '...ddhbbsssbhsdd....',
  '..ddhbssddssbbhsdd..',
  '.ddbbssddddssbbbsdd.',
  '..dddddd..dddddddd..',
  '....................',
];
const bark = { d: '#292e32', h: '#a18c71', b: '#756451', s: '#49433b' };
dead.ellipse(24, 61, 11, 2, hex('#191f23', 110));
for (let y = 0; y < root.length; y++) {
  for (let x = 0; x < 20; x++) {
    const mark = root[y]?.[x];
    if (mark === 'd' || mark === 'h' || mark === 'b' || mark === 's')
      dead.px(14 + x, 47 + y, hex(bark[mark]));
  }
}
// Mushroom variants share a shorter, wider silhouette and the same trunk anchor.
for (const [frame, dark, base, light] of [
  [3, '#392b4d', '#81538e', '#b387b4'],
  [4, '#173d48', '#347f86', '#77b9b1'],
] as const) {
  const mushroom = sheet.frame(frame, 48, 64);
  mushroom.ellipse(24, 60, 10, 3, hex('#172923', 100));
  mushroom.rect(20, 34, 8, 27, hex('#655c66'));
  mushroom.rect(21, 35, 3, 25, hex('#c0b59c'));
  mushroom.rect(24, 40, 2, 20, hex('#968e80'));
  mushroom.ellipse(24, 32, 22, 15, hex(dark), 'top');
  mushroom.ellipse(23, 30, 19, 12, hex(base), 'top');
  mushroom.ellipse(20, 27, 12, 7, hex(light), 'top');
  mushroom.rect(3, 32, 42, 3, hex(dark));
  mushroom.rect(7, 35, 34, 2, hex('#9b8e9b'));
  for (const [x = 0, y = 0] of [
    [13, 26],
    [25, 20],
    [32, 28],
    [21, 30],
  ]) {
    mushroom.rect(x, y, 3, 2, hex('#d5e5c1'));
    mushroom.px(x + 1, y - 1, hex('#b2d6c0'));
  }
}
fs.writeFileSync(new URL('../assets/sprites/trees.png', import.meta.url), sheet.toPNG());
fs.writeFileSync(
  new URL('../assets/sprites/trees.json', import.meta.url),
  JSON.stringify({
    image: 'trees.png',
    frameWidth: 48,
    frameHeight: 64,
    anchor: [0.5, 1],
    frames: { tree: 0, fungal_tree: 1, dead_tree: 2, giant_shroom_0: 3, giant_shroom_1: 4 },
    animations: {},
  }),
);
const png = PNG.sync.read(sheet.toPNG());
console.log(`Tree: ${png.width}x${png.height}, anchored at trunk base.`);
