/**
 * Key bindings: the defaults, how keys are named on screen, and rebinding.
 * Pure (no DOM), so it is unit-tested headless. Keys are KeyboardEvent.code
 * values, which name a physical key position; `keyLabel` turns them into
 * what is printed on the key for display.
 */
import type { ActionName } from '../sim/input';

export type Binding = ActionName | 'up' | 'down' | 'left' | 'right' | 'inventory';
export type Bindings = Readonly<Record<Binding, readonly string[]>>;

export const ALL_BINDINGS: readonly Binding[] = [
  'up',
  'down',
  'left',
  'right',
  'attack',
  'roll',
  'heal',
  'use',
  'item',
  'aoe',
  'classAbility',
  'super',
  'inventory',
];

/** How many keys one action can have. */
export const KEYS_PER_BINDING = 2;

export const DEFAULT_BINDINGS: Bindings = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  attack: ['KeyJ', 'Space'],
  roll: ['ShiftLeft', 'KeyK'],
  heal: ['KeyR', 'KeyH'],
  use: ['KeyE', 'Enter'],
  item: ['KeyQ'],
  aoe: ['KeyF'],
  classAbility: ['KeyC'],
  super: ['KeyV'],
  inventory: ['Tab', 'KeyI'],
};

/** The controls list, in the order and groups players read it. */
export const BINDING_GROUPS: readonly {
  title: string;
  rows: readonly { binding: Binding; label: string }[];
}[] = [
  {
    title: 'Move',
    rows: [
      { binding: 'up', label: 'Up' },
      { binding: 'down', label: 'Down' },
      { binding: 'left', label: 'Left' },
      { binding: 'right', label: 'Right' },
      { binding: 'roll', label: 'Roll' },
    ],
  },
  {
    title: 'Fight',
    rows: [
      { binding: 'attack', label: 'Attack (or left click)' },
      { binding: 'aoe', label: 'AoE ability' },
      { binding: 'classAbility', label: 'Class ability' },
      { binding: 'super', label: 'Super' },
    ],
  },
  {
    title: 'Other',
    rows: [
      { binding: 'heal', label: 'Drink flask' },
      { binding: 'item', label: 'Quick item' },
      { binding: 'use', label: 'Interact' },
      { binding: 'inventory', label: 'Inventory' },
    ],
  },
];

/**
 * Keys the game needs for itself: Escape (pause and back), the dev console and
 * dev overlays, and the browser's own function keys.
 */
export function isReserved(code: string): boolean {
  return (
    code === 'Escape' ||
    code === 'Backquote' ||
    /^F\d+$/.test(code) ||
    code === 'MetaLeft' ||
    code === 'MetaRight'
  );
}

const NAMED: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  ShiftLeft: 'Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'Alt',
  AltRight: 'R Alt',
  CapsLock: 'Caps',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
};

/** What a key is called on screen: "F", "Space", "Shift", "↑", "Num 4". */
export function keyLabel(code: string): string {
  const named = NAMED[code];
  if (named) return named;
  const key = /^Key([A-Z])$/.exec(code)?.[1];
  if (key) return key;
  const digit = /^Digit(\d)$/.exec(code)?.[1];
  if (digit) return digit;
  const num = /^Numpad(.+)$/.exec(code)?.[1];
  if (num) return `Num ${num}`;
  return code;
}

/**
 * A key's label for the pixel HUD, whose font has only A-Z, 0-9 and a few
 * symbols, in at most three letters: "F", "SPC", "SHF".
 */
export function hudKeyLabel(code: string): string {
  const short: Readonly<Record<string, string>> = {
    Space: 'SPC',
    Enter: 'ENT',
    Tab: 'TAB',
    ShiftLeft: 'SHF',
    ShiftRight: 'SHF',
    ControlLeft: 'CTL',
    ControlRight: 'CTL',
    AltLeft: 'ALT',
    AltRight: 'ALT',
  };
  const label = short[code] ?? keyLabel(code).replace(/^Num /, 'N');
  return /^[A-Z0-9+\-/!]{1,3}$/.test(label) ? label : '?';
}

/** The first key bound to an action, as shown on screen; "—" if it has none. */
export function primaryKey(bindings: Bindings, binding: Binding): string {
  const code = bindings[binding][0];
  return code ? keyLabel(code) : '—';
}

export interface RebindResult {
  bindings: Bindings;
  /** The action that had this key and lost it, if any. */
  tookFrom: Binding | null;
}

/**
 * Puts `code` in `binding`'s key slot `slot` (0 = main, 1 = alternative). A key can only do
 * one thing, so it is taken off any other action that had it.
 */
export function rebind(bindings: Bindings, binding: Binding, slot: number, code: string): RebindResult {
  let tookFrom: Binding | null = null;
  const next: Record<Binding, readonly string[]> = { ...bindings };
  for (const b of ALL_BINDINGS) {
    if (b === binding || !next[b].includes(code)) continue;
    tookFrom = b;
    next[b] = next[b].filter((k) => k !== code);
  }
  const keys = next[binding].filter((k) => k !== code);
  if (slot < keys.length) keys[slot] = code;
  else keys.push(code);
  next[binding] = keys.slice(0, KEYS_PER_BINDING);
  return { bindings: next, tookFrom };
}

/** Removes the key in `binding`'s slot `slot`. */
export function unbind(bindings: Bindings, binding: Binding, slot: number): Bindings {
  return { ...bindings, [binding]: bindings[binding].filter((_, i) => i !== slot) };
}
