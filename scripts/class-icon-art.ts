import fs from 'node:fs';
import { format } from 'prettier';
import { Sheet, hex } from './placeholders/pixel-canvas';

// Hand-authored 24px emblems: short ramps and deliberate clusters, no glows.
const sheet = new Sheet(72, 24);
const shield = sheet.frame(0, 24, 24);
// An oathkeeper's crest: notched brass rim, split steel face and upright sword.
const crest = [
  '........................',
  '........................',
  '....dd............dd....',
  '...dgldd........ddggd...',
  '..dghgglddddddddggggsd..',
  '..dglhlgggggggggggggsd..',
  '..dglhllddddddddllggsd..',
  '..dglhllmmmmmmmmslggsd..',
  '..dglhllmmmmmmmmslggsd..',
  '..dglhllmmlmmmmsllggsd..',
  '..dglhllmmmmmmmsllggsd..',
  '...dghllmmmmmmssllgsd...',
  '...dglllmmmmmmssllgsd...',
  '...dgllmmmmmmsmsllgsd...',
  '....dgllmmmmssmllgsd....',
  '....dgllmmmsssmllgsd....',
  '.....dgllmmssmllgsd.....',
  '......dgllmssllgsd......',
  '.......dgllsllgsd.......',
  '........dglllgsd........',
  '.........dgggsd.........',
  '..........dgsd..........',
  '...........dd...........',
  '........................',
];
const steel: Record<string, string> = {
  d: '#192936',
  g: '#ac8552',
  h: '#e4e7d7',
  l: '#8daebc',
  m: '#456881',
  s: '#293e55',
};
crest.forEach((row, y) =>
  [...row].forEach((mark, x) => {
    const color = steel[mark];
    if (color) shield.px(x, y, hex(color));
  }),
);
shield.line(11, 1, 11, 14, hex('#192936'));
shield.line(13, 2, 13, 14, hex('#192936'));
shield.rect(11, 3, 2, 10, hex('#cbd7d5'));
shield.rect(11, 3, 1, 10, hex('#f5edd4'));
shield.px(11, 2, hex('#f5edd4'));
shield.rect(7, 13, 10, 3, hex('#192936'));
shield.rect(8, 13, 8, 1, hex('#e0be78'));
shield.px(7, 12, hex('#ac8552'));
shield.px(16, 12, hex('#ac8552'));
shield.rect(11, 15, 2, 4, hex('#805a3d'));
shield.rect(11, 16, 1, 1, hex('#c49c63'));
shield.rect(10, 19, 4, 2, hex('#192936'));
shield.rect(11, 19, 2, 1, hex('#e0be78'));
shield.rect(5, 9, 2, 1, hex('#e4e7d7'));
shield.px(18, 10, hex('#e0be78'));

const hood = sheet.frame(1, 24, 24);
const hoodRows = [
  '..........dd..........',
  '.........dlld.........',
  '........dhlmmd........',
  '.......dhllmmmd.......',
  '......dhllmmmmsd......',
  '.....dhllmmmssssd.....',
  '....dhllmddddssssd....',
  '....dllmdssssdmssd....',
  '...dhllmdsssssdmssd...',
  '...dllmdssssssdmssd...',
  '..dhllmdsesssedmsssd..',
  '..dllmmdssssssdmsssd..',
  '..dllmmmdssssdmssssd..',
  '..dlllmmmddddmsssssd..',
  '...dllmmmmmmmsssssd...',
  '....dllllmmmsssssd....',
  '.....ddllllmsssdd.....',
  '.......dddddddd.......',
];
const shade: Record<string, string> = {
  d: '#211d32',
  h: '#ddd0ec',
  l: '#a79abf',
  m: '#6e5b91',
  s: '#30253f',
  e: '#e8dbb9',
};
hoodRows.forEach((row, y) =>
  [...row].forEach((mark, x) => {
    const color = shade[mark];
    if (color) hood.px(x + 1, y + 1, hex(color));
  }),
);
// A small silver blade crossing the lower edge is the Stalker's signature.
hood.line(6, 21, 19, 13, hex('#211d32'));
hood.line(6, 22, 20, 14, hex('#211d32'));
hood.line(8, 21, 19, 14, hex('#aab5c8'));
hood.line(8, 20, 19, 14, hex('#ece8d8'));
hood.line(6, 18, 10, 23, hex('#c9aa72'));
hood.line(4, 23, 7, 21, hex('#806b7f'));

const flame = sheet.frame(2, 24, 24);
const flameRows = [
  '............d...........',
  '...........dhd..........',
  '..........dhhd..........',
  '.........dhhmd..........',
  '.........dhmmd..........',
  '........dhmmmd..........',
  '....d...dhmmmd..........',
  '....dmddhmmmmd...d......',
  '....dmmhmmmmmmd.dmd.....',
  '....dmmmmmmmmmd.dmmd....',
  '...dmmmmhmmmmmmdmmmd....',
  '...dmmmhhhmmmmmmmmd.....',
  '..dmmmhhhhhmmmmmmmmd....',
  '..dmmhhccchhmmmmmmmd....',
  '..dmmhcccchhmmmmmmd.....',
  '..dmmhcccchhmmmmmmmd....',
  '..dmmhhccchhmmmmmmd.....',
  '...dmmhhchhmmmmmmd......',
  '...dmmmhhhmmmmmmd.......',
  '....dmmmmmmmmmmd........',
  '.....ddmmmmmddd.........',
  '.......dddddd...........',
];
const ember: Record<string, string> = { d: '#3c2528', m: '#cb562e', h: '#f3ac4a', c: '#fff0bb' };
flameRows.forEach((row, y) =>
  [...row].forEach((mark, x) => {
    const color = ember[mark];
    if (color) flame.px(x + 1, 1 + Math.floor(y * 0.62), hex(color));
  }),
);
// A raised palm cradles the ember; bent fingertips frame the flame's base.
const hand = [
  '..dd................dd..',
  '..dhdd............ddhd..',
  '..dhhbdd........ddbhhd..',
  '...dhhbbddddddddbbhhd...',
  '....dhhhhbbbbbnhhhhd....',
  '.....dbhhhhhhhhhbdd.....',
  '......ddbbbbbbbbdd......',
  '...........drrccrd......',
  '...........dcccccd......',
  '...........ddddddd......',
];
const palm: Record<string, string> = {
  d: '#352b32',
  h: '#edc890',
  b: '#b98d64',
  n: '#84604c',
  r: '#c19b5c',
  c: '#67505a',
};
hand.forEach((row, y) =>
  [...row].forEach((mark, x) => {
    const color = palm[mark];
    if (color) flame.px(x, y + 14, hex(color));
  }),
);
fs.writeFileSync(new URL('../assets/sprites/sigils.png', import.meta.url), sheet.toPNG());
fs.writeFileSync(
  new URL('../assets/sprites/sigils.json', import.meta.url),
  await format(
    JSON.stringify({
      image: 'sigils.png',
      frameWidth: 24,
      frameHeight: 24,
      anchor: [0.5, 1],
      frames: { vanguard: 0, stalker: 1, ashcaller: 2 },
      animations: {},
    }),
    { parser: 'json' },
  ),
);
