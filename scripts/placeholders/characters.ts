/**
 * Placeholder humanoid sheets (the knight, until its real art lands). 16x24 frames,
 * anchored at the feet. One row per animation; directional animations get a
 * row per facing. The renderer resolves `<pose>_<dir>`, then `<pose>`.
 */
import type { SpriteSheetFile } from '../../src/content/sprite-sheet';
import { hex, Sheet, type RGBA, type Surface } from './pixel-canvas';

type Dir = 'down' | 'up' | 'left' | 'right';
const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
export type Kind = 'knight';

interface Palette {
  body: RGBA;
  dark: RGBA;
  cape: RGBA;
  trim: RGBA;
  face: RGBA;
  head: RGBA;
}

const PALETTES: Record<Kind, Palette> = {
  knight: {
    body: hex('#62666e'),
    dark: hex('#383b40'),
    cape: hex('#4a463e'),
    trim: hex('#9c7a3c'),
    face: hex('#000000'),
    head: hex('#70747c'),
  },
};

const SHADOW = hex('#000000', 90);

type Pose = 'idle' | 'walk' | 'attack' | 'windup' | 'hurt';
const DIRECTIONAL: { pose: Pose; frames: number; fps: number; loop: boolean }[] = [
  { pose: 'idle', frames: 2, fps: 2, loop: true },
  { pose: 'walk', frames: 4, fps: 8, loop: true },
  { pose: 'attack', frames: 3, fps: 12, loop: false },
  { pose: 'windup', frames: 2, fps: 6, loop: true },
  { pose: 'hurt', frames: 1, fps: 1, loop: false },
];
const SINGLE = [
  { pose: 'roll', frames: 4, fps: 14, loop: true },
  { pose: 'sit', frames: 1, fps: 1, loop: false },
  { pose: 'dead', frames: 1, fps: 1, loop: false },
  { pose: 'drink', frames: 2, fps: 4, loop: true },
  { pose: 'stunned', frames: 2, fps: 4, loop: true },
] as const;

function drawFigure(s: Surface, kind: Kind, dir: Dir, pose: Pose, frame: number): void {
  const pal = PALETTES[kind];
  const P = (x: number, y: number, w: number, h: number, c: RGBA) => s.rect(8 + x, 24 + y, w, h, c);
  const step = pose === 'walk' ? ([1, 0, -1, 0][frame] ?? 0) : 0;
  const bob = pose === 'walk' ? Math.abs(step) : pose === 'idle' ? frame : 0;
  const lean = pose === 'attack' && frame >= 1 ? 1 : pose === 'hurt' ? -1 : 0;
  const [lx, ly] = ({ down: [0, lean], up: [0, -lean], left: [-lean, 0], right: [lean, 0] } as const)[dir];
  const B = (x: number, y: number, w: number, h: number, c: RGBA) => P(x + lx, y + ly - bob, w, h, c);
  // The knight is the only placeholder left: drawn a pixel bulkier than the old humanoid base.
  const bulk = 1;

  s.ellipse(8, 23, 6, 2.2, SHADOW);
  P(-4, -5 + (step > 0 ? -1 : 0), 3, 5, pal.dark);
  P(1, -5 + (step < 0 ? -1 : 0), 3, 5, pal.dark);
  if (dir !== 'down') B(dir === 'left' ? 1 : -5, -13, dir === 'up' ? 10 : 4, 9, pal.cape);
  B(-5 - bulk, -12, 10 + bulk * 2, 8, pal.body);
  B(-5 - bulk, -6, 10 + bulk * 2, 1, pal.dark);
  B(-1, -6, 2, 1, pal.trim);
  if (dir === 'down') {
    B(-5 - bulk, -12, 2, 6, pal.cape);
    B(3 + bulk, -12, 2, 6, pal.cape);
  }
  B(-4 - bulk, -18 - bulk, 8 + bulk * 2, 7 + bulk, pal.head);
  B(-4, -15, 8, 1, hex('#1a1a1e')); // visor slit
  if (pose === 'hurt') {
    if (dir === 'down') {
      B(-3, -15, 1, 1, pal.face);
      B(-2, -14, 1, 1, pal.face);
      B(2, -15, 1, 1, pal.face);
      B(1, -14, 1, 1, pal.face);
    }
  } else if (dir === 'down') {
    B(-3, -15, 2, 1, pal.face);
    B(1, -15, 2, 1, pal.face);
  } else if (dir === 'left') B(-4, -15, 3, 1, pal.face);
  else if (dir === 'right') B(1, -15, 3, 1, pal.face);

  drawKnightGear(B, dir, pose, pal);
}

/** Tower shield (except from behind) and a sword raised during the windup. */
function drawKnightGear(
  B: (x: number, y: number, w: number, h: number, c: RGBA) => void,
  dir: Dir,
  pose: Pose,
  pal: Palette,
): void {
  const sh = { down: [-3, -12], up: [-3, -14], left: [-8, -13], right: [3, -13] }[dir];
  if (dir !== 'up') {
    B(sh[0]!, sh[1]!, 7, 9, hex('#5a3e26'));
    B(sh[0]! + 2, sh[1]! + 3, 3, 3, pal.trim);
  }
  const y = pose === 'windup' ? -24 : -13;
  B(dir === 'left' ? 6 : -7, y, 2, 11, hex('#c8ccd0'));
}

function drawSingle(s: Surface, kind: Kind, pose: (typeof SINGLE)[number]['pose'], frame: number): void {
  const pal = PALETTES[kind];
  const P = (x: number, y: number, w: number, h: number, c: RGBA) => s.rect(8 + x, 24 + y, w, h, c);
  switch (pose) {
    case 'roll': {
      s.ellipse(8, 23, 6, 2.2, SHADOW);
      s.ellipse(8, 17, 5.5, 5.5, pal.cape);
      const a = (frame / 4) * Math.PI * 2;
      s.ellipse(8 + Math.cos(a) * 2, 17 + Math.sin(a) * 2, 3, 3, pal.body);
      return;
    }
    case 'sit':
      s.ellipse(8, 23, 6, 2.2, SHADOW);
      P(-5, -9, 10, 8, pal.cape);
      P(-4, -12, 8, 6, pal.body);
      P(-3, -16, 6, 5, pal.head);
      P(-2, -14, 4, 1, pal.face);
      return;
    case 'dead':
      P(-7, -3, 14, 4, pal.cape);
      P(-5, -5, 10, 3, pal.body);
      P(4, -4, 3, 3, pal.head);
      return;
    case 'drink':
      drawFigure(s, kind, 'down', 'idle', 0);
      P(1, -17 + frame, 2, 3, hex('#ff9a30'));
      P(1, -18 + frame, 2, 1, hex('#c8b898'));
      return;
    case 'stunned':
      drawFigure(s, kind, 'down', 'hurt', 0);
      P(frame ? -5 : 3, -23, 1, 1, hex('#ffe070'));
      P(frame ? 3 : -5, -22, 1, 1, hex('#ffe070'));
      P(-1, -24 + frame, 1, 1, hex('#ffe070'));
      return;
  }
}

export function buildCharacter(kind: Kind): { png: Buffer; json: SpriteSheetFile } {
  const cols = 4;
  const rows = DIRECTIONAL.length * DIRS.length + SINGLE.length;
  const sheet = new Sheet(cols * 16, rows * 24);
  const animations: SpriteSheetFile['animations'] = {};
  let row = 0;
  for (const a of DIRECTIONAL) {
    for (const dir of DIRS) {
      const frames: number[] = [];
      for (let f = 0; f < a.frames; f++) {
        drawFigure(sheet.frame(row * cols + f, 16, 24), kind, dir, a.pose, f);
        frames.push(row * cols + f);
      }
      animations[`${a.pose}_${dir}`] = { frames, fps: a.fps, loop: a.loop };
      row++;
    }
  }
  for (const a of SINGLE) {
    const frames: number[] = [];
    for (let f = 0; f < a.frames; f++) {
      drawSingle(sheet.frame(row * cols + f, 16, 24), kind, a.pose, f);
      frames.push(row * cols + f);
    }
    animations[a.pose] = { frames, fps: a.fps, loop: a.loop };
    row++;
  }
  return {
    png: sheet.toPNG(),
    json: { image: `${kind}.png`, frameWidth: 16, frameHeight: 24, anchor: [0.5, 1], frames: {}, animations },
  };
}
