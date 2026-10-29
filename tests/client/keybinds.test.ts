import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  hudKeyLabel,
  isReserved,
  keyLabel,
  primaryKey,
  rebind,
  unbind,
} from '../../src/client/keybinds';

describe('key labels', () => {
  it('names keys as they are printed', () => {
    expect(keyLabel('KeyF')).toBe('F');
    expect(keyLabel('Digit3')).toBe('3');
    expect(keyLabel('ShiftLeft')).toBe('Shift');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Numpad4')).toBe('Num 4');
  });

  it('fits HUD labels in three letters the pixel font can draw', () => {
    expect(hudKeyLabel('KeyF')).toBe('F');
    expect(hudKeyLabel('Space')).toBe('SPC');
    expect(hudKeyLabel('Numpad4')).toBe('N4');
    expect(hudKeyLabel('ArrowUp')).toBe('?');
  });

  it('keeps Escape, the dev console and function keys for the game', () => {
    for (const code of ['Escape', 'Backquote', 'F1', 'F11']) expect(isReserved(code)).toBe(true);
    expect(isReserved('KeyF')).toBe(false);
  });
});

describe('rebinding', () => {
  it('replaces a key in its slot', () => {
    const { bindings, tookFrom } = rebind(DEFAULT_BINDINGS, 'aoe', 0, 'KeyG');
    expect(bindings.aoe).toEqual(['KeyG']);
    expect(tookFrom).toBeNull();
  });

  it('adds an alternative key in the second slot', () => {
    expect(rebind(DEFAULT_BINDINGS, 'aoe', 1, 'KeyG').bindings.aoe).toEqual(['KeyF', 'KeyG']);
  });

  it('takes a key off the action that had it, so one key never does two things', () => {
    const { bindings, tookFrom } = rebind(DEFAULT_BINDINGS, 'aoe', 0, 'KeyQ');
    expect(bindings.aoe).toEqual(['KeyQ']);
    expect(bindings.item).toEqual([]);
    expect(tookFrom).toBe('item');
    expect(primaryKey(bindings, 'item')).toBe('—');
  });

  it('putting an action’s own key in its other slot swaps the two, never duplicating it', () => {
    expect(rebind(DEFAULT_BINDINGS, 'use', 1, 'KeyE').bindings.use).toEqual(['Enter', 'KeyE']);
  });

  it('clears a slot', () => {
    expect(unbind(DEFAULT_BINDINGS, 'heal', 1).heal).toEqual(['KeyR']);
  });
});
