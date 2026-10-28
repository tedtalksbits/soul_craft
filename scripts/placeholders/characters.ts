/**
 * Placeholder humanoid sheets (player, hollow, archer, knight). 16x24 frames,
 * anchored at the feet. One row per animation; directional animations get a
 * row per facing. The renderer resolves `<pose>_<dir>`, then `<pose>`.
 */
import type { SpriteSheetDef } from '../../src/content/sprite-sheet';
import { hex, Sheet, type RGBA, type Surface } from './pixel-canvas';

type Dir = 'down' | 'up' | 'left' | 'right';
const DIRS: Dir[] = ['down', 'up', 'left', 'right'];
export type Kind = 'player' | 'hollow' | 'archer' | 'knight';

interface Palette {
  body: RGBA;
  dark: RGBA;
  cape: RGBA;
  trim: RGBA;
  face: RGBA;
  head: RGBA;
}

const PALETTES: Record<Kind, Palette> = {
  player: {
    body: hex('#9da2a8'),
    dark: hex('#5f646b'),
    cape: hex('#8a2219'),
    trim: hex('#d0a85c'),
    face: hex('#111111'),
    head: hex('#9da2a8'),
  },
  hollow: {
    body: hex('#7a6a58'),
    dark: hex('#4a4036'),
    cape: hex('#3a322c'),
    trim: hex('#6a5a48'),
    face: hex('#0b0a0a'),
    head: hex('#7a6a58'),
  },
  archer: {
    body: hex('#b0aa98'),
    dark: hex('#6a665a'),
    cape: hex('#3a4436'),
    trim: hex('#8a7a50'),
    face: hex('#000000'),
    head: hex('#d8d0bc'),
  },
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
const SHIELD = hex('#5a412b');
const BLADE = hex('#d8dcde');

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
  const bulk = kind === 'knight' ? 1 : 0;

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
  if (kind === 'hollow') B(-4, -19, 8, 3, pal.cape);
  if (kind === 'knight') B(-4, -15, 8, 1, hex('#1a1a1e'));
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
  if (kind === 'player') B(-1, -21, 2, 3, hex('#a3261c'));

  drawGear(B, kind, dir, pose, frame, pal);
}

function drawGear(
  B: (x: number, y: number, w: number, h: number, c: RGBA) => void,
  kind: Kind,
  dir: Dir,
  pose: Pose,
  frame: number,
  pal: Palette,
): void {
  const attacking = pose === 'attack';
  const raised = pose === 'windup';
  switch (kind) {
    case 'player': {
      if (!attacking && dir !== 'up') {
        const sh = { down: [-6, -11], left: [-7, -12], right: [3, -12] }[dir];
        B(sh[0]!, sh[1]!, 4, 7, SHIELD);
        B(sh[0]! + 1, sh[1]! + 2, 2, 2, pal.trim);
      }
      if (!attacking && dir !== 'up') {
        const sx = dir === 'left' ? -6 : 5;
        B(sx, -12, 1, 9, BLADE);
        B(sx - 1, -5, 3, 1, pal.trim);
      }
      if (attacking) {
        // Arms thrust toward the swing; the blade itself is drawn as an effect.
        const [hx, hy] = { down: [0, -4], up: [0, -16], left: [-7, -10], right: [6, -10] }[dir];
        B(hx!, hy!, 2, 2, pal.body);
      }
      return;
    }
    case 'hollow': {
      const y = raised ? -22 - frame : attacking ? -10 : -12;
      B(5, y, 1, 8, hex('#8a7a68'));
      return;
    }
    case 'archer': {
      const drawn = raised;
      const bx = dir === 'left' ? -7 : 4;
      for (let i = -4; i <= 4; i++)
        B(bx + (drawn ? 1 : 0) + Math.round(Math.cos((i / 4) * 1.2) * 2), -10 + i, 1, 1, hex('#7a5a3a'));
      if (drawn) B(bx - 2, -10, 4, 1, hex('#c8b898'));
      return;
    }
    case 'knight': {
      const sh = { down: [-3, -12], up: [-3, -14], left: [-8, -13], right: [3, -13] }[dir];
      if (dir !== 'up') {
        B(sh[0]!, sh[1]!, 7, 9, hex('#5a3e26'));
        B(sh[0]! + 2, sh[1]! + 3, 3, 3, pal.trim);
      }
      const y = raised ? -24 : -13;
      B(dir === 'left' ? 6 : -7, y, 2, 11, hex('#c8ccd0'));
      return;
    }
  }
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

export function buildCharacter(kind: Kind): { png: Buffer; json: SpriteSheetDef } {
  const cols = 4;
  const rows = DIRECTIONAL.length * DIRS.length + SINGLE.length;
  const sheet = new Sheet(cols * 16, rows * 24);
  const animations: SpriteSheetDef['animations'] = {};
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
