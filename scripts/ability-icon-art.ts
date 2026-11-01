import fs from 'node:fs';
import { PNG } from 'pngjs';
import { format } from 'prettier';
import { SpriteSheetSchema } from '../src/content/sprite-sheet';

// Pack the generated 9x3 review atlas into native 48px game frames.
const source = PNG.sync.read(fs.readFileSync(new URL('../tools/art/source/abilities.png', import.meta.url)));
const metaPath = new URL('../assets/sprites/abilities.json', import.meta.url);
const meta = SpriteSheetSchema.parse(JSON.parse(fs.readFileSync(metaPath, 'utf8')));
const size = 48;
const out = new PNG({ width: size * 9, height: size * 3 });
for (let row = 0; row < 3; row++) {
  for (let col = 0; col < 9; col++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sx = Math.floor(((col + (x + 0.5) / size) * source.width) / 9);
        const sy = Math.floor(((row + (y + 0.5) / size) * source.height) / 3);
        const from = (sy * source.width + sx) * 4;
        const to = ((row * size + y) * out.width + col * size + x) * 4;
        out.data.set(source.data.subarray(from, from + 4), to);
      }
    }
  }
}
fs.writeFileSync(new URL('../assets/sprites/abilities.png', import.meta.url), PNG.sync.write(out));
meta.frameWidth = meta.frameHeight = size;
fs.writeFileSync(metaPath, await format(JSON.stringify(meta), { parser: 'json' }));
console.log('Packed all 27 full-color ability icons at 48x48.');
