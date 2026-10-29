import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS } from '../../src/client/keybinds';
import { DEFAULT_SETTINGS, parseSettings } from '../../src/client/settings';

describe('stored settings', () => {
  it('fall back to the defaults when missing or broken', () => {
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ volume: 7 })).toEqual(DEFAULT_SETTINGS);
  });

  it('keep what was stored and default the rest', () => {
    const s = parseSettings({ volume: 0.3, bindings: { aoe: ['KeyG'] }, seenHints: ['ability:ground_slam'] });
    expect(s.volume).toBe(0.3);
    expect(s.fill).toBe(DEFAULT_SETTINGS.fill);
    expect(s.bindings.aoe).toEqual(['KeyG']);
    expect(s.seenHints).toEqual(['ability:ground_slam']);
  });

  it('give actions added since the settings were saved their default keys', () => {
    const s = parseSettings({ bindings: { attack: ['KeyJ'] } });
    expect(s.bindings.super).toEqual(DEFAULT_BINDINGS.super);
  });
});
