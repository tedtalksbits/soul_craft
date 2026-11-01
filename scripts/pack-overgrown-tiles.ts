import fs from 'node:fs';
import { PNG } from 'pngjs';

// Pack the generated atlas into the existing engine's 8-column, 16px grid.
const source = PNG.sync.read(
  fs.readFileSync(new URL('../assets/sprites/alternatives/overgrown-ruins/source.png', import.meta.url)),
);
const out = new PNG({ width: 128, height: 80 });
for (let frame = 0; frame < 35; frame++) {
  const col = frame % 8;
  const row = Math.floor(frame / 8);
  const overlay = frame >= 24 && frame <= 30;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // Sample pixel centers inside each cell, avoiding generated grid lines.
      const sx = Math.floor(((col + 0.025 + ((x + 0.5) / 16) * 0.95) * source.width) / 8);
      const sy = Math.floor(((row + 0.025 + ((y + 0.5) / 16) * 0.95) * source.height) / 5);
      const si = (sy * source.width + sx) * 4;
      const di = ((row * 16 + y) * 128 + col * 16 + x) * 4;
      const [r = 0, g = 0, b = 0, a = 0] = source.data.subarray(si, si + 4);
      const neutralBackdrop = Math.min(r, g, b) > 145 && Math.max(r, g, b) - Math.min(r, g, b) < 24;
      const clear = overlay && (a < 230 || neutralBackdrop);
      out.data.set(clear ? [0, 0, 0, 0] : [r, g, b, 255], di);
    }
  }
}
// Hand-clustered chips and broken highlights keep the raised cap from reading
// as a smooth extrusion. All marks are authored on the native 16px grid.
const wall = [
  'sslllhllssllhlls',
  'lhhhlllslhhhllls',
  'llhlmmlsllhllmls',
  'lmmmmlssllmmmlss',
  'mmsssssmmmsmmsss',
  'ssssddssssddssss',
  'sllmmmsdlllmmlms',
  'smmllmsdmmmmlmss',
  'smmmsmssmmssmmss',
  'dssssddssssssddd',
  'mmsdllmmmsdllmmm',
  'mmsdmmmlmsdmmmss',
  'sssdmmmsssdmmsss',
  'sdddssssddddsssd',
  'ddddsdssssdddsdd',
  'dddddddddddddddd',
];
const stonePalette = {
  h: [153, 158, 137],
  l: [112, 123, 112],
  m: [76, 89, 85],
  s: [45, 57, 57],
  d: [24, 34, 36],
};
for (let y = 0; y < 16; y++) {
  for (let x = 0; x < 16; x++) {
    const mark = wall[y]?.[x];
    const color =
      mark === 'h' || mark === 'l' || mark === 'm' || mark === 's' ? stonePalette[mark] : stonePalette.d;
    out.data.set([...color, 255], ((32 + y) * 128 + 80 + x) * 4);
  }
}
// Cool foliage and a dark contour separate trees from warm olive terrain.
const tree = [
  '......dd........',
  '....ddhldd......',
  '...dhhhhlld.....',
  '..dhhhlhllld....',
  '..dhhllllmldd...',
  '.dhhlhllmmllld..',
  '.dhllllllmmlld..',
  'dhhlllmmllmmmld.',
  'dhlllmmmllmmmld.',
  '.dllmmmmmmmmsd..',
  '..dmmmmmmsssd...',
  '...ddddbdddd....',
  '......dbbd......',
  '......dbbd......',
  '.....dbbbbdd....',
  '......dddd......',
];
for (const [frame, palette] of [
  [
    24,
    {
      d: [15, 32, 31],
      h: [122, 177, 120],
      l: [57, 121, 79],
      m: [31, 78, 59],
      s: [22, 51, 44],
      b: [124, 86, 56],
    },
  ],
  [
    25,
    {
      d: [16, 28, 43],
      h: [117, 211, 199],
      l: [48, 142, 148],
      m: [31, 87, 111],
      s: [24, 49, 75],
      b: [121, 99, 129],
    },
  ],
] as const) {
  const ox = (frame % 8) * 16;
  const oy = Math.floor(frame / 8) * 16;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const mark = tree[y]?.[x];
      const color =
        mark === 'd' || mark === 'h' || mark === 'l' || mark === 'm' || mark === 's' || mark === 'b'
          ? palette[mark]
          : undefined;
      out.data.set(color ? [...color, 255] : [0, 0, 0, 0], ((oy + y) * 128 + ox + x) * 4);
    }
  }
}
// Breakable vegetation needs a distinct silhouette against quiet biome ground.
// Author at native resolution so the one-pixel contour survives game scaling.
const tuft = [
  '................',
  '.......h........',
  '...h...hl...h....',
  '...hl..hl..hl...',
  '...hl..hl..hl...',
  '.h.hl.hhl..hl...',
  '.hlhl.hhl.hhl...',
  '..hhl.hhl.hhl.h.',
  '..hhlmhhlmhhlhl.',
  '..hhmmhhlmhhlhl.',
  '...hmmhhmmhhhl..',
  '...hmmmhmhhhl...',
  '....hmmmmhhl....',
  '.....mmmmml.....',
  '................',
  '................',
];
for (const [frame, base, palette] of [
  [13, 0, { h: [202, 213, 115], l: [123, 157, 66], m: [77, 111, 45] }],
  [14, 4, { h: [151, 223, 180], l: [75, 165, 128], m: [42, 111, 88] }],
] as const) {
  const originX = (frame % 8) * 16;
  const originY = Math.floor(frame / 8) * 16;
  const filled = (x: number, y: number) => (tuft[y]?.[x] ?? '.') !== '.';
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const target = ((originY + y) * 128 + originX + x) * 4;
      const ground = (y * 128 + base * 16 + x) * 4;
      out.data.copy(out.data, target, ground, ground + 4);
      const mark = tuft[y]?.[x];
      const color = mark === 'h' || mark === 'l' || mark === 'm' ? palette[mark] : undefined;
      const border = !color && (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1));
      if (color) out.data.set([...color, 255], target);
      else if (border) out.data.set([23, 39, 28, 255], target);
    }
  }
}
fs.writeFileSync(
  new URL('../assets/sprites/alternatives/overgrown-ruins/tiles.png', import.meta.url),
  PNG.sync.write(out),
);
const preview = new PNG({ width: 768, height: 480 });
for (let y = 0; y < preview.height; y++) {
  for (let x = 0; x < preview.width; x++) {
    const si = (Math.floor(y / 6) * 128 + Math.floor(x / 6)) * 4;
    preview.data.set(out.data.subarray(si, si + 4), (y * preview.width + x) * 4);
  }
}
fs.writeFileSync(
  new URL('../assets/sprites/alternatives/overgrown-ruins/preview.png', import.meta.url),
  PNG.sync.write(preview),
);
console.log('Packed 35 frames, 128x80 RGBA; unused cells transparent.');
